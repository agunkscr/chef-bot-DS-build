import { ethers } from "ethers";
import { MCV2_BOND_ADDRESS, BOND_ABI } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, provider);

export interface BondStep {
  rangeTo: number;   // sudah aman untuk display (dibagi 1e18)
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

/**
 * Analisis kurva bonding suatu token.
 * @param tokenAddress alamat kontrak token
 * @returns StepAnalysis atau null jika gagal
 */
export async function analyzeBondingCurve(tokenAddress: string): Promise<StepAnalysis | null> {
  if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
    console.warn(`Alamat token tidak valid: ${tokenAddress}`);
    return null;
  }

  try {
    // Panggil getSteps dengan ABI yang benar: mengembalikan array of struct {rangeTo, price}
    const stepsRaw = await bondContract.getSteps(tokenAddress);
    if (!stepsRaw || stepsRaw.length === 0) {
      console.warn(`Tidak ada steps untuk token ${tokenAddress}`);
      return null;
    }

    // stepsRaw sudah dalam bentuk array of { rangeTo: bigint, price: bigint }
    // Tidak perlu lagi mengkonversi dari dua array terpisah.
    const steps: { rangeTo: bigint; price: bigint }[] = stepsRaw.map((s: any) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    }));

    const supplyRaw = await bondContract.getTokenSupply(tokenAddress);
    const currentSupply = BigInt(supplyRaw);

    // Tentukan step saat ini berdasarkan currentSupply
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

    // Fungsi bantu konversi aman ke number (hanya untuk tampilan/logging)
    const toNum = (val: bigint, decimals = 18): number => {
      const divisor = 10n ** BigInt(decimals);
      const integerPart = val / divisor;
      // Jika nilai terlalu besar untuk Number (di atas 9e15), kita skala manual
      if (integerPart > 9007199254740991n) {
        // Menampilkan dengan presisi lebih rendah, aman
        return Number(integerPart) / (10 ** Math.min(decimals, 15));
      }
      return Number(val) / (10 ** decimals);
    };

    const currentSupplyNum = toNum(currentSupply);
    const currentPrice = toNum(currentPriceBig);
    const nextStepTrigger = nextStep ? toNum(nextStep.rangeTo) : Infinity;
    const supplyNeededForNextStep = nextStep ? toNum(nextStep.rangeTo - currentSupply) : Infinity;
    // costToPumpCHEF: biaya untuk menaikkan supply ke step berikutnya (dalam CHEF)
    const costToPumpCHEF = nextStep ? toNum((nextStep.rangeTo - currentSupply) * currentPriceBig, 36) : Infinity;
    const priceJumpPercent = nextStep
      ? ((toNum(nextStep.price) - currentPrice) / currentPrice) * 100
      : 0;
    const isNearMilestone = nextStep
      ? currentSupply >= (nextStep.rangeTo * 95n / 100n)
      : false;

    const allSteps: BondStep[] = steps.map(s => ({
      rangeTo: toNum(s.rangeTo),
      price: toNum(s.price),
    }));

    return {
      currentSupply: currentSupplyNum,
      currentStep,
      currentPrice,
      nextStepTrigger,
      supplyNeededForNextStep,
      costToPumpCHEF,
      priceJumpPercent,
      isNearMilestone,
      allSteps,
    };
  } catch (err) {
    console.error(`Gagal analisis kurva ${tokenAddress}:`, err);
    return null;
  }
}

/**
 * Dapatkan sinyal trading tambahan dari analisis kurva bonding.
 * @param tokenAddress alamat kontrak token
 * @returns array string sinyal (misal "PRE_MILESTONE", "BIG_JUMP_AHEAD", "CHEAP_PUMP")
 */
export async function getBondingCurveSignals(tokenAddress: string): Promise<string[]> {
  const analysis = await analyzeBondingCurve(tokenAddress);
  if (!analysis) return [];
  const signals: string[] = [];
  if (analysis.isNearMilestone) signals.push("PRE_MILESTONE");
  if (analysis.priceJumpPercent >= 30) signals.push("BIG_JUMP_AHEAD");
  if (analysis.costToPumpCHEF < 100 && analysis.supplyNeededForNextStep < 50) signals.push("CHEAP_PUMP");
  return signals;
}