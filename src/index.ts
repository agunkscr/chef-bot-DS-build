import { createServer } from "http";
import { findOpportunities, evaluatePositions } from "./strategy";
import { buyIngredient, getBuyPrice } from "./trade";
import { addPosition, loadPositions, Position } from "./state";
import * as dotenv from "dotenv";
dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS) || 5 * 60 * 1000;

// ─── Server HTTP minimal untuk Railway health check ──────
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", positions: loadPositions().length }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`🌐 Health check server listening on port ${PORT}`);
});

// ─── Loop bot ────────────────────────────────────────────
async function run() {
  console.log(`[${new Date().toISOString()}] 🔄 Bot check...`);

  await evaluatePositions();

  const opportunities = await findOpportunities();
  for (const opp of opportunities) {
    const { token, amountCHEF } = opp;
    console.log(`📈 Beli ${token.symbol} @ ${token.current_price_chef} CHEF | sinyal: ${token.signals.join(", ")}`);
    const result = await buyIngredient(token.id, token.symbol, amountCHEF, 200);
    if (result.success) {
      const { tokensEstimated } = await getBuyPrice(token.id, amountCHEF);
      const newPos: Position = {
        tokenId: token.id,
        symbol: token.symbol,
        buyPriceCHEF: parseFloat(token.current_price_chef),
        quantity: "0",
        quantityDecimal: tokensEstimated,
        boughtAt: new Date().toISOString(),
        grade: token.grade || 1,
        volatility24h: parseFloat((token as any).price_change_24h || "0"),
        signalRank: (token as any).signal_rank || 99,
        takeProfitPercent: 0,
        stopLossPercent: 0,
      };
      addPosition(newPos);
    }
  }
}

setInterval(run, INTERVAL_MS);
console.log("🚀 Bot Profit Maksimal siap (health check aktif)...");
run();
