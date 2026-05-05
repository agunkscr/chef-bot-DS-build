import { fetchBazaar, Ingredient } from "./api";
import { 
  loadPositions, 
  savePositions, 
  addPosition, 
  removePosition, 
  getPortfolioStats, 
  Position,
  TradeHistory 
} from "./state";
import { 
  getSaldoCHEF, 
  buyIngredient, 
  sellIngredient 
} from "./trade";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Types ───────────────────────────────────────────────────
type SignalKind = "VOLUME_SPIKE" | "LOW_VALUATION" | "MOMENTUM_12H" | "SUPPLY_MILESTONE";

interface StrategyConfig {
  mode: "conservative" | "balanced" | "aggressive" | "volume_play";
  maxPositionPercent: number;
  maxTotalPositions: number;
  maxTotalExposurePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxSlippageBps: number;
  minVolume24h: number;
  minGrade: number;
  signalsRequired: SignalKind[];
  signalsForbidden: SignalKind[];
  maxPriceChef: number | null;
}

// ─── Configuration Factory ───────────────────────────────────
function getConfig(): StrategyConfig {
  const mode = (process.env.STRATEGY_MODE || "conservative") as StrategyConfig["mode"];

  const base = {
    maxPositionPercent: Number(process.env.MAX_POSITION_PERCENT) || 2,
    maxTotalPositions: Number(process.env.MAX_TOTAL_POSITIONS) || 1,
    maxTotalExposurePercent: Number(process.env.MAX_TOTAL_EXPOSURE) || 10,
    takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT) || 5,
    stopLossPercent: Number(process.env.STOP_LOSS_PERCENT) || -10,
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS) || 200,
    minVolume24h: 10,
    minGrade: 1,
    maxPriceChef: null as number | null,
  };

  switch (mode) {
    case "conservative":
      return {
        mode,
        ...base,
        signalsRequired: ["LOW_VALUATION"],
        signalsForbidden: ["SUPPLY_MILESTONE"],
        minVolume24h: 10,
        minGrade: 1,
        maxTotalPositions: 1,
        maxTotalExposurePercent: 5,
      };
    case "balanced":
      return {
        mode,
        ...base,
        signalsRequired: ["LOW_VALUATION", "MOMENTUM_12H"],
        signalsForbidden: ["SUPPLY_MILESTONE"],
        minVolume24h: 20,
        minGrade: 2,
        maxTotalPositions: 3,
        maxTotalExposurePercent: 15,
      };
    case "aggressive":
      return {
        mode,
        ...base,
        signalsRequired: ["VOLUME_SPIKE", "MOMENTUM_12H"],
        signalsForbidden: [],
        minVolume24h: 50,
        minGrade: 3,
        maxTotalPositions: 5,
        maxTotalExposurePercent: 25,
      };
    case "volume_play":
      return {
        mode,
        ...base,
        signalsRequired: ["VOLUME_SPIKE"],
        signalsForbidden: [],
        minVolume24h: 100,
        minGrade: 1,
        maxTotalPositions: 8,
        maxTotalExposurePercent: 30,
      };
    default:
      throw new Error(`Unknown strategy mode: ${mode}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────
function buildPriceMap(ingredients: Ingredient[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ing of ingredients) {
    map.set(ing.id, parseFloat(ing.current_price_chef));
  }
  return map;
}

function calculateTotalExposure(positions: Position[], priceMap: Map<string, number>): number {
  let total = 0;
  for (const pos of positions) {
    const price = priceMap.get(pos.tokenId);
    if (price) {
      total += pos.quantityDecimal * price;
    }
  }
  return total;
}

// ─── Find Opportunities (Multi-Token, Compounding) ───────────
export async function findOpportunities(
  config?: StrategyConfig
): Promise<{ token: Ingredient; amountCHEF: number }[]> {
  const cfg = config || getConfig();
  const positions = loadPositions();
  const maxSlots = cfg.maxTotalPositions - positions.length;
  if (maxSlots <= 0) {
    console.log("⛔ Slot posisi penuh, tidak mencari peluang baru.");
    return [];
  }

  const bazaar = await fetchBazaar();
  const ingredients = bazaar.ingredients;

  // Filter candidates
  const candidates = ingredients.filter((ing) => {
    // Signals
    const ingSignals = ing.signals as string[];
    const hasRequired = cfg.signalsRequired.every((sig) => ingSignals.includes(sig));
    const hasForbidden = cfg.signalsForbidden.some((sig) => ingSignals.includes(sig));
    if (!hasRequired || hasForbidden) return false;

    // Minimum volume
    const volume = parseFloat(ing.volume_24h_chef);
    if (volume < cfg.minVolume24h) return false;

    // Maximum slippage (bps)
    const slippage = ing.slippage_buy_10k ?? 0;
    if (slippage > cfg.maxSlippageBps) return false;

    // Minimum grade
    const grade = ing.grade || 1;
    if (grade < cfg.minGrade) return false;

    // Maximum price (optional)
    if (cfg.maxPriceChef !== null) {
      const price = parseFloat(ing.current_price_chef);
      if (price > cfg.maxPriceChef) return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    console.log(`🔍 [${cfg.mode}] Tak ada peluang memenuhi kriteria.`);
    return [];
  }

  // Sort by strongest signals first, then lowest price
  candidates.sort((a, b) => {
    const aSigCount = cfg.signalsRequired.filter((s) => (a.signals as string[]).includes(s)).length;
    const bSigCount = cfg.signalsRequired.filter((s) => (b.signals as string[]).includes(s)).length;
    if (aSigCount !== bSigCount) return bSigCount - aSigCount;
    return parseFloat(a.current_price_chef) - parseFloat(b.current_price_chef);
  });

  // Limit to available slots
  const selected = candidates.slice(0, maxSlots);

  // Calculate budget
  const saldo = await getSaldoCHEF();
  const priceMap = buildPriceMap(ingredients);
  const currentExposure = calculateTotalExposure(positions, priceMap);
  const maxExposureCHEF = saldo * (cfg.maxTotalExposurePercent / 100);
  const remainingBudget = maxExposureCHEF - currentExposure;
  if (remainingBudget <= 0) {
    console.log("💰 Total exposure sudah mencapai batas, tidak membeli.");
    return [];
  }

  let amountPerToken = saldo * (cfg.maxPositionPercent / 100);
  const totalNeeded = amountPerToken * selected.length;
  if (totalNeeded > remainingBudget) {
    amountPerToken = remainingBudget / selected.length;
  }

  console.log(
    `📊 [${cfg.mode}] ${selected.length} peluang, alokasi ${amountPerToken.toFixed(2)} CHEF/token`
  );

  return selected.map((token) => ({ token, amountCHEF: amountPerToken }));
}

// ─── Evaluate & Manage Positions (TP/SL + Rebalance) ─────────
export async function evaluatePositions(config?: StrategyConfig): Promise<void> {
  const cfg = config || getConfig();
  let positions = loadPositions();
  if (positions.length === 0) return;

  const bazaar = await fetchBazaar();
  const priceMap = buildPriceMap(bazaar.ingredients);

  // Also maintain a trade history for stats (in memory, optional persistence)
  const tradeHistory: TradeHistory[] = [];

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.tokenId);
    if (!currentPrice) {
      console.log(`⚠️ Token ${pos.symbol} tidak ditemukan di bazaar, posisi diabaikan.`);
      continue;
    }

    const changePercent = ((currentPrice - pos.buyPriceCHEF) / pos.buyPriceCHEF) * 100;

    // Use custom TP/SL defined per position (if any), else fallback to config
    const tp = pos.takeProfitPercent || cfg.takeProfitPercent;
    const sl = pos.stopLossPercent || cfg.stopLossPercent;

    if (changePercent >= tp) {
      console.log(`🎯 TAKE PROFIT ${pos.symbol} @ ${changePercent.toFixed(2)}%`);
      const { success, txHash } = await sellIngredient(
        pos.tokenId,
        pos.symbol,
        pos.quantityDecimal.toString(), // send decimal string
        cfg.maxSlippageBps
      );
      if (success) {
        removePosition(pos.tokenId);
        tradeHistory.push({
          timestamp: new Date().toISOString(),
          action: "SELL",
          tokenId: pos.tokenId,
          symbol: pos.symbol,
          amountCHEF: currentPrice * pos.quantityDecimal,
          quantity: pos.quantityDecimal,
          txHash: txHash || "",
        });
      }
      continue;
    }

    if (changePercent <= sl) {
      console.log(`🛑 STOP LOSS ${pos.symbol} @ ${changePercent.toFixed(2)}%`);
      const { success, txHash } = await sellIngredient(
        pos.tokenId,
        pos.symbol,
        pos.quantityDecimal.toString(),
        cfg.maxSlippageBps
      );
      if (success) {
        removePosition(pos.tokenId);
        tradeHistory.push({
          timestamp: new Date().toISOString(),
          action: "SELL",
          tokenId: pos.tokenId,
          symbol: pos.symbol,
          amountCHEF: currentPrice * pos.quantityDecimal,
          quantity: pos.quantityDecimal,
          txHash: txHash || "",
        });
      }
      continue;
    }

    // Optionally: rebalance if signal rank becomes too weak (below top-10)
    // This requires checking current signals, not implemented here to keep it simple.
    // You can add a rebalance function later.
  }

  // Update positions array after removals
  positions = loadPositions();

  // Log portfolio stats
  const stats = getPortfolioStats(positions, priceMap, tradeHistory);
  console.log(
    `📈 Portofolio: ${stats.totalPositions} posisi, ` +
    `Investasi: ${stats.totalInvestedCHEF.toFixed(2)} CHEF, ` +
    `Nilai: ${stats.totalCurrentValueCHEF.toFixed(2)} CHEF, ` +
    `Unrealized PnL: ${stats.unrealizedPnL >= 0 ? '+' : ''}${stats.unrealizedPnL.toFixed(2)} CHEF, ` +
    `Win Rate: ${(stats.winRate * 100).toFixed(0)}%`
  );
}

// ─── Optional: Daily Rebalance for Volume Play ───────────────
export async function rebalancePortfolio() {
  // Close all positions and reallocate based on current strongest signals
  const positions = loadPositions();
  console.log(`🔄 Rebalancing: menutup ${positions.length} posisi...`);
  
  for (const pos of positions) {
    await sellIngredient(pos.tokenId, pos.symbol, pos.quantityDecimal.toString(), 200);
    removePosition(pos.tokenId);
  }

  // Then find new opportunities (run normal cycle)
  const opportunities = await findOpportunities();
  // The buying part will be handled by the main loop
  return opportunities;
}