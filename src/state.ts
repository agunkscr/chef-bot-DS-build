import * as fs from "fs";
import * as path from "path";

// ─── File paths ──────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "..", "state.json");
const HISTORY_FILE = path.join(__dirname, "..", "trade_history.json");
const BACKUP_DIR = path.join(__dirname, "..", "backups");

// ─── Types ───────────────────────────────────────────────────
export interface Position {
  tokenId: string;          // contract address ingredient token
  symbol: string;
  buyPriceCHEF: number;
  quantity: string;         // raw wei string
  quantityDecimal: number;  // human‑readable
  boughtAt: string;         // ISO timestamp
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

export interface TradeRecord {
  timestamp: string;   // ISO
  action: "BUY" | "SELL";
  tokenId: string;
  symbol: string;
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

// ─── Position State ──────────────────────────────────────────
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
  // backup old state
  if (fs.existsSync(STATE_FILE)) {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `state_${Date.now()}.json`));
    } catch { /* ignore backup failure */ }
  }
  // atomic write
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(positions, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export function addPosition(pos: Position): Position[] {
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.tokenId === pos.tokenId);
  if (idx >= 0) {
    // average down/up
    const existing = positions[idx];
    const totalQty = existing.quantityDecimal + pos.quantityDecimal;
    const avgPrice = (existing.buyPriceCHEF * existing.quantityDecimal + pos.buyPriceCHEF * pos.quantityDecimal) / totalQty;
    positions[idx] = {
      ...existing,
      buyPriceCHEF: avgPrice,
      quantityDecimal: totalQty,
      quantity: ethersParseEther(totalQty.toString()),
      boughtAt: new Date().toISOString(),
    };
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

export function updatePosition(tokenId: string, updates: Partial<Position>): Position[] {
  const positions = loadPositions();
  const idx = positions.findIndex(p => p.tokenId === tokenId);
  if (idx >= 0) {
    positions[idx] = { ...positions[idx], ...updates };
    savePositions(positions);
  }
  return positions;
}

// ─── Portfolio Stats ─────────────────────────────────────────
export function getPortfolioStats(
  positions: Position[],
  priceMap: Map<string, number>,
  tradeHistory?: TradeHistory[]
): PortfolioStats {
  let invested = 0, current = 0;
  for (const pos of positions) {
    invested += pos.buyPriceCHEF * pos.quantityDecimal;
    const price = priceMap.get(pos.tokenId) || pos.buyPriceCHEF;
    current += price * pos.quantityDecimal;
  }

  const history = tradeHistory || [];
  const sellTrades = history.filter(t => t.action === "SELL");
  const realizedPnL = sellTrades.reduce((sum, t) => sum + t.amountCHEF, 0);
  const winCount = sellTrades.filter(t => t.amountCHEF > 0).length;

  return {
    totalPositions: positions.length,
    totalInvestedCHEF: invested,
    totalCurrentValueCHEF: current,
    unrealizedPnL: current - invested,
    realizedPnL,
    winRate: sellTrades.length > 0 ? winCount / sellTrades.length : 0,
    history,
  };
}

// ─── Trade History (cooldown support) ────────────────────────
export function loadTradeHistory(): TradeRecord[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as TradeRecord[];
  } catch {
    return [];
  }
}

export function saveTradeHistory(history: TradeRecord[]) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export function addTradeRecord(record: TradeRecord) {
  const history = loadTradeHistory();
  history.push(record);
  // keep last 200 records only
  if (history.length > 200) {
    history.splice(0, history.length - 200);
  }
  saveTradeHistory(history);
}

export function isRecentlySold(tokenId: string, cooldownMinutes: number): boolean {
  if (cooldownMinutes <= 0) return false;
  const history = loadTradeHistory();
  const now = Date.now();
  // cari penjualan terakhir untuk token ini (dari belakang)
  for (let i = history.length - 1; i >= 0; i--) {
    const rec = history[i];
    if (rec.tokenId.toLowerCase() === tokenId.toLowerCase() && rec.action === "SELL") {
      const sellTime = new Date(rec.timestamp).getTime();
      const diffMinutes = (now - sellTime) / 60000;
      return diffMinutes < cooldownMinutes;
    }
  }
  return false;
}

// ─── Helper ──────────────────────────────────────────────────
function ethersParseEther(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return "0";
  return (num * 1e18).toLocaleString("fullwide", { useGrouping: false });
}