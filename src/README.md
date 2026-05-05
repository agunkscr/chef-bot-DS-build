# 🤖 Chef Universe Conservative Trading Bot

Automated trading bot for the **Chef Universe** ecosystem on the **Base** network.  
Uses a **conservative strategy**: only buys tokens with the `LOW_VALUATION` signal,
maintains a single open position at a time, take profit at +5%, stop loss at -10%.

Designed to run 24/7 on **Railway** with code hosted on **GitHub**.

---

## 🧠 Strategy

| Rule | Value |
|------|-------|
| Buy signal | Only `LOW_VALUATION` |
| Avoid signal | `SUPPLY_MILESTONE` |
| Minimum volume | 10 CHEF / 24h |
| Maximum slippage | 2% (200 bps) |
| Maximum positions | 1 open position at a time |
| Position size | 2% of $CHEF balance |
| Take profit | +5% from buy price |
| Stop loss | -10% from buy price |
| Check interval | Every 5 minutes |

---

## 📁 Project Structure

chef-bot/
├── .env.example # Environment variable template
├── .gitignore # Protect .env and node_modules
├── package.json
├── tsconfig.json
├── README.md
└── src/
├── index.ts # Main loop & scheduler
├── api.ts # Read Agent Bazaar data
├── strategy.ts # Conservative logic
├── trade.ts # Buy/sell execution via bonding curve
└── state.ts # Save active positions in JSON file


---

## 🚀 Quick Start (Local)

### Prerequisites
- **Node.js** ≥ 18
- **npm**
- Wallet on **Base** network with balance:
  - **$CHEF** (for trading)
  - Small amount of **ETH** (for gas)

### 1. Clone repository
```bash
git clone https://github.com/username/chef-bot.git
cd chef-bot

2. Install dependencies
npm install

3. Configure environment
cp .env.example .env

Edit .env and fill in:
WALLET_PRIVATE_KEY=0x...
RPC_URL=https://mainnet.base.org
MAX_POSITION_PERCENT=2
TAKE_PROFIT_PERCENT=5
MAX_SLIPPAGE_BPS=200

4. Update contract addresses
In src/trade.ts, replace:

MINT_CLUB_V2_ADDRESS → official Mint Club V2 contract address on Base

chefTokenAddress in src/strategy.ts → $CHEF token address on Base

Official addresses can be found in the Chef Universe documentation.

5. Run the bot
npm start

🌐 Deploy to Railway (24/7)
1. Push to GitHub
Make sure .env is not committed (already in .gitignore).
Push all files to your GitHub repository.

2. Deploy on Railway
Open Railway.app → New Project

Select Deploy from GitHub repo

Choose this bot repository

Railway will automatically detect package.json and run npm start

3. Set Environment Variables
In Railway dashboard, under the Variables tab, add:

Key	Value
WALLET_PRIVATE_KEY	(bot wallet private key)
RPC_URL	https://mainnet.base.org (or your own RPC)
MAX_POSITION_PERCENT	2
TAKE_PROFIT_PERCENT	5
MAX_SLIPPAGE_BPS	200

4. Done
The bot will run every 5 minutes, read the market, and execute the strategy.

🔐 Security
NEVER commit the .env file to Git.

Use a separate wallet dedicated to the bot, not your main wallet.

Store the private key only in Railway environment variables (encrypted).

state.json contains trading positions; add it to .gitignore if the repository is public.

⚠️ IMPORTANT: Before Deploying
Get the official contract addresses from the Chef Universe /for-agents documentation

Replace MINT_CLUB_V2_ADDRESS in src/trade.ts with the correct address

Replace chefTokenAddress in src/strategy.ts with the $CHEF token address on Base

Ensure the wallet has $CHEF balance (can be bought on Uniswap Base or claimed from the Rolling Burger game)

🏆 Tycoons Arena Competition
This bot automatically participates in the Tycoons Arena, Chef Universe's monthly trading leaderboard.
Every trade is recorded on the ERC-8004 smart contract. $CHEF rewards can be claimed each month (10th–14th).

📜 License
MIT — use and modify freely, at your own risk.

🤝 Contributing
Pull requests are wide open. Feel free to propose strategy improvements or gas optimizations.

