import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  MCV2_BOND_ADDRESS, CHEF_TOKEN_ADDRESS,
  BOND_ABI, ERC20_ABI
} from "./constants";
import { addTradeRecord } from "./state";
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

/**
 * Gunakan priceForNextMint untuk mengetahui harga satuan token berikutnya.
 * Return: harga per token dalam CHEF, dan estimasi token yang didapat dari amountCHEF.
 */
export async function getBuyPrice(tokenAddress: string, amountCHEF: number) {
  const priceRaw = await bondContract.priceForNextMint(tokenAddress);
  const priceCHEF = parseFloat(ethers.formatEther(priceRaw)); // harga per token dalam CHEF
  const tokensEstimated = priceCHEF > 0 ? (amountCHEF / priceCHEF) : 0;
  return { priceCHEF, tokensEstimated };
}

export async function buyIngredient(
  tokenAddress: string, symbol: string, amountCHEF: number, maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    await ensureApproval(amountCHEF);

    const { priceCHEF, tokensEstimated } = await getBuyPrice(tokenAddress, amountCHEF);
    const tokensToMint = tokensEstimated * (1 - maxSlippageBps / 10000);
    const amountWei = ethers.parseEther(amountCHEF.toString());
    const tokensToMintWei = ethers.parseEther(tokensToMint.toFixed(18));

    console.log(`🛒 MINT ${symbol}: max ${amountCHEF} CHEF → mint ${tokensToMint.toFixed(2)} token`);
    const receipt = await sendWithBuffer(bondContract, "mint", [
      tokenAddress,
      tokensToMintWei,        // tokensToMint
      amountWei,              // maxReserveAmount
      wallet.address          // receiver
    ]);

    let tokensReceived = 0;
    const iface = new ethers.Interface([
      "event Mint(address indexed token, address indexed user, address receiver, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount)"
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "Mint" && parsed.args.receiver.toLowerCase() === wallet.address.toLowerCase()) {
          tokensReceived += parseFloat(ethers.formatEther(parsed.args.amountMinted));
        }
      } catch {}
    }

    console.log(`✅ MINT sukses: ${tokensReceived.toFixed(2)} ${symbol} | ${receipt.hash}`);
    logTrade({ timestamp: new Date().toISOString(), action: "BUY", tokenAddress, symbol, amountCHEF, tokensReceived, txHash: receipt.hash, success: true });
    return { success: true, txHash: receipt.hash };
  } catch (err: any) {
    console.error(`❌ MINT gagal ${symbol}:`, err.message);
    logTrade({ timestamp: new Date().toISOString(), action: "BUY", tokenAddress, symbol, amountCHEF, tokensReceived: 0, txHash: "", success: false, error: err.message });
    return { success: false, error: err.message };
  }
}

export async function sellIngredient(
  tokenAddress: string, symbol: string, quantity: string, maxSlippageBps: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const quantityWei = ethers.parseEther(quantity);
    // Estimasi kasar minReserveOut: gunakan priceForNextMint sebagai acuan
    const priceRaw = await bondContract.priceForNextMint(tokenAddress);
    const priceCHEF = parseFloat(ethers.formatEther(priceRaw));
    const expectedReturn = parseFloat(quantity) * priceCHEF;
    const minReturn = expectedReturn * (1 - maxSlippageBps / 10000);
    const minReturnWei = ethers.parseEther(minReturn.toFixed(18));

    console.log(`💰 BURN ${quantity} ${symbol} → min ${minReturn.toFixed(4)} CHEF`);
    const receipt = await sendWithBuffer(bondContract, "burn", [
      tokenAddress,
      quantityWei,          // burnAmount
      minReturnWei,         // minReserveOut
      wallet.address        // receiver
    ]);

    console.log(`✅ BURN sukses: ${symbol} | ${receipt.hash}`);

    addTradeRecord({
      timestamp: new Date().toISOString(),
      action: "SELL",
      tokenId: tokenAddress,
      symbol,
    });

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
    console.error(`❌ BURN gagal ${symbol}:`, err.message);
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