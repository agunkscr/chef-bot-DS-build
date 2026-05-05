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
    const [rangesRaw, pricesRaw] = await bondContract.getSteps(tokenAddress);
    if (!rangesRaw || rangesRaw.length === 0) {
      console.warn(`Tidak ada steps untuk token ${tokenAddress}`);
      return null;
    }

    const steps: BondStep[] = [];
    for (let i = 0; i < rangesRaw.length; i++) {
      steps.push({
        rangeTo: parseFloat(ethers.formatEther(rangesRaw[i])),
        price: parseFloat(ethers.formatEther(pricesRaw[i]))
      });
    }

    const supplyRaw = await bondContract.getTokenSupply(tokenAddress);
    const currentSupply = parseFloat(ethers.formatEther(supplyRaw));

    let currentStep = 0;
    for (let i = 0; i < steps.length; i++) {
      if (currentSupply < steps[i].rangeTo) {
        currentStep = i;
        break;
      }
      currentStep = i;
    }

    const currentPrice = steps[currentStep]?.price || 0;
    const nextStep = steps[currentStep + 1];
    const supplyNeeded = nextStep ? nextStep.rangeTo - currentSupply : Infinity;
    const costToPump = nextStep ? supplyNeeded * currentPrice : Infinity;
    const priceJump = nextStep ? ((nextStep.price - currentPrice) / currentPrice) * 100 : 0;
    const isNearMilestone = nextStep && currentSupply >= nextStep.rangeTo * 0.95;

    return {
      currentSupply,
      currentStep,
      currentPrice,
      nextStepTrigger: nextStep?.rangeTo || Infinity,
      supplyNeededForNextStep: supplyNeeded,
      costToPumpCHEF: costToPump,
      priceJumpPercent: priceJump,
      isNearMilestone,
      allSteps: steps
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