import { ethers } from "ethers";
import { MCV2_BOND_ADDRESS, BOND_ABI } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, provider);

export interface BondStep {
  rangeTo: number;   // setelah dibagi 1e18, aman
  price: number;
}

export interface StepAnalysis {
  currentSupply: number;
  currentStep: number;
  currentPrice: number;
  nextStepTrigger: number;
  supplyNeededForNextStep: number;
  costToPumpCHEF: number;
  priceJumpPercent: number;
  isNearMilestone: boolean;
  allSteps: BondStep[];
}

export async function analyzeBondingCurve(tokenAddress: string): Promise<StepAnalysis | null> {
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    console.warn(`Alamat token tidak valid: ${tokenAddress}`);
    return null;
  }

  try {
    // Dapatkan data steps (array BigInt)
    const [rangesRaw, pricesRaw] = await bondContract.getSteps(tokenAddress);
    if (!rangesRaw || rangesRaw.length === 0) {
      console.warn(`Tidak ada steps untuk token ${tokenAddress}`);
      return null;
    }

    // Simpan sebagai BigInt (jangan konversi ke number dulu)
    const steps: { rangeTo: bigint; price: bigint }[] = [];
    for (let i = 0; i < rangesRaw.length; i++) {
      steps.push({
        rangeTo: BigInt(rangesRaw[i]),
        price: BigInt(pricesRaw[i]),
      });
    }

    const supplyRaw = await bondContract.getTokenSupply(tokenAddress);
    const currentSupply = BigInt(supplyRaw);

    // Tentukan step saat ini
    let currentStep = 0;
    for (let i = 0; i < steps.length; i++) {
      if (currentSupply < steps[i].rangeTo) {
        currentStep = i;
        break;
      }
      currentStep = i;
    }

    const currentPriceBig = steps[currentStep]?.price ?? 0n;
    const nextStep = steps[currentStep + 1];

    // Fungsi bantu konversi aman ke number (hanya untuk tampilan)
    const toNum = (val: bigint, decimals = 18) => {
      const divisor = 10n ** BigInt(decimals);
      const integerPart = val / divisor;
      // Batas aman Number.MAX_SAFE_INTEGER adalah 9e15, jadi jika > 1e15 gunakan string saja (jarang)
      if (integerPart > 9007199254740991n) {
        // Untuk keperluan log, cukup dengan pembagian bulat saja
        return Number(integerPart) / (10 ** (decimals - Math.min(decimals, 15)));
      }
      return Number(val) / (10 ** decimals);
    };

    return {
      currentSupply: toNum(currentSupply),
      currentStep,
      currentPrice: toNum(currentPriceBig),
      nextStepTrigger: nextStep ? toNum(nextStep.rangeTo) : Infinity,
      supplyNeededForNextStep: nextStep ? toNum(nextStep.rangeTo - currentSupply) : Infinity,
      costToPumpCHEF: nextStep ? toNum((nextStep.rangeTo - currentSupply) * currentPriceBig, 36) : Infinity,
      priceJumpPercent: nextStep
        ? ((toNum(nextStep.price) - toNum(currentPriceBig)) / toNum(currentPriceBig)) * 100
        : 0,
      isNearMilestone: nextStep ? currentSupply >= (nextStep.rangeTo * 95n / 100n) : false,
      allSteps: steps.map(s => ({
        rangeTo: toNum(s.rangeTo),
        price: toNum(s.price),
      })),
    };
  } catch (err) {
    console.error(`Gagal analisis kurva ${tokenAddress}:`, err);
    return null;
  }
}

export async function getBondingCurveSignals(tokenAddress: string): Promise<string[]> {
  const analysis = await analyzeBondingCurve(tokenAddress);
  if (!analysis) return [];
  const signals: string[] = [];
  if (analysis.isNearMilestone) signals.push("PRE_MILESTONE");
  if (analysis.priceJumpPercent >= 30) signals.push("BIG_JUMP_AHEAD");
  if (analysis.costToPumpCHEF < 100 && analysis.supplyNeededForNextStep < 50) signals.push("CHEAP_PUMP");
  return signals;
}
