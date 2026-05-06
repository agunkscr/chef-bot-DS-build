// src/constants.ts

// ─── Contract Addresses (Base Mainnet) ──────────────────────
export const MCV2_BOND_ADDRESS = "0xc5a076cad94176c2996B32d8466Be1cE757FAa27";
export const CHEF_TOKEN_ADDRESS = "0xc4A09803e2e1A491CB3119b891dcf890E3C98B07"; // ✅ CHEF Universe resmi
export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Marco Polo Farcaster handle — dipantau lewat Warpcast API
export const MARCO_POLO_FARCASTER = "chefcubcookin";
export const MARCO_POLO_WALLET = "";

// ─── ABI ─────────────────────────────────────────────────────
export const BOND_ABI = [
  "function priceForNextMint(address token) external view returns (uint128)",
  "function getSteps(address token) external view returns (tuple(uint128 rangeTo, uint128 price)[] memory)",
  "function getTokenSupply(address token) external view returns (uint256)",
  "function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount, address receiver) external returns (uint256)",
  "function burn(address token, uint256 burnAmount, uint256 minReserveOut, address receiver) external returns (uint256)"
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

export const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[])",
  "function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) external payable returns (tuple(bool success, bytes returnData)[])"
];