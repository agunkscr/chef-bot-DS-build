import { fetchBazaar, Ingredient } from "./api";
import { loadPositions, savePositions, addPosition, removePosition, getPortfolioStats, Position } from "./state";
import { getSaldoCHEF, buyIngredient, sellIngredient, getBuyPrice } from "./trade";
import { getBondingCurveSignals } from "./curve-analyzer";
import { fetchMarcoSignals, MarcoSignal } from "./marco-listener";
import * as dotenv from "dotenv";
dotenv.config();

type Mode = "conservative" | "balanced" | "aggressive" | "volume_play";

interface Config {
  mode: Mode;
  maxPositionPercent: number;
  maxTotalPositions: number;
  maxTotalExposurePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxSlippageBps: number;
  minVolume24h: number;
  minGrade: number;
  signalsRequired: string[];
  signalsForbidden: string[];
  enableCurveSignal: boolean;   // aktifkan sinyal bonding curve
  enableMarcoSignal: boolean;   // aktifkan sinyal Marco Polo
}

function getConfig(): Config {
  const mode = (process.env.STRATEGY_MODE || "conservative") as Mode;
  const base = {
    maxPositionPercent: Number(process.env.MAX_POSITION_PERCENT) || 2,
    maxTotalPositions: Number(process.env.MAX_TOTAL_POSITIONS) || 1,
    maxTotalExposurePercent: Number(process.env.MAX_TOTAL_EXPOSURE) || 10,
    takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT) || 5,
    stopLossPercent: Number(process.env.STOP_LOSS_PERCENT) || -10,
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS) || 200,
    minVolume24h: 10, minGrade: 1,
    enableCurveSignal: process.env.ENABLE_CURVE_SIGNAL !== "false",
    enableMarcoSignal: process.env.ENABLE_MARCO_SIGNAL !== "false",
  };
  switch (mode) {
    case "conservative": return { mode, ...base, signalsRequired: ["LOW_VALUATION"], signalsForbidden: ["SUPPLY_MILESTONE"], maxTotalPositions: 1, maxTotalExposurePercent: 5 };
    case "balanced": return { mode, ...base, signalsRequired: ["LOW_VALUATION", "MOMENTUM_12H"], signalsForbidden: ["SUPPLY_MILESTONE"], minVolume24h: 20, minGrade: 2, maxTotalPositions: 3, maxTotalExposurePercent: 15 };
    case "aggressive": return { mode, ...base, signalsRequired: ["VOLUME_SPIKE", "MOMENTUM_12H"], signalsForbidden: [], minVolume24h: 50, minGrade: 3, maxTotalPositions: 5, maxTotalExposurePercent: 25 };
    case "volume_play": return { mode, ...base, signalsRequired: ["VOLUME_SPIKE"], signalsForbidden: [], minVolume24h: 100, minGrade: 1, maxTotalPositions: 8, maxTotalExposurePercent: 30 };
    default: throw new Error(`Unknown mode: ${mode}`);
  }
}

