// src/constants.ts

// ─── Contract Addresses (Base Mainnet) ──────────────────────
export const MCV2_BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
export const CHEF_TOKEN_ADDRESS = "0xc4a09803e2e1a491cb3119b891dcf890e3c98b07";
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Marco Polo Farcaster handle — dipantau lewat Warpcast API
export const MARCO_POLO_FARCASTER = "chefcubcookin";
// (Opsional: pantau wallet Marco Polo jika tersedia)
export const MARCO_POLO_WALLET = ""; // isi jika sudah ditemukan alamat dompetnya

// ─── ABI ─────────────────────────────────────────────────────
export const BOND_ABI = [
  "function getBuyPrice(address token, uint256 amount) external view returns (uint256)",
  "function getSellPrice(address token, uint256 amount) external view returns (uint256)",
  // ABI yang benar untuk MCV2_Bond.getSteps
  "function getSteps(address token) external view returns (tuple(uint128 rangeTo, uint128 price)[] memory)",
  "function getTokenSupply(address token) external view returns (uint256)",
  "function buy(address token, uint256 amount, uint256 minTokens, address recipient) external returns (uint256)",
  "function sell(address token, uint256 amount, uint256 minReturn, address recipient) external returns (uint256)"
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

// Multicall3 ABI (opsional)
export const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[])",
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[])"
];
