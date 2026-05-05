import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(__dirname, "..", "state.json");
const BACKUP_DIR = path.join(__dirname, "..", "backups");

export interface Position {
  tokenId: string;
  symbol: string;
  buyPriceCHEF: number;
  quantity: string;        // raw wei string
  quantityDecimal: number; // human-readable
  boughtAt: string;        // ISO
  grade: number;
  volatility24h: number;
  signalRank: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}

export interface TradeHistory {
  timestamp: string;
  action: "BUY" | "SELL";
  tokenId: string;
  symbol: string;
  amountCHEF: number;
  quantity: number;
  txHash: string;
}

export function loadPositions(): Position[] {
  try {
    if (!fs.existsSync(STATE_FILE)) return [];
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function savePositions(positions: Position[]) {
  // Backup
  if (fs.existsSync(STATE_FILE)) {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `state_${Date.now()}.json`));
    } catch {}
  }
  // Atomic write
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(positions, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function addPosition(pos: Position): Position[] {
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.tokenId === pos.tokenId);
  if (idx >= 0) {
    // Average
    const existing = positions[idx];
    const totalQty = existing.quantityDecimal + pos.quantityDecimal;
    const avgPrice = (existing.buyPriceCHEF * existing.quantityDecimal + pos.buyPriceCHEF * pos.quantityDecimal) / totalQty;
    positions[idx] = { ...existing, buyPriceCHEF: avgPrice, quantityDecimal: totalQty, boughtAt: new Date().toISOString() };
  } else {
    positions.push(pos);
  }
  savePositions(positions);
  return positions;
}

export function removePosition(tokenId: string): Position[] {
  const positions = loadPositions().filter(p => p.tokenId !== tokenId);
  savePositions(positions);
  return positions;
}

export function getPortfolioStats(positions: Position[], priceMap: Map<string, number>) {
  let invested = 0, current = 0;
  for (const p of positions) {
    invested += p.buyPriceCHEF * p.quantityDecimal;
    current += (priceMap.get(p.tokenId) || p.buyPriceCHEF) * p.quantityDecimal;
  }
  return { totalPositions: positions.length, totalInvestedCHEF: invested, totalCurrentValueCHEF: current, unrealizedPnL: current - invested };
}