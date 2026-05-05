// src/api.ts
// Optimized: validation, normalization, retry, timeout, caching

const BAZAAR_URL = "https://chefuniverse.io/api/v1/agent_bazaar";
const REQUEST_TIMEOUT_MS = 15_000; // 15 detik
const CACHE_TTL_MS = 60_000;       // 1 menit

// ─── Types ───────────────────────────────────────────────────
export interface IngredientSignal {
  kind: string;
  rank?: number | null;
  description?: string;
}

export interface Ingredient {
  id: string;                    // token contract address
  symbol: string;
  current_price_chef: string;    // harga dalam CHEF (string untuk presisi)
  price_usd?: string | null;
  volume_24h_chef: string;
  supply: string;
  signals: string[];             // backward-compatible, kita isi dari array of IngredientSignal
  signals_detail?: IngredientSignal[];
  signal_rank?: number;
  slippage_buy_10k?: number;     // slippage untuk order 10k CHEF (bps)
  grade?: number;                // 1-5
  price_change_24h?: string | null;
  market_cap_chef?: string | null;
  bonding_curve_address?: string; // alamat bonding curve
}

export interface BazaarResponse {
  chef: any;
  ingredients: Ingredient[];
  timestamp: string; // ditambahkan oleh kita
}

// ─── Internal State ──────────────────────────────────────────
let cache: { response: BazaarResponse; fetchedAt: number } | null = null;

// ─── Helpers ─────────────────────────────────────────────────
function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

function normalizeIngredient(raw: any): Ingredient | null {
  // Ambil alamat token – mungkin bernama `id`, `token_address`, `contract_address`, dsb.
  const id = raw.id || raw.address || raw.token_address || raw.contract_address || raw.token || "";
  if (!isValidAddress(id)) {
    console.warn(`Data ingredient tidak memiliki alamat valid:`, raw);
    return null; // skip
  }

  // Normalisasi signal: jika array of string, gunakan langsung; jika array of object, ekstrak kind
  let signalStrings: string[] = [];
  let signalsDetail: IngredientSignal[] = [];
  if (Array.isArray(raw.signals)) {
    const first = raw.signals[0];
    if (typeof first === 'string') {
      signalStrings = raw.signals;
    } else if (first && typeof first === 'object' && first.kind) {
      signalStrings = raw.signals.map((s: any) => s.kind);
      signalsDetail = raw.signals.map((s: any) => ({
        kind: s.kind,
        rank: s.rank ?? null,
        description: s.description ?? null
      }));
    }
  }

  // Harga, volume, supply dalam string untuk presisi
  const current_price_chef = raw.current_price_chef || raw.price_chef || raw.price?.toString() || "0";
  const volume_24h_chef = raw.volume_24h_chef || raw.volume_24h?.toString() || "0";
  const supply = raw.supply || raw.total_supply || raw.supply?.toString() || "0";

  return {
    id,
    symbol: raw.symbol || "UNKNOWN",
    current_price_chef,
    price_usd: raw.price_usd || null,
    volume_24h_chef,
    supply,
    signals: signalStrings,
    signals_detail: signalsDetail.length > 0 ? signalsDetail : undefined,
    signal_rank: raw.signal_rank ?? undefined,
    slippage_buy_10k: raw.slippage_buy_10k ?? undefined,
    grade: raw.grade ?? undefined,
    price_change_24h: raw.price_change_24h ?? null,
    market_cap_chef: raw.market_cap_chef ?? null,
    bonding_curve_address: raw.bonding_curve_address || raw.bond_curve || null,
  };
}

// ─── Main Fetch Function ─────────────────────────────────────
export async function fetchBazaar(forceRefresh = false): Promise<BazaarResponse> {
  // Return cache jika masih valid
  if (!forceRefresh && cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
    return cache.response;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(BAZAAR_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    if (!res.ok) {
      throw new Error(`API responded with status ${res.status}`);
    }

    const rawData = await res.json();

    // Transform ingredients
    const ingredients: Ingredient[] = [];
    if (Array.isArray(rawData.ingredients)) {
      for (const raw of rawData.ingredients) {
        const normalized = normalizeIngredient(raw);
        if (normalized) {
          ingredients.push(normalized);
        }
      }
    }

    const response: BazaarResponse = {
      chef: rawData.chef || {},
      ingredients,
      timestamp: new Date().toISOString()
    };

    // Simpan cache
    cache = { response, fetchedAt: Date.now() };

    console.log(`📡 Bazaar fetched: ${ingredients.length} ingredients valid.`);
    return response;

  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout saat mengambil data Bazaar');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Helper: Get specific ingredient by address ────────────────
export async function getIngredientByAddress(address: string): Promise<Ingredient | null> {
  const bazaar = await fetchBazaar();
  return bazaar.ingredients.find(
    i => i.id.toLowerCase() === address.toLowerCase()
  ) || null;
}

// ─── Helper: Get ingredient by symbol ──────────────────────────
export async function getIngredientBySymbol(symbol: string): Promise<Ingredient | null> {
  const bazaar = await fetchBazaar();
  return bazaar.ingredients.find(
    i => i.symbol.toUpperCase() === symbol.toUpperCase()
  ) || null;
}
