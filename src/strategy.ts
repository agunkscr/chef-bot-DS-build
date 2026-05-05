import { fetchBazaar, Ingredient } from "./api";
import { loadPositions, savePositions, Position } from "./state";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ------------------- TYPES -------------------
type SignalKind = "VOLUME_SPIKE" | "LOW_VALUATION" | "MOMENTUM_12H" | "SUPPLY_MILESTONE";

interface StrategyConfig {
  mode: "conservative" | "balanced" | "aggressive" | "volume_play";
  maxPositionPercent: number;    // % saldo per posisi
  maxTotalPositions: number;     // maksimum posisi terbuka
  maxTotalExposurePercent: number; // maksimum % total saldo terpakai
  takeProfitPercent: number;
  stopLossPercent: number;
  maxSlippageBps: number;
  minVolume24h: number;          // minimum volume dalam CHEF
  minGrade: number;              // 1-5, minimal grade token
  signalsRequired: SignalKind[]; // sinyal yang harus ada
  signalsForbidden: SignalKind[];// sinyal yang harus dihindari
  maxPriceChef: number | null;   // opsional, hanya beli jika harga <= X CHEF
}

// ------------------- CONFIG -------------------
function getConfig(): StrategyConfig {
  const mode = (process.env.STRATEGY_MODE || "conservative") as StrategyConfig["mode"];

  const baseConfig = {
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
        ...baseConfig,
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
        ...baseConfig,
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
        ...baseConfig,
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
        ...baseConfig,
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

// ------------------- HELPERS -------------------

async function getSaldoCHEF(): Promise<number> {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
  const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY!, provider);
  const chefTokenAddress = "0x..."; // TODO: ganti dengan alamat kontrak $CHEF resmi
  const chefContract = new ethers.Contract(
    chefTokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    wallet
  );
  const balanceWei = await chefContract.balanceOf(wallet.address);
  return parseFloat(ethers.formatEther(balanceWei));
}

function getTotalExposure(positions: Position[], currentPrices: Map<string, number>): number {
  let total = 0;
  for (const pos of positions) {
    const price = currentPrices.get(pos.tokenId);
    if (price) {
      total += parseFloat(pos.quantity) * price;
    }
  }
  return total;
}

// ------------------- FIND OPPORTUNITIES -------------------

export async function findOpportunities(config?: StrategyConfig): Promise<
  { token: Ingredient; amountCHEF: number }[]
> {
  const cfg = config || getConfig();
  const positions = loadPositions();
  const maxSlots = cfg.maxTotalPositions - positions.length;
  if (maxSlots <= 0) {
    console.log("⛔ Slot posisi penuh, tidak mencari peluang baru.");
    return [];
  }

  const bazaar = await fetchBazaar();
  const ingredients = bazaar.ingredients;

  // 1. Filter berdasarkan sinyal & parameter
  const candidates = ingredients.filter((ing) => {
    // Sinyal
    const ingSignals: SignalKind[] = ing.signals.map((s) => s.kind);
    const hasRequired = cfg.signalsRequired.every((sig) => ingSignals.includes(sig));
    const hasForbidden = cfg.signalsForbidden.some((sig) => ingSignals.includes(sig));
    if (!hasRequired || hasForbidden) return false;

    // Volume minimal
    const volume = parseFloat(ing.volume_24h_chef);
    if (volume < cfg.minVolume24h) return false;

    // Slippage maksimum
    const slippage = ing.slippage_buy_10k; // asumsi langsung bps
    if (slippage > cfg.maxSlippageBps) return false;

    // Grade minimal
    const grade = ing.grade || 1;
    if (grade < cfg.minGrade) return false;

    // Harga maksimum (opsional)
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

  // 2. Urutkan berdasarkan sinyal terkuat (semakin kecil rank semakin baik) atau harga terendah
  candidates.sort((a, b) => {
    // Prioritaskan yang memiliki lebih banyak sinyal required
    const aSigCount = cfg.signalsRequired.filter((s) => a.signals.map((x) => x.kind).includes(s)).length;
    const bSigCount = cfg.signalsRequired.filter((s) => b.signals.map((x) => x.kind).includes(s)).length;
    if (aSigCount !== bSigCount) return bSigCount - aSigCount;

    // Lalu harga terendah (value buy)
    return parseFloat(a.current_price_chef) - parseFloat(b.current_price_chef);
  });

  // 3. Ambil maksimal sesuai slot
  const selected = candidates.slice(0, maxSlots);

  // 4. Hitung alokasi dana
  const saldo = await getSaldoCHEF();
  const maxExposureCHEF = saldo * (cfg.maxTotalExposurePercent / 100);
  const currentPrices = new Map<string, number>();
  for (const ing of ingredients) {
    currentPrices.set(ing.id, parseFloat(ing.current_price_chef));
  }
  const currentExposure = getTotalExposure(positions, currentPrices);
  const remainingBudget = maxExposureCHEF - currentExposure;
  if (remainingBudget <= 0) {
    console.log("💰 Total exposure sudah mencapai batas, tidak membeli.");
    return [];
  }

  let amountPerToken = (saldo * (cfg.maxPositionPercent / 100));
  // Jika terlalu banyak token, sesuai proporsi budget tersedia
  const totalNeeded = amountPerToken * selected.length;
  if (totalNeeded > remainingBudget) {
    amountPerToken = remainingBudget / selected.length;
  }

  console.log(
    `📊 [${cfg.mode}] ${selected.length} peluang, alokasi ${amountPerToken.toFixed(2)} CHEF/token`
  );

  return selected.map((token) => ({ token, amountCHEF: amountPerToken }));
}

// ------------------- EVALUATE POSITIONS (TP/SL) -------------------

export async function evaluatePositions(config?: StrategyConfig) {
  const cfg = config || getConfig();
  let positions = loadPositions();
  if (positions.length === 0) return;

  const bazaar = await fetchBazaar();
  const updatedPositions: Position[] = [];

  // Build price map
  const priceMap = new Map<string, number>();
  for (const ing of bazaar.ingredients) {
    priceMap.set(ing.id, parseFloat(ing.current_price_chef));
  }

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.tokenId);
    if (!currentPrice) {
      console.log(`⚠️ Token ${pos.symbol} (${pos.tokenId}) tidak ditemukan di bazaar, posisi diabaikan.`);
      continue;
    }
    const changePercent = ((currentPrice - pos.buyPriceCHEF) / pos.buyPriceCHEF) * 100;

    if (changePercent >= cfg.takeProfitPercent) {
      console.log(`🎯 TAKE PROFIT ${pos.symbol} @ ${changePercent.toFixed(2)}%`);
      // Eksekusi sell
      const { sellIngredient } = await import("./trade");
      await sellIngredient(pos.tokenId, pos.quantity, cfg.maxSlippageBps);
      // Posisi tidak dimasukkan lagi (closed)
    } else if (changePercent <= cfg.stopLossPercent) {
      console.log(`🛑 STOP LOSS ${pos.symbol} @ ${changePercent.toFixed(2)}%`);
      const { sellIngredient } = await import("./trade");
      await sellIngredient(pos.tokenId, pos.quantity, cfg.maxSlippageBps);
    } else {
      updatedPositions.push(pos); // masih hold
    }
  }

  savePositions(updatedPositions);
}