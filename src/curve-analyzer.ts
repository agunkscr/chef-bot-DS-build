import { ethers } from "ethers";
import { MCV2_BOND_ADDRESS, BOND_ABI } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, provider);

export interface BondStep {
  rangeTo: number;
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
    // getSteps sekarang mengembalikan array of struct {rangeTo: bigint, price: bigint}
    const stepsRaw = await bondContract.getSteps(tokenAddress);
    if (!stepsRaw || stepsRaw.length === 0) {
      console.warn(`Tidak ada steps untuk token ${tokenAddress}`);
      return null;
    }

    const steps = stepsRaw.map((s: any) => ({
      rangeTo: BigInt(s.rangeTo),
      price: BigInt(s.price),
    }));

    const supplyRaw = await bondContract.getTokenSupply(tokenAddress);
    const currentSupply = BigInt(supplyRaw);

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

    const toNum = (val: bigint, decimals = 18): number => {
      const divisor = 10n ** BigInt(decimals);
      const integerPart = val / divisor;
      if (integerPart > 9007199254740991n) {
        return Number(integerPart) / (10 ** Math.min(decimals, 15));
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