// ─── Peluang ─────────────────────────────────────────────────
export async function findOpportunities(config?: Config): Promise<{ token: Ingredient; amountCHEF: number }[]> {
  const cfg = config || getConfig();
  const positions = loadPositions();
  const maxSlots = cfg.maxTotalPositions - positions.length;
  if (maxSlots <= 0) { console.log("⛔ Slot penuh."); return []; }

  const bazaar = await fetchBazaar();
  const ingredients = bazaar.ingredients;

  // Sinyal tambahan dari curve analyzer & Marco Polo
  const [marcoSignals] = await Promise.all([
    cfg.enableMarcoSignal ? fetchMarcoSignals() : Promise.resolve([] as MarcoSignal[])
  ]);

  // Kumpulkan sinyal "extra" per token
  const extraBuySignals = new Map<string, string[]>();
  const marcoBuyTargets = new Set<string>();
  for (const ms of marcoSignals) {
    if ((ms.action === "BUY" || ms.action === "ANALYZE") && ms.tokenAddress) {
      marcoBuyTargets.add(ms.tokenAddress.toLowerCase());
      const existing = extraBuySignals.get(ms.tokenAddress.toLowerCase()) || [];
      existing.push("MARCO_POLO_INTEREST");
      extraBuySignals.set(ms.tokenAddress.toLowerCase(), existing);
    }
  }

  // Filter kandidat
  const candidates = ingredients.filter(async (ing) => {
    const ingSigs = ing.signals;
    const hasReq = cfg.signalsRequired.every(s => ingSigs.includes(s));
    const hasForbid = cfg.signalsForbidden.some(s => ingSigs.includes(s));
    if (!hasReq || hasForbid) return false;
    const vol = parseFloat(ing.volume_24h_chef);
    if (vol < cfg.minVolume24h) return false;
    const grade = ing.grade || 1;
    if (grade < cfg.minGrade) return false;
    const slippage = ing.slippage_buy_10k ?? 0;
    if (slippage > cfg.maxSlippageBps) return false;
    return true;
  });

  // Tambahkan bonus sinyal curve & Marco Polo
  const enriched = await Promise.all(candidates.map(async (c) => {
    const extra: string[] = [];
    if (cfg.enableCurveSignal) {
      const curveSignals = await getBondingCurveSignals(c.id);
      extra.push(...curveSignals);
    }
    if (marcoBuyTargets.has(c.id.toLowerCase())) {
      extra.push("MARCO_POLO_INTEREST");
    }
    return { ...c, extraSignals: extra };
  }));

  if (enriched.length === 0) {
    console.log(`🔍 [${cfg.mode}] Tak ada peluang.`);
    return [];
  }

  // Urutkan: sinyal required + extra terbanyak, harga terendah
  enriched.sort((a, b) => {
    const aCount = cfg.signalsRequired.filter(s => (a.signals as string[]).includes(s)).length + a.extraSignals.length;
    const bCount = cfg.signalsRequired.filter(s => (b.signals as string[]).includes(s)).length + a.extraSignals.length;
    if (bCount !== aCount) return bCount - aCount;
    return parseFloat(a.current_price_chef) - parseFloat(b.current_price_chef);
  });

  const selected = enriched.slice(0, maxSlots);
  const saldo = await getSaldoCHEF();
  const priceMap = new Map<string, number>();
  for (const ing of bazaar.ingredients) priceMap.set(ing.id, parseFloat(ing.current_price_chef));
  const currentExposure = loadPositions().reduce((sum, p) => sum + (priceMap.get(p.tokenId) || p.buyPriceCHEF) * p.quantityDecimal, 0);
  const maxExpCHEF = saldo * (cfg.maxTotalExposurePercent / 100);
  const remaining = maxExpCHEF - currentExposure;
  if (remaining <= 0) { console.log("💰 Exposure penuh."); return []; }

  let amountPerToken = saldo * (cfg.maxPositionPercent / 100);
  if (amountPerToken * selected.length > remaining) amountPerToken = remaining / selected.length;

  console.log(`📊 [${cfg.mode}] ${selected.length} peluang, alokasi ${amountPerToken.toFixed(2)} CHEF/token`);
  return selected.map(s => ({ token: s as Ingredient, amountCHEF: amountPerToken }));
}

// ─── Evaluasi Posisi (TP/SL) ─────────────────────────────────
export async function evaluatePositions(config?: Config) {
  const cfg = config || getConfig();
  const positions = loadPositions();
  if (!positions.length) return;

  const bazaar = await fetchBazaar();
  const priceMap = new Map<string, number>();
  for (const ing of bazaar.ingredients) priceMap.set(ing.id, parseFloat(ing.current_price_chef));

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.tokenId);
    if (!currentPrice) continue;
    const change = ((currentPrice - pos.buyPriceCHEF) / pos.buyPriceCHEF) * 100;
    const tp = pos.takeProfitPercent || cfg.takeProfitPercent;
    const sl = pos.stopLossPercent || cfg.stopLossPercent;

    if (change >= tp) {
      console.log(`🎯 TP ${pos.symbol} @ ${change.toFixed(2)}%`);
      await sellIngredient(pos.tokenId, pos.symbol, pos.quantityDecimal.toString(), cfg.maxSlippageBps);
      removePosition(pos.tokenId);
    } else if (change <= sl) {
      console.log(`🛑 SL ${pos.symbol} @ ${change.toFixed(2)}%`);
      await sellIngredient(pos.tokenId, pos.symbol, pos.quantityDecimal.toString(), cfg.maxSlippageBps);
      removePosition(pos.tokenId);
    }
  }

  const updatedPositions = loadPositions();
  const stats = getPortfolioStats(updatedPositions, priceMap);
  console.log(`📈 Portfolio: ${stats.totalPositions} posisi | Investasi: ${stats.totalInvestedCHEF.toFixed(2)} | Nilai: ${stats.totalCurrentValueCHEF.toFixed(2)} | PnL: ${stats.unrealizedPnL.toFixed(2)}`);
}
