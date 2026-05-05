import { ethers } from "ethers";
import { MCV2_BOND_ADDRESS, BOND_ABI } from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://mainnet.base.org");
const bondContract = new ethers.Contract(MCV2_BOND_ADDRESS, BOND_ABI, provider);

export interface BondStep {
  rangeTo: number;   // batas atas supply dalam step ini
  price: number;      // harga konstan dalam step ini
}

export interface StepAnalysis {
  currentSupply: number;
  currentStep: number;
  currentPrice: number;
  nextStepTrigger: number;      // supply berapa harga akan naik
  supplyNeededForNextStep: number;
  costToPumpCHEF: number;       // biaya untuk memicu kenaikan harga
  priceJumpPercent: number;     // persentase kenaikan harga ke step berikutnya
  isNearMilestone: boolean;     // true jika supply < 5% dari batas step
  allSteps: BondStep[];
}

export async function analyzeBondingCurve(tokenAddress: string): Promise<StepAnalysis | null> {
  try {
    // 1. Ambil step array dari kontrak
    const [rangesRaw, pricesRaw] = await bondContract.getSteps(tokenAddress);
    // Format: rangeTo dalam wei, price dalam wei
    const steps: BondStep[] = [];
    for (let i = 0; i < rangesRaw.length; i++) {
      steps.push({
        rangeTo: parseFloat(ethers.formatEther(rangesRaw[i])),
        price: parseFloat(ethers.formatEther(pricesRaw[i]))
      });
    }

    // 2. Ambil supply saat ini
    const supplyRaw = await bondContract.getTokenSupply(tokenAddress);
    const currentSupply = parseFloat(ethers.formatEther(supplyRaw));

    // 3. Tentukan step saat ini
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
    const isNearMilestone = nextStep ? (currentSupply >= nextStep.rangeTo * 0.95) : false;

    return {
      currentSupply, currentStep, currentPrice, nextStepTrigger: nextStep?.rangeTo || Infinity,
      supplyNeededForNextStep: supplyNeeded, costToPumpCHEF: costToPump, priceJumpPercent: priceJump,
      isNearMilestone, allSteps: steps
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
  if (analysis.isNearMilestone) signals.push("PRE_MILESTONE");        // Harga akan segera naik
  if (analysis.priceJumpPercent >= 30) signals.push("BIG_JUMP_AHEAD"); // Potensi kenaikan >30%
  if (analysis.costToPumpCHEF < 100 && analysis.supplyNeededForNextStep < 50) signals.push("CHEAP_PUMP"); // Murah untuk pump
  return signals;
}