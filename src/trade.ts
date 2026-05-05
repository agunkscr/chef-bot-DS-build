import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ABI minimal Mint Club V2 Bonding Curve
const BONDING_CURVE_ABI = [
  "function getBuyPrice(address token, uint256 amount) external view returns (uint256)",
  "function buy(address token, uint256 amount, uint256 maxPrice) external payable returns (uint256)",
  "function sell(address token, uint256 amount, uint256 minReturn) external returns (uint256)"
];

// Alamat kontrak Mint Club V2 di Base (perlu konfirmasi)
// Untuk contoh kita gunakan address placeholder, user HARUS mengganti dengan address resmi
const MINT_CLUB_V2_ADDRESS = "0x..."; // TODO: ganti dengan address resmi dari chef universe docs

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY!, provider);
const bondingCurve = new ethers.Contract(MINT_CLUB_V2_ADDRESS, BONDING_CURVE_ABI, wallet);

export async function getBuyPrice(tokenAddress: string, amountCHEF: number): Promise<number> {
  const amountWei = ethers.parseEther(amountCHEF.toString());
  const priceWei = await bondingCurve.getBuyPrice(tokenAddress, amountWei);
  return parseFloat(ethers.formatEther(priceWei));
}

export async function buyIngredient(
  tokenAddress: string,
  amountCHEF: number,
  maxSlippageBps: number // basis poin, 100 = 1%
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const maxPrice = amountCHEF * (1 + maxSlippageBps / 10000);
    const amountWei = ethers.parseEther(amountCHEF.toString());
    const maxPriceWei = ethers.parseEther(maxPrice.toFixed(18));

    const tx = await bondingCurve.buy(tokenAddress, amountWei, maxPriceWei);
    await tx.wait();
    console.log(`✅ Beli sukses: ${tokenAddress} dengan ${amountCHEF} CHEF, tx: ${tx.hash}`);
    return { success: true, txHash: tx.hash };
  } catch (err: any) {
    console.error("❌ Gagal beli:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sellIngredient(
  tokenAddress: string,
  quantity: string, // raw jumlah token
  minReturnBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const amountWei = ethers.parseEther(quantity); // hati-hati desimal, asumsi 18 dec
    const minPrice = 0; // akan dihitung

    const tx = await bondingCurve.sell(tokenAddress, amountWei, 0);
    await tx.wait();
    return { success: true, txHash: tx.hash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
