// Struktur data dari endpoint /api/v1/agent_bazaar
export interface Ingredient {
  id: string;
  symbol: string;
  price_chef: string;
  price_usd: string;
  volume_24h_chef: string;
  supply: string;
  signals: string[];
  signal_rank: number;
  slippage_buy_10k: number; // basis poin? kita asumsikan persentase langsung
  // field lain diabaikan
}

export interface BazaarResponse {
  chef: any;
  ingredients: Ingredient[];
}

const BAZAAR_URL = "https://chefuniverse.io/api/v1/agent_bazaar";

export async function fetchBazaar(): Promise<BazaarResponse> {
  const res = await fetch(BAZAAR_URL);
  if (!res.ok) throw new Error(`Gagal fetch bazaar: ${res.status}`);
  return res.json();
}
