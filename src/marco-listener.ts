import { MARCO_POLO_WALLET, MARCO_POLO_FARCASTER } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Types ───────────────────────────────────────────────────
export interface MarcoSignal {
  type: "WARPCAST_TRADE_MENTION" | "ONCHAIN_ACCUMULATION" | "WARPCAST_ANALYSIS";
  tokenSymbol: string;
  tokenAddress?: string;
  action: "BUY" | "SELL" | "ANALYZE";
  timestamp: string;
  rawData?: any;
}

// Cache 5 menit
let lastCheck = 0;
const CACHE_MS = 5 * 60 * 1000;
let cachedSignals: MarcoSignal[] = [];

// ─── Polling Warpcast ────────────────────────────────────────
export async function fetchMarcoSignals(): Promise<MarcoSignal[]> {
  const now = Date.now();
  if (now - lastCheck < CACHE_MS) return cachedSignals;

  const signals: MarcoSignal[] = [];

  try {
    // 1. Pantau cast terbaru Marco Polo via public API
    const response = await fetch(
      `https://client.warpcast.com/v2/user-by-username?username=${MARCO_POLO_FARCASTER}`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (response.ok) {
      const data = await response.json();
      const fid = data?.result?.user?.fid;
      if (fid) {
        const castsRes = await fetch(
          `https://client.warpcast.com/v2/casts?fid=${fid}&limit=5`,
          { headers: { "Content-Type": "application/json" } }
        );
        if (castsRes.ok) {
          const castsData = await castsRes.json();
          const casts = castsData?.result?.casts || [];
          for (const cast of casts) {
            const text = cast.text || "";
            const tokenMatch = text.match(/\$([A-Z]+)/g);
            if (tokenMatch) {
              const tokens = tokenMatch.map((t: string) => t.replace("$", ""));
              const isBuy = /buy|accumulat|bullish/i.test(text);
              const isSell = /sell|bearish|exit/i.test(text);
              for (const sym of tokens) {
                signals.push({
                  type: "WARPCAST_ANALYSIS",
                  tokenSymbol: sym,
                  action: isBuy ? "BUY" : isSell ? "SELL" : "ANALYZE",
                  timestamp: cast.timestamp,
                  rawData: text
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("Gagal polling Warpcast Marco Polo:", err);
  }

  cachedSignals = signals;
  lastCheck = now;
  return signals;
}

// ─── Pantau Wallet On-Chain (jika tersedia) ──────────────────
export async function fetchMarcoOnchain(): Promise<MarcoSignal[]> {
  if (!MARCO_POLO_WALLET) return [];
  // TODO: Integrasi dengan BaseScan API / Etherscan API
  // Pantau transaksi terbaru dari wallet Marco Polo
  return [];
}