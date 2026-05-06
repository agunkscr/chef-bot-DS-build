import { fetchBazaar } from "./api"; // untuk lookup alamat dari simbol
import { MARCO_POLO_WALLET, MARCO_POLO_FARCASTER } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Types ───────────────────────────────────────────────────
export interface MarcoSignal {
  type: "WARPCAST_ANALYSIS";
  tokenSymbol: string;
  tokenAddress?: string; // diisi setelah lookup
  action: "BUY" | "SELL" | "ANALYZE";
  timestamp: string;
  rawData?: string;
}

// Cache untuk hasil fetchMarcoSignals (5 menit)
let lastCheck = 0;
const CACHE_MS = 5 * 60 * 1000;
let cachedSignals: MarcoSignal[] = [];

// ─── Polling Warpcast ────────────────────────────────────────
export async function fetchMarcoSignals(): Promise<MarcoSignal[]> {
  const now = Date.now();
  if (now - lastCheck < CACHE_MS) return cachedSignals;

  const signals: MarcoSignal[] = [];

  try {
    // 1. Ambil data user Marco Polo
    const response = await fetch(
      `https://client.warpcast.com/v2/user-by-username?username=${MARCO_POLO_FARCASTER}`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (!response.ok) {
      console.warn("Gagal fetch user Marco Polo, status:", response.status);
      lastCheck = now;
      cachedSignals = [];
      return [];
    }

    const data = await response.json();
    const fid = data?.result?.user?.fid;
    if (!fid) {
      console.warn("User Marco Polo tidak ditemukan.");
      lastCheck = now;
      cachedSignals = [];
      return [];
    }

    // 2. Ambil casts terbaru
    const castsRes = await fetch(
      `https://client.warpcast.com/v2/casts?fid=${fid}&limit=5`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (!castsRes.ok) {
      console.warn("Gagal fetch casts Marco Polo, status:", castsRes.status);
      lastCheck = now;
      cachedSignals = [];
      return [];
    }

    const castsData = await castsRes.json();
    const casts = castsData?.result?.casts || [];

    // 3. Dapatkan daftar ingredient dari Bazaar untuk lookup
    let bazaarIngredients: { symbol: string; id: string }[] = [];
    try {
      const bazaar = await fetchBazaar();
      bazaarIngredients = bazaar.ingredients.map(ing => ({
        symbol: ing.symbol.toUpperCase(),
        id: ing.id
      }));
    } catch (err) {
      console.warn("Gagal fetch Bazaar untuk lookup Marco, pakai sinyal tanpa alamat.");
    }

    // 4. Proses setiap cast
    for (const cast of casts) {
      const text = cast.text || "";
      const tokenMatches = text.match(/\$([A-Za-z]+)/g); // tangkap $TOKEN
      if (!tokenMatches) continue;

      // Tentukan aksi dari kata kunci
      const isBuy = /buy|accumulat|bullish|long|add/i.test(text);
      const isSell = /sell|bearish|short|exit/i.test(text);
      const action = isBuy ? "BUY" : isSell ? "SELL" : "ANALYZE";

      for (const match of tokenMatches) {
        const symbol = match.replace("$", "").toUpperCase();

        // Cari alamat token dari Bazaar
        const found = bazaarIngredients.find(ing => ing.symbol === symbol);
        const tokenAddress = found ? found.id : undefined;

        signals.push({
          type: "WARPCAST_ANALYSIS",
          tokenSymbol: symbol,
          tokenAddress,         // ✅ sekarang bukan undefined jika simbol valid
          action,
          timestamp: cast.timestamp,
          rawData: text
        });
      }
    }
  } catch (err) {
    console.warn("Gagal polling Warpcast Marco Polo:", err);
  }

  cachedSignals = signals;
  lastCheck = now;
  return signals;
}