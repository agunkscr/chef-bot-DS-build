import { fetchBazaar, Ingredient } from "./api";
import { loadPositions } from "./state";

const MAX_POSITION_PERCENT = Number(process.env.MAX_POSITION_PERCENT) || 2; // % dari saldo
const MAX_SLIPPAGE_BPS = Number(process.env.MAX_SLIPPAGE_BPS) || 200; // 2%

export async function findConservativeBuy(): Promise<{
  token: Ingredient;
  amountCHEF: number;
} | null> {
  const positions = loadPositions();
  if (positions.length > 0) {
    console.log("⏳ Masih ada posisi terbuka, tidak membeli baru.");
    return null; // hanya satu posisi terbuka untuk strategi konservatif
  }

  const bazaar = await fetchBazaar();
  const ingredients = bazaar.ingredients;

  // Filter: hanya sinyal LOW_VALUATION, no SUPPLY_MILESTONE (atau setidaknya hindari milestone buruk)
  const candidates = ingredients.filter(ing => {
    const hasLowVal = ing.signals.includes("LOW_VALUATION");
    const hasSupplyMilestone = ing.signals.includes("SUPPLY_MILESTONE");
    // volume minimal 10 CHEF
    const volume = parseFloat(ing.volume_24h_chef);
    const slippage = ing.slippage_buy_10k; // asumsi persen langsung
    return hasLowVal && !hasSupplyMilestone && volume > 10 && slippage < MAX_SLIPPAGE_BPS / 100;
  });

  if (candidates.length === 0) {
    console.log("🔍 Tak ada peluang konservatif saat ini.");
    return null;
  }

  // Pilih yang harga CHEF paling rendah (value paling undervalued)
  candidates.sort((a, b) => parseFloat(a.price_chef) - parseFloat(b.price_chef));
  const chosen = candidates[0];

  // Hitung jumlah CHEF: 2% dari saldo
  // Dapatkan saldo $CHEF dompet
  const provider = new (require("ethers").JsonRpcProvider)(process.env.RPC_URL);
  const wallet = new (require("ethers").Wallet)(process.env.WALLET_PRIVATE_KEY!, provider);
  const chefTokenAddress = "0xc4a09803e2e1a491cb3119b891dcf890e3c98b07"; // TODO: address $CHEF di Base
  const chefContract = new (require("ethers").Contract)(chefTokenAddress, ["function balanceOf(address) view returns (uint256)"], wallet);
  const saldoWei = await chefContract.balanceOf(wallet.address);
  const saldoCHEF = parseFloat(require("ethers").formatEther(saldoWei));

  const amountCHEF = saldoCHEF * (MAX_POSITION_PERCENT / 100);
  if (amountCHEF < 1) {
    console.log("💰 Saldo $CHEF terlalu kecil untuk membeli.");
    return null;
  }

  return {
    token: chosen,
    amountCHEF
  };
}

export async function checkTakeProfitOrStopLoss() {
  // Implementasi: jika harga naik 5% jual, turun 10% jual
  const positions = loadPositions();
  if (positions.length === 0) return;

  const bazaar = await fetchBazaar();
  const updatedPositions = [];

  for (const pos of positions) {
    const ing = bazaar.ingredients.find(i => i.id === pos.tokenId);
    if (!ing) {
      console.log(`Token ${pos.symbol} tidak ditemukan, hapus posisi.`);
      continue;
    }
    const currentPrice = parseFloat(ing.price_chef);
    const changePercent = ((currentPrice - pos.buyPriceCHEF) / pos.buyPriceCHEF) * 100;
    console.log(`${pos.symbol}: harga beli ${pos.buyPriceCHEF}, sekarang ${currentPrice} (${changePercent.toFixed(2)}%)`);

    const TAKE_PROFIT = Number(process.env.TAKE_PROFIT_PERCENT) || 5;
    const STOP_LOSS = -10; // stop loss 10%

    if (changePercent >= TAKE_PROFIT) {
      console.log(`🎯 Take profit ${pos.symbol}!`);
      // Panggil sell
      const { sellIngredient } = await import("./trade");
      await sellIngredient(pos.tokenId, pos.quantity, 100); // min return 1%
      // posisi ditutup, tidak dimasukkan ke updatedPositions
    } else if (changePercent <= STOP_LOSS) {
      console.log(`🛑 Stop loss ${pos.symbol}!`);
      const { sellIngredient } = await import("./trade");
      await sellIngredient(pos.tokenId, pos.quantity, 100);
    } else {
      updatedPositions.push(pos);
    }
  }

  const { savePositions } = await import("./state");
  savePositions(updatedPositions);
}
