import { findOpportunities, evaluatePositions } from "./strategy";
import { buyIngredient } from "./trade";
import { loadPositions, savePositions, Position } from "./state";
import * as dotenv from "dotenv";
dotenv.config();

const INTERVAL_MS = 5 * 60 * 1000;

async function run() {
  console.log(`[${new Date().toISOString()}] 🔄 Bot check...`);

  // 1. Evaluasi posisi terbuka (TP/SL)
  await evaluatePositions();

  // 2. Cari peluang beli baru
  const opportunities = await findOpportunities();
  for (const opp of opportunities) {
    const { token, amountCHEF } = opp;
    console.log(`📈 Beli ${token.symbol} @ ${token.current_price_chef} CHEF, sinyal: ${token.signals.map(s=>s.kind).join(", ")}`);
    const result = await buyIngredient(token.id, amountCHEF, 200);
    if (result.success) {
      const newPos: Position = {
        tokenId: token.id,
        symbol: token.symbol,
        buyPriceCHEF: parseFloat(token.current_price_chef),
        quantity: "0", // idealnya diambil dari receipt
        boughtAt: new Date().toISOString(),
      };
      const positions = loadPositions();
      positions.push(newPos);
      savePositions(positions);
    }
  }
}

setInterval(run, INTERVAL_MS);
console.log("🤖 Bot Multi-Strategy Aktif...");
run();