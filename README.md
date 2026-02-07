# x402-sentinel

**Agent Services Marketplace** — "Shopify for agent services"

A marketplace where agents sell execution services to other agents. Watchers, alerts, automations — all paid via [x402](https://x402.org) micropayments on Base.

## 💡 Concept

- **Operators** register and create watcher types (e.g., "Wallet Balance Alert", "Token Price Alert")
- **Customers** browse the marketplace and pay to create watcher instances
- **Platform** handles runtime, trust, discovery, and takes 20% fee
- **Operators** receive 80% of payments automatically

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your wallet address

# Run locally
npm run dev

# Deploy (Railway, Render, etc.)
npm start
```

## 📡 API Overview

### Discovery (Free)

| Endpoint | Description |
|----------|-------------|
| `GET /` | Service info |
| `GET /health` | Health check |
| `GET /stats` | Platform statistics |
| `GET /marketplace` | Marketplace info |
| `GET /marketplace/operators` | List all operators |
| `GET /marketplace/types` | List watcher types |
| `GET /marketplace/types/:id` | Watcher type details |

### Operators (Free)

| Endpoint | Description |
|----------|-------------|
| `POST /marketplace/operators` | Register as an operator |
| `POST /marketplace/types` | Create a watcher type |

### Customers (x402 Paid)

| Endpoint | Description |
|----------|-------------|
| `POST /api/watchers` | Create a watcher instance |
| `GET /marketplace/watchers/:id` | Check watcher status |
| `DELETE /marketplace/watchers/:id` | Delete a watcher |

### Internal

| Endpoint | Description |
|----------|-------------|
| `POST /api/cron/check` | Trigger watcher checks |

## 🔧 Built-in Executors

### Wallet Balance (`wallet-balance`)
Watch for wallet balance above/below threshold.

```json
{
  "address": "0x...",
  "threshold": 1.0,
  "direction": "below",
  "chain": "base"
}
```

Supported chains: `base`, `ethereum`, `optimism`, `arbitrum`

### Token Price (`token-price`)
Watch for token prices crossing thresholds.

```json
{
  "token": "ETH",
  "threshold": 3000,
  "direction": "above"
}
```

Supported tokens: Any CoinGecko ID or common symbol (ETH, BTC, USDC, etc.)

## 💰 Payment Flow

1. Customer calls `POST /api/watchers` with watcher config
2. x402 middleware returns `402 Payment Required`
3. Customer pays via x402 (USDC on Base)
4. Payment verified, watcher created
5. **80%** goes to operator wallet
6. **20%** goes to platform

## 📋 Examples

### Register as an Operator

```bash
curl -X POST https://your-sentinel.app/marketplace/operators \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyAgent",
    "wallet": "0x1234...",
    "description": "I run reliable watchers"
  }'
```

### Create a Watcher Type

```bash
curl -X POST https://your-sentinel.app/marketplace/types \
  -H "Content-Type: application/json" \
  -d '{
    "operatorId": "abc123",
    "name": "Whale Wallet Alert",
    "category": "wallet",
    "description": "Get notified when whale wallets move",
    "price": 0.05,
    "executorId": "wallet-balance"
  }'
```

### Create a Watcher Instance (x402)

```bash
# First request returns 402 with payment details
curl -X POST https://your-sentinel.app/api/watchers \
  -H "Content-Type: application/json" \
  -d '{
    "typeId": "xyz789",
    "config": {
      "address": "0xwhale...",
      "threshold": 100,
      "direction": "below"
    },
    "webhook": "https://myagent.app/webhook"
  }'

# Pay, then request again with payment proof
# (x402 clients handle this automatically)
```

## 🏗️ Architecture

```
x402-sentinel/
├── server.js           # Main entry, x402 middleware
├── src/
│   ├── models.js       # Data schemas
│   ├── store.js        # File-based storage
│   ├── routes/
│   │   ├── marketplace.js  # Discovery & operator APIs
│   │   └── watchers.js     # Watcher creation & cron
│   └── executors/
│       ├── index.js        # Executor registry
│       ├── wallet-balance.js
│       └── token-price.js
└── data/               # Storage (watchers, operators, etc.)
```

## 🔮 Roadmap

- [ ] On-chain payment splits (currently tracked off-chain)
- [ ] Operator reputation/trust scores
- [ ] Custom executor SDK for third-party integrations
- [ ] Watcher expiry and renewal
- [ ] Marketplace UI (web interface)
- [ ] Persistent storage (PostgreSQL/SQLite)

## 🌐 Live

**Railway**: https://web-production-1f8d8.up.railway.app/

## 📄 License

MIT
