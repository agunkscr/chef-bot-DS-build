import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Constants ───────────────────────────────────────────────
const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY!;

// Contract addresses (Verified on-chain)
const MCV2_BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27"; // Verified: GitHub issue #10[reference:0]
const CHEF_TOKEN_ADDRESS = "0x3692043871d5F1d4Ed89EB8aeb0D1227593cfC40"; // Verified: Coinbase[reference:1]

// Bond Contract ABI (Minimal for buy/sell and price queries)
const BOND_ABI = [
  // Read functions
  "function getBuyPrice(address token, uint256 amount) external view returns (uint256)",
  "function getSellPrice(address token, uint256 amount) external view returns (uint256)",
  // Write functions
  "function buy(address token, uint256 amount, uint256 minTokens, address recipient) external returns (uint256)",
  "function sell(address token, uint256 amount, uint256 minReturn, address recipient) external returns (uint256)"
];

// ERC20 ABI for token approval
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

// ─── Provider & Wallet ───────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, wallet);
const chefContract = new ethers.Contract(CHEF_TOKEN_ADDRESS, ERC20_ABI, wallet);

// ─── Trade Logging ───────────────────────────────────────────
const LOG_FILE = path.join(__dirname, "..", "trade_log.json");

interface TradeLog {
  timestamp: string;
  action: "BUY" | "SELL";
  tokenAddress: string;
  symbol: string;
  amountCHEF: number;
  tokensReceived: number;
  txHash: string;
  success: boolean;
  error?: string;
}

function logTrade(entry: TradeLog) {
  try {
    const logs: TradeLog[] = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    logs.push(entry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch {
    fs.writeFileSync(LOG_FILE, JSON.stringify([entry], null, 2));
  }
}

// ─── Approval Management ─────────────────────────────────────
async function ensureApproval(amountCHEF: number): Promise<void> {
  const amountWei = ethers.parseEther(amountCHEF.toString());
  const allowance = await chefContract.allowance(wallet.address, MCV2_BOND_ADDRESS);
  
  if (allowance < amountWei) {
    console.log(`⏳ Mengajukan approval ${amountCHEF} CHEF untuk Bond contract...`);
    const tx = await chefContract.approve(MCV2_BOND_ADDRESS, amountWei);
    await tx.wait();
    console.log(`✅ Approval sukses: ${tx.hash}`);
  }
}

// ─── Gas Estimation ──────────────────────────────────────────
async function estimateAndSend(
  contract: ethers.Contract,
  method: string,
  args: any[],
  value: bigint = 0n
): Promise<ethers.TransactionReceipt> {
  const gasLimit = await contract[method].estimateGas(...args);
  const gasLimitWithBuffer = (gasLimit * 120n) / 100n; // 20% buffer[reference:2]
  
  const tx = await contract[method](...args, { gasLimit: gasLimitWithBuffer, value });
  const receipt = await tx.wait();
  return receipt!;
}

// ─── Public Functions ────────────────────────────────────────

export async function getBuyPrice(
  tokenAddress: string, 
  amountCHEF: number
): Promise<{ priceCHEF: number; tokensEstimated: number }> {
  const amountWei = ethers.parseEther(amountCHEF.toString());
  const priceWei = await bondContract.getBuyPrice(tokenAddress, amountWei);
  const priceCHEF = parseFloat(ethers.formatEther(priceWei));
  const tokensEstimated = priceWei > 0n ? (amountCHEF / priceCHEF) : 0;
  return { priceCHEF, tokensEstimated };
}

export async function getSellPrice(
  tokenAddress: string,
  tokenAmount: string // raw amount
): Promise<number> {
  const amountWei = ethers.parseEther(tokenAmount);
  const priceWei = await bondContract.getSellPrice(tokenAddress, amountWei);
  return parseFloat(ethers.formatEther(priceWei));
}

export async function buyIngredient(
  tokenAddress: string,
  symbol: string,
  amountCHEF: number,
  maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // 1. Ensure approval
    await ensureApproval(amountCHEF);

    // 2. Get expected tokens
    const { tokensEstimated } = await getBuyPrice(tokenAddress, amountCHEF);
    const minTokens = tokensEstimated * (1 - maxSlippageBps / 10000);

    console.log(`🛒 Membeli ${symbol}: ${amountCHEF} CHEF, min tokens: ${minTokens.toFixed(2)}`);

    // 3. Execute buy
    const amountWei = ethers.parseEther(amountCHEF.toString());
    const minTokensWei = ethers.parseEther(minTokens.toFixed(18));
    
    const receipt = await estimateAndSend(bondContract, "buy", [
      tokenAddress,
      amountWei,
      minTokensWei,
      wallet.address
    ]);

    // 4. Decode tokens received from Transfer event
    let tokensReceived = 0;
    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "Transfer" && parsed.args.to.toLowerCase() === wallet.address.toLowerCase()) {
          tokensReceived += parseFloat(ethers.formatEther(parsed.args.value));
        }
      } catch { /* skip unparseable logs */ }
    }

    console.log(`✅ Beli sukses: ${tokensReceived.toFixed(2)} ${symbol} | Tx: ${receipt.hash}`);

    logTrade({
      timestamp: new Date().toISOString(),
      action: "BUY",
      tokenAddress,
      symbol,
      amountCHEF,
      tokensReceived,
      txHash: receipt.hash,
      success: true
    });

    return { success: true, txHash: receipt.hash };
  } catch (err: any) {
    console.error(`❌ Gagal beli ${symbol}:`, err.message);

    logTrade({
      timestamp: new Date().toISOString(),
      action: "BUY",
      tokenAddress,
      symbol,
      amountCHEF,
      tokensReceived: 0,
      txHash: "",
      success: false,
      error: err.message
    });

    return { success: false, error: err.message };
  }
}

export async function sellIngredient(
  tokenAddress: string,
  symbol: string,
  quantity: string,
  maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const quantityWei = ethers.parseEther(quantity);

    // Get expected return in CHEF
    const expectedReturn = await getSellPrice(tokenAddress, quantity);
    const minReturn = expectedReturn * (1 - maxSlippageBps / 10000);

    console.log(`💰 Menjual ${quantity} ${symbol}, min return: ${minReturn.toFixed(4)} CHEF`);

    const minReturnWei = ethers.parseEther(minReturn.toFixed(18));

    const receipt = await estimateAndSend(bondContract, "sell", [
      tokenAddress,
      quantityWei,
      minReturnWei,
      wallet.address
    ]);

    console.log(`✅ Jual sukses: ${symbol} | Tx: ${receipt.hash}`);

    logTrade({
      timestamp: new Date().toISOString(),
      action: "SELL",
      tokenAddress,
      symbol,
      amountCHEF: expectedReturn,
      tokensReceived: parseFloat(quantity),
      txHash: receipt.hash,
      success: true
    });

    return { success: true, txHash: receipt.hash };
  } catch (err: any) {
    console.error(`❌ Gagal jual ${symbol}:`, err.message);

    logTrade({
      timestamp: new Date().toISOString(),
      action: "SELL",
      tokenAddress,
      symbol,
      amountCHEF: 0,
      tokensReceived: parseFloat(quantity),
      txHash: "",
      success: false,
      error: err.message
    });

    return { success: false, error: err.message };
  }
}

export async function getSaldoCHEF(): Promise<number> {
  const balanceWei = await chefContract.balanceOf(wallet.address);
  return parseFloat(ethers.formatEther(balanceWei));
}