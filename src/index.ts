import { findConservativeBuy } from "./strategy";
import { checkTakeProfitOrStopLoss } from "./strategy";
import { buyIngredient } from "./trade";
import { loadPositions, savePositions, Position } from "./state";
import * as dotenv from "dotenv";
dotenv.config();

const INTERVAL_MS = 5 * 60 * 1000; // 5 menit

async function run() {
  console.log(`[${new Date().toISOString()}] 🔄 Bot check...`);

  // 1. Cek posisi terbuka, jual jika perlu
  await checkTakeProfitOrStopLoss();

  // 2. Jika tidak ada posisi, cari peluang beli
  const buyOpportunity = await findConservativeBuy();
  if (buyOpportunity) {
    const { token, amountCHEF } = buyOpportunity;
    console.log(`📈 Peluang: ${token.symbol} harga ${token.price_chef} CHEF, sinyal ${token.signals.join(', ')}`);
    const result = await buyIngredient(token.id, amountCHEF, 200); // 2% slippage

    if (result.success) {
      // Simpan posisi
      const newPos: Position = {
        tokenId: token.id,
        symbol: token.symbol,
        buyPriceCHEF: parseFloat(token.price_chef),
        quantity: "jumlah token didapat perlu parsing dari event transfer", // perlu di-improve
        boughtAt: new Date().toISOString()
      };
      // Idealnya kita decode receipt untuk jumlah token yang diterima, tapi sederhana dulu
      // Untuk sementara kita set quantity placeholder
      newPos.quantity = "0";
      const positions = loadPositions();
      positions.push(newPos);
      savePositions(positions);
      console.log(`💾 Posisi disimpan: ${token.symbol}`);
    }
  }
}

setInterval(run, INTERVAL_MS);
console.log("🤖 Bot Konservatif Chef Universe dimulai...");
run(); // jalankan langsung sekali
