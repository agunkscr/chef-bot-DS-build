import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  MCV2_BOND_ADDRESS, CHEF_TOKEN_ADDRESS,
  BOND_ABI, ERC20_ABI
} from "./constants";
dotenv.config();

const RPC_URL = process.env.RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY!;
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, wallet);
const chefContract = new ethers.Contract(CHEF_TOKEN_ADDRESS, ERC20_ABI, wallet);

const LOG_FILE = path.join(__dirname, "..", "trade_log.json");

interface TradeLogEntry {
  timestamp: string; action: "BUY" | "SELL"; tokenAddress: string;
  symbol: string; amountCHEF: number; tokensReceived: number;
  txHash: string; success: boolean; error?: string;
}

function logTrade(entry: TradeLogEntry) {
  try {
    const logs: TradeLogEntry[] = JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"));
    logs.push(entry);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch {
    fs.writeFileSync(LOG_FILE, JSON.stringify([entry], null, 2));
  }
}

async function ensureApproval(amountCHEF: number): Promise<void> {
  const amountWei = ethers.parseEther(amountCHEF.toString());
  const allowance = await chefContract.allowance(wallet.address, MCV2_BOND_ADDRESS);
  if (allowance >= amountWei) return;

  console.log(`⏳ Approval ${amountCHEF} CHEF ke Bond...`);
  const tx = await chefContract.approve(MCV2_BOND_ADDRESS, amountWei);
  const receipt = await tx.wait();
  console.log(`✅ Approval terkonfirmasi: ${receipt.hash}`);

  const newAllowance = await chefContract.allowance(wallet.address, MCV2_BOND_ADDRESS);
  if (newAllowance < amountWei) {
    throw new Error(`Approval gagal: allowance ${ethers.formatEther(newAllowance)} < ${amountCHEF}`);
  }
}

async function sendWithBuffer(contract: ethers.Contract, method: string, args: any[]): Promise<ethers.TransactionReceipt> {
  const gasLimit = await contract[method].estimateGas(...args);
  const gasWithBuffer = (gasLimit * 120n) / 100n;
  const tx = await contract[method](...args, { gasLimit: gasWithBuffer });
  return tx.wait() as Promise<ethers.TransactionReceipt>;
}

export async function getSaldoCHEF(): Promise<number> {
  const balanceWei = await chefContract.balanceOf(wallet.address);
  return parseFloat(ethers.formatEther(balanceWei));
}

export async function getBuyPrice(tokenAddress: string, amountCHEF: number) {
  const amountWei = ethers.parseEther(amountCHEF.toString());
  const priceWei = await bondContract.getBuyPrice(tokenAddress, amountWei);
  const priceCHEF = parseFloat(ethers.formatEther(priceWei));
  const tokensEstimated = priceWei > 0n ? (amountCHEF / priceCHEF) : 0;
  return { priceCHEF, tokensEstimated };
}

export async function getSellPrice(tokenAddress: string, tokenAmount: string): Promise<number> {
  const amountWei = ethers.parseEther(tokenAmount);
  const priceWei = await bondContract.getSellPrice(tokenAddress, amountWei);
  return parseFloat(ethers.formatEther(priceWei));
}

export async function buyIngredient(
  tokenAddress: string, symbol: string, amountCHEF: number, maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    await ensureApproval(amountCHEF);
    const { tokensEstimated } = await getBuyPrice(tokenAddress, amountCHEF);
    const minTokens = tokensEstimated * (1 - maxSlippageBps / 10000);
    const amountWei = ethers.parseEther(amountCHEF.toString());
    const minTokensWei = ethers.parseEther(minTokens.toFixed(18));

    console.log(`🛒 BUY ${symbol}: ${amountCHEF} CHEF → min ${minTokens.toFixed(2)} token`);
    const receipt = await sendWithBuffer(bondContract, "buy", [
      tokenAddress, amountWei, minTokensWei, wallet.address
    ]);

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
      } catch {}
    }

    console.log(`✅ BUY sukses: ${tokensReceived.toFixed(2)} ${symbol} | ${receipt.hash}`);
    logTrade({ timestamp: new Date().toISOString(), action: "BUY", tokenAddress, symbol, amountCHEF, tokensReceived, txHash: receipt.hash, success: true });
    return { success: true, txHash: receipt.hash };
  } catch (err: any) {
    console.error(`❌ BUY gagal ${symbol}:`, err.message);
    logTrade({ timestamp: new Date().toISOString(), action: "BUY", tokenAddress, symbol, amountCHEF, tokensReceived: 0, txHash: "", success: false, error: err.message });
    return { success: false, error: err.message };
  }
}

export async function sellIngredient(
  tokenAddress: string, symbol: string, quantity: string, maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const quantityWei = ethers.parseEther(quantity);
    const expectedReturn = await getSellPrice(tokenAddress, quantity);
    const minReturn = expectedReturn * (1 - maxSlippageBps / 10000);
    const minReturnWei = ethers.parseEther(minReturn.toFixed(18));

    console.log(`💰 SELL ${quantity} ${symbol} → min ${minReturn.toFixed(4)} CHEF`);
    const receipt = await sendWithBuffer(bondContract, "sell", [
      tokenAddress, quantityWei, minReturnWei, wallet.address
    ]);

    console.log(`✅ SELL sukses: ${symbol} | ${receipt.hash}`);
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
    console.error(`❌ SELL gagal ${symbol}:`, err.message);
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