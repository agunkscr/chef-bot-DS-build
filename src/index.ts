import { findOpportunities, evaluatePositions } from "./strategy";
import { buyIngredient } from "./trade";
import { loadPositions, addPosition, Position } from "./state";
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function run() {
  console.log(`[${new Date().toISOString()}] 🔄 Bot check...`);

  // 1. Evaluate open positions (TP/SL)
  await evaluatePositions();

  // 2. Find new buy opportunities
  const opportunities = await findOpportunities();
  for (const opp of opportunities) {
    const { token, amountCHEF } = opp;
    console.log(
      `📈 Beli ${token.symbol} @ ${token.current_price_chef} CHEF, ` +
      `sinyal: ${token.signals.join(", ")}, grade: ${token.grade || '?'}`
    );

    const result = await buyIngredient(
      token.id,
      token.symbol,
      amountCHEF,
      200 // max slippage bps, can be from config
    );

    if (result.success) {
      // Build position object
      const newPos: Position = {
        tokenId: token.id,
        symbol: token.symbol,
        buyPriceCHEF: parseFloat(token.current_price_chef),
        quantity: ethers.parseEther(amountCHEF.toString()).toString(), // placeholder, will be replaced by actual received
        quantityDecimal: amountCHEF, // temporary, see note below
        boughtAt: new Date().toISOString(),
        grade: token.grade || 1,
        volatility24h: parseFloat(token.price_change_24h || "0"),
        signalRank: token.signal_rank || 99,
        takeProfitPercent: undefined as any, // use default from config
        stopLossPercent: undefined as any,
      };
      
      // Ideally, we should decode actual tokens received from tx receipt.
      // For now, we can set quantityDecimal based on amountCHEF / buyPrice estimation.
      // The trade.ts could return tokensReceived; we need to adjust.
      // For simplicity, I'll call getBuyPrice to estimate tokens.
      const { getBuyPrice } = await import("./trade");
      const { tokensEstimated } = await getBuyPrice(token.id, amountCHEF);
      newPos.quantityDecimal = tokensEstimated;
      newPos.quantity = ethers.parseEther(tokensEstimated.toFixed(18)).toString();
      
      addPosition(newPos);
      console.log(`💾 Posisi ${token.symbol} disimpan (${tokensEstimated.toFixed(2)} token).`);
    }
  }
}

setInterval(run, INTERVAL_MS);
console.log("🚀 Bot Profit Maksimal Aktif...");
run();