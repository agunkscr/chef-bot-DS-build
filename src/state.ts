import * as fs from "fs";
import * as path from "path";

// ─── Configuration ───────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "..", "state.json");
const BACKUP_DIR = path.join(__dirname, "..", "backups");

// ─── Types ───────────────────────────────────────────────────
export interface Position {
  tokenId: string;          // Contract address ingredient token
  symbol: string;           // Ticker symbol
  buyPriceCHEF: number;     // Entry price in CHEF
  quantity: string;         // Raw token quantity (wei string)
  quantityDecimal: number;  // Human-readable quantity
  boughtAt: string;         // ISO timestamp
  grade: number;            // Token grade 1-5
  volatility24h: number;    // Price change 24h in percent
  signalRank: number;       // Signal rank at purchase
  takeProfitPercent: number;// Custom TP for this token
  stopLossPercent: number;  // Custom SL for this token
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

export interface PortfolioStats {
  totalPositions: number;
  totalInvestedCHEF: number;
  totalCurrentValueCHEF: number;
  unrealizedPnL: number;
  realizedPnL: number;
  winRate: number;
  history: TradeHistory[];
}

// ─── Core Functions ──────────────────────────────────────────

export function loadPositions(): Position[] {
  try {
    if (!fs.existsSync(STATE_FILE)) return [];
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("⚠️ Gagal membaca state.json:", err);
    return [];
  }
}

export function savePositions(positions: Position[]): void {
  // Backup existing file first
  if (fs.existsSync(STATE_FILE)) {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const backupFile = path.join(BACKUP_DIR, `state_${Date.now()}.json`);
      fs.copyFileSync(STATE_FILE, backupFile);
    } catch { /* backup failure not critical */ }
  }

  // Write atomically
  const tmpFile = STATE_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(positions, null, 2));
  fs.renameSync(tmpFile, STATE_FILE);
}

// ─── Position Management ─────────────────────────────────────

export function addPosition(position: Position): Position[] {
  const positions = loadPositions();
  
  // Check if position already exists for this token
  const existingIdx = positions.findIndex(p => p.tokenId === position.tokenId);
  if (existingIdx >= 0) {
    // Update existing position (average down/up)
    const existing = positions[existingIdx];
    const totalQty = existing.quantityDecimal + position.quantityDecimal;
    const avgPrice = (
      (existing.buyPriceCHEF * existing.quantityDecimal + position.buyPriceCHEF * position.quantityDecimal) /
      totalQty
    );
    positions[existingIdx] = {
      ...existing,
      buyPriceCHEF: avgPrice,
      quantityDecimal: totalQty,
      quantity: ethersParseEther(totalQty.toString()),
      boughtAt: new Date().toISOString(),
    };
    savePositions(positions);
    return positions;
  }

  positions.push(position);
  savePositions(positions);
  return positions;
}

export function removePosition(tokenId: string): Position[] {
  let positions = loadPositions();
  positions = positions.filter(p => p.tokenId !== tokenId);
  savePositions(positions);
  return positions;
}

export function updatePosition(tokenId: string, updates: Partial<Position>): Position[] {
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.tokenId === tokenId);
  if (idx >= 0) {
    positions[idx] = { ...positions[idx], ...updates };
    savePositions(positions);
  }
  return positions;
}

// ─── Stats & Analytics ───────────────────────────────────────

export function getPortfolioStats(
  positions: Position[],
  priceMap: Map<string, number>,
  tradeHistory?: TradeHistory[]
): PortfolioStats {
  let totalInvested = 0;
  let totalCurrent = 0;

  for (const pos of positions) {
    totalInvested += pos.buyPriceCHEF * pos.quantityDecimal;
    const currentPrice = priceMap.get(pos.tokenId) || pos.buyPriceCHEF;
    totalCurrent += currentPrice * pos.quantityDecimal;
  }

  const history = tradeHistory || [];
  const sellTrades = history.filter(t => t.action === "SELL");
  const totalRealizedPnL = sellTrades.reduce((sum, t) => sum + t.amountCHEF, 0);

  return {
    totalPositions: positions.length,
    totalInvestedCHEF: totalInvested,
    totalCurrentValueCHEF: totalCurrent,
    unrealizedPnL: totalCurrent - totalInvested,
    realizedPnL: totalRealizedPnL,
    winRate: sellTrades.length > 0
      ? sellTrades.filter(t => t.amountCHEF > 0).length / sellTrades.length
      : 0,
    history,
  };
}

// ─── Helper ──────────────────────────────────────────────────
function ethersParseEther(value: string): string {
  // Simple conversion without requiring ethers import
  const num = parseFloat(value);
  if (isNaN(num)) return "0";
  return (num * 1e18).toLocaleString("fullwide", { useGrouping: false });
}