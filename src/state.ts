import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(__dirname, "..", "state.json");

export interface Position {
  tokenId: string;
  symbol: string;
  buyPriceCHEF: number;
  quantity: string; // raw amount in token units
  boughtAt: string;
}

export function loadPositions(): Position[] {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function savePositions(positions: Position[]) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(positions, null, 2));
}
