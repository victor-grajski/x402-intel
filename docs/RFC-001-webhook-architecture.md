# RFC-001: Event-Driven Webhook Architecture

**Status:** Draft  
**Author:** Victor Grajski  
**Date:** 2026-02-08  
**Tracking:** [GitHub Issue TBD]

---

## Summary

Replace x402-sentinel's polling-based watcher system with an event-driven webhook architecture that receives push notifications from chain indexers, dramatically reducing latency, cost, and wasted compute.

## 1. Current State: Polling Architecture

### How It Works Today

x402-sentinel checks on-chain state by **polling on a cron schedule**:

```
[Cron Trigger] → POST /api/cron/check
  → For each active watcher:
    → Check pollingInterval (skip if too soon)
    → Call executor.check(config)
      → wallet-balance: RPC call to getBalance()
      → token-price: HTTP call to CoinGecko API
    → If triggered → POST to customer webhook
```

Key parameters:
- **Polling intervals:** 5, 15, 30, or 60 minutes
- **Free tier minimum:** 30-minute intervals
- **Retry policy:** Up to 5 retries with exponential backoff on webhook delivery

### Problems with Polling

| Problem | Impact |
|---------|--------|
| **Latency** | 5-60 min delay between on-chain event and notification. A wallet could drain and refill between checks. |
| **Wasted compute** | 95%+ of checks find no change. Every check costs an RPC call. |
| **RPC rate limits** | Linear scaling: 100 watchers × 12 checks/hour = 1,200 RPC calls/hour. At 1,000 watchers this becomes unsustainable on free RPC endpoints. |
| **Missed events** | Fast-moving conditions (flash loans, MEV) are invisible at 5-min granularity. |
| **Cost scaling** | More watchers = more cron compute, regardless of activity. Idle watchers cost as much as active ones. |

### What Works Well (Keep This)

- **Webhook delivery with retry** — the outbound delivery system is solid
- **Executor abstraction** — `check()` / `validate()` / `describe()` interface is clean
- **Idempotency** — fulfillment hash dedup is good infrastructure
- **SLA tracking** — uptime/downtime measurement works regardless of trigger source

## 2. Proposed: Event-Driven Webhook Architecture

### Core Idea

Instead of asking "has anything changed?" every N minutes, **subscribe to push notifications** from chain indexers that tell us when something changes.

```
[Chain Indexer] → POST /api/ingest/:source
  → Match event against active watchers
  → For matched watchers → evaluate condition
  → If triggered → POST to customer webhook
```

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Chain Indexers                   │
│  (Alchemy, QuickNode, Helius, The Graph, etc.)  │
└──────────────┬──────────────────┬───────────────┘
               │ webhooks         │ websockets
               ▼                  ▼
┌─────────────────────────────────────────────────┐
│              Ingest Layer (NEW)                   │
│  • /api/ingest/alchemy                           │
│  • /api/ingest/quicknode                         │
│  • /api/ingest/custom                            │
│  • Normalizes events → internal format           │
│  • HMAC signature verification                   │
└──────────────────────┬──────────────────────────┘
                       │ normalized events
                       ▼
┌─────────────────────────────────────────────────┐
│              Event Router (NEW)                   │
│  • Indexes active watchers by (chain, address)   │
│  • Matches incoming events to watchers           │
│  • Evaluates trigger conditions                  │
│  • O(1) lookup per event vs O(n) polling         │
└──────────────────────┬──────────────────────────┘
                       │ triggered watchers
                       ▼
┌─────────────────────────────────────────────────┐
│          Delivery Layer (EXISTS)                  │
│  • Webhook POST with retry + backoff            │
│  • SLA tracking                                  │
│  • Receipt generation                            │
└─────────────────────────────────────────────────┘
```

### New Components

#### 2.1 Ingest Endpoints

```js
// src/routes/ingest.js
router.post('/ingest/alchemy', verifyAlchemySignature, async (req, res) => {
  const events = normalizeAlchemyPayload(req.body);
  await eventRouter.process(events);
  res.status(200).send('ok'); // Ack quickly, process async
});
```

Each indexer adapter normalizes to a common event format:

```ts
interface ChainEvent {
  source: 'alchemy' | 'quicknode' | 'custom';
  chain: string;           // 'base' | 'ethereum' | ...
  type: string;            // 'address_activity' | 'token_transfer' | 'price_update'
  address?: string;        // relevant address
  token?: string;          // token contract or symbol
  value?: bigint;          // transfer value
  blockNumber: number;
  txHash?: string;
  timestamp: string;
  raw: object;             // original payload for debugging
}
```

#### 2.2 Event Router

The router maintains an **in-memory index** of active watchers, keyed by what they care about:

```js
// Watcher index (rebuilt on startup, updated on create/cancel)
const watcherIndex = {
  // wallet-balance watchers indexed by (chain, address)
  'base:0xabc...': [watcher1, watcher2],
  'ethereum:0xdef...': [watcher3],
  
  // token-price watchers indexed by token
  'price:ETH': [watcher4, watcher5],
};
```

When an event arrives:
1. Look up matching watchers in O(1)
2. Evaluate each watcher's condition (above/below threshold)
3. If triggered, deliver webhook

#### 2.3 Subscription Manager

Manages the lifecycle of indexer subscriptions:

```js
// When a watcher is created → ensure we have a subscription
async function ensureSubscription(watcher) {
  const key = getSubscriptionKey(watcher); // e.g., 'alchemy:base:0xabc'
  if (!activeSubscriptions.has(key)) {
    await createIndexerSubscription(watcher);
    activeSubscriptions.set(key, { refCount: 1 });
  } else {
    activeSubscriptions.get(key).refCount++;
  }
}

// When a watcher is cancelled → maybe remove subscription
async function releaseSubscription(watcher) {
  const key = getSubscriptionKey(watcher);
  const sub = activeSubscriptions.get(key);
  if (sub && --sub.refCount <= 0) {
    await deleteIndexerSubscription(key);
    activeSubscriptions.delete(key);
  }
}
```

Reference counting prevents duplicate subscriptions and cleans up unused ones.

## 3. Comparison: Polling vs Webhooks vs Hybrid

| Dimension | Polling (current) | Pure Webhooks | **Hybrid (recommended)** |
|-----------|-------------------|---------------|--------------------------|
| **Latency** | 5-60 min | ~1-5 sec | ~1-5 sec for supported events, 5-60 min fallback |
| **Cost at 100 watchers** | ~1,200 RPC/hr | ~0 (push) | Minimal |
| **Cost at 10,000 watchers** | ~120,000 RPC/hr 💀 | ~0 (push) | Minimal |
| **Missed events** | Common | Rare (indexer reliability) | Rare + polling catches gaps |
| **Complexity** | Low | Medium | Medium |
| **Vendor dependency** | Public RPCs only | Indexer APIs required | Graceful degradation |
| **Token price support** | ✅ CoinGecko polling | ❌ No push API | ✅ Polling for prices, push for on-chain |
| **New chain support** | Easy (add RPC) | Need indexer support | Mix and match |

### Recommendation: Hybrid

**Use webhooks for on-chain events** (balance changes, transfers, contract events) and **keep polling for off-chain data** (token prices, social signals, API-based checks).

This is the pragmatic path because:
1. Not everything has a push API (CoinGecko doesn't push)
2. Polling serves as a safety net if indexer webhooks fail
3. We can migrate executor-by-executor without breaking existing watchers

## 4. Migration Path

### Phase 1: Ingest Infrastructure (Week 1-2)
**Goal:** Accept webhook events without changing existing behavior.

- [ ] Create `src/routes/ingest.js` with endpoints per indexer
- [ ] Define `ChainEvent` normalized format
- [ ] Add HMAC signature verification for each indexer
- [ ] Create `src/event-router.js` with watcher index
- [ ] Log all incoming events (shadow mode — process but don't deliver)
- [ ] Add `/api/ingest/test` endpoint for local development

**Zero risk.** Existing polling continues unchanged.

### Phase 2: Alchemy Integration for Wallet Balance (Week 3-4)
**Goal:** First real webhook-driven executor.

- [ ] Sign up for Alchemy Notify (free tier: 100 webhooks)
- [ ] Create Alchemy Address Activity webhook pointing to `/api/ingest/alchemy`
- [ ] Write `normalizeAlchemyPayload()` adapter
- [ ] Build subscription manager (create/delete Alchemy webhooks via API)
- [ ] Wire up wallet-balance executor to trigger from events AND polling
- [ ] Run both in parallel, compare results, measure latency improvement
- [ ] Add `triggerSource: 'webhook' | 'poll'` to watcher trigger metadata

**Dual-mode.** Both webhook and polling active. Webhook wins on speed, polling catches anything missed.

### Phase 3: Cut Over Wallet Balance (Week 5-6)
**Goal:** Webhooks become primary for wallet-balance watchers.

- [ ] After 2 weeks of parallel running, verify webhook reliability ≥ 99%
- [ ] Make webhook the primary trigger source
- [ ] Reduce polling frequency to 1x/hour as backup (not primary)
- [ ] Update SLA tracking to account for webhook-driven checks
- [ ] Update pricing model (faster alerts could justify higher price)

### Phase 4: Expand to More Event Types (Week 7+)
**Goal:** Cover more use cases with push events.

- [ ] ERC-20 token transfers (Alchemy/QuickNode)
- [ ] Smart contract event logs (custom topics)
- [ ] NFT activity (mints, transfers)
- [ ] DEX swaps (Uniswap, Aerodrome via event logs)
- [ ] New executor: `contract-event` — watch for arbitrary contract emissions

### Phase 5: Multi-Provider Resilience (Future)
**Goal:** No single point of failure.

- [ ] Support multiple indexer providers per chain
- [ ] Automatic failover if one provider goes down
- [ ] Provider health monitoring
- [ ] Cost optimization (route to cheapest healthy provider)

## 5. Integration Points: Webhook Providers

### Tier 1: Recommended Starting Points

| Provider | Chains | Free Tier | Webhook Support | Notes |
|----------|--------|-----------|-----------------|-------|
| **[Alchemy Notify](https://docs.alchemy.com/reference/notify-api-quickstart)** | ETH, Base, Optimism, Arbitrum, + more | 100 webhooks | Address Activity, Mined Tx, Dropped Tx | **Best fit.** Covers our exact chain set. Webhook management API is clean. |
| **[QuickNode Streams](https://www.quicknode.com/streams)** | 20+ chains | Limited free | Custom filters, real-time | More flexible filtering. Good for contract events. |

### Tier 2: Specialized

| Provider | Use Case | Notes |
|----------|----------|-------|
| **[The Graph](https://thegraph.com/)** | Indexed contract data | Subgraph subscriptions. Better for complex queries than real-time alerts. |
| **[Chainlink Functions](https://chain.link/functions)** | Custom off-chain compute | Could replace CoinGecko polling with decentralized price feeds. |
| **[Moralis Streams](https://moralis.io/streams/)** | Multi-chain events | Good API, generous free tier, wide chain support. |
| **[Helius](https://www.helius.dev/)** | Solana | If we expand to Solana. |

### Tier 3: Build Your Own (Future)

| Approach | Use Case |
|----------|----------|
| **Direct WebSocket to RPC** | `eth_subscribe` for new blocks/logs. No vendor dependency but requires persistent connections. |
| **Run your own indexer** | [Ponder](https://ponder.sh/), [Goldsky](https://goldsky.com/). Full control but operational overhead. |

### Recommendation

**Start with Alchemy Notify.** It covers Base, Ethereum, Optimism, and Arbitrum — our exact supported chains. The API is well-documented, the free tier is sufficient for launch, and it handles address activity which maps directly to our wallet-balance executor.

Add QuickNode Streams when we need custom contract event filtering (Phase 4).

## 6. Data Model Changes

### New: Watcher `triggerSource` field

```js
// Add to WatcherSchema
triggerSource: 'string', // 'poll' | 'webhook' | 'hybrid'
lastWebhookEvent: 'string?', // timestamp of last webhook-sourced trigger
```

### New: Subscription tracking

```js
// src/store.js - new collection
const SubscriptionSchema = {
  id: 'string',
  provider: 'string',      // 'alchemy' | 'quicknode'
  providerSubId: 'string', // ID from the indexer
  chain: 'string',
  address: 'string',
  refCount: 'number',      // how many watchers use this
  status: 'string',        // 'active' | 'failed' | 'pending'
  createdAt: 'string',
  lastEventAt: 'string?',
};
```

### New: Event log (optional, for debugging)

```js
const EventLogSchema = {
  id: 'string',
  source: 'string',
  chain: 'string',
  type: 'string',
  matchedWatchers: 'number',
  triggeredWatchers: 'number',
  receivedAt: 'string',
  processedAt: 'string',
  latencyMs: 'number',
};
```

## 7. Open Questions

### For Contributors

1. **Should we expose `triggerSource` to customers?** Customers might pay more for webhook-speed alerts vs polling-speed. This could be a pricing axis.

2. **Event deduplication.** Indexers can send duplicate events (retries, reorgs). How aggressive should dedup be? Options: txHash-based, time-window, or idempotency keys from the indexer.

3. **Reorg handling.** What happens if a webhook fires for a transaction that gets reorged? Do we send a "retraction" webhook to the customer? Or just document that events are "best effort" until N confirmations?

4. **Subscription cost allocation.** If 50 watchers share one Alchemy subscription for the same address, who "pays" for the subscription? Currently irrelevant on free tiers but matters at scale.

5. **WebSocket vs Webhook for indexer connection.** Alchemy supports both. Webhooks are simpler (stateless, HTTP) but WebSockets have lower latency. Worth the operational complexity?

6. **Token price webhooks.** CoinGecko doesn't push. Options: (a) keep polling, (b) use Chainlink price feeds via contract events, (c) use a DEX price oracle and subscribe to swap events. What's the right tradeoff?

7. **Backfill on startup.** If the server restarts and misses webhook events, how do we catch up? Options: (a) polling sweep on startup, (b) indexer "replay" APIs, (c) accept brief gaps.

8. **Rate limiting ingest endpoints.** We need to protect `/api/ingest/*` from abuse while keeping legitimate indexer traffic flowing. IP allowlisting? HMAC-only? Both?

### Architecture Decisions Needed

- **Queue vs inline processing:** Should ingest endpoints push to a queue (Redis, BullMQ) or process inline? Inline is simpler; queue is more resilient. At what scale does the queue become necessary?
- **Persistent storage:** This RFC assumes the current file-based store. The event-driven model generates more writes. Should we prioritize the PostgreSQL migration (already on the roadmap) before or alongside this work?

---

## Appendix: Example Alchemy Webhook Payload

```json
{
  "webhookId": "wh_abc123",
  "id": "whevt_xyz",
  "createdAt": "2026-02-08T05:00:00.000Z",
  "type": "ADDRESS_ACTIVITY",
  "event": {
    "network": "BASE_MAINNET",
    "activity": [
      {
        "fromAddress": "0xsender...",
        "toAddress": "0xwatched...",
        "blockNum": "0x1234",
        "hash": "0xtxhash...",
        "value": 1.5,
        "asset": "ETH",
        "category": "external"
      }
    ]
  }
}
```

Normalized to:

```json
{
  "source": "alchemy",
  "chain": "base",
  "type": "address_activity",
  "address": "0xwatched...",
  "value": 1500000000000000000,
  "blockNumber": 4660,
  "txHash": "0xtxhash...",
  "timestamp": "2026-02-08T05:00:00.000Z",
  "raw": { /* original payload */ }
}
```

---

*This RFC is a living document. Open a PR or issue to discuss.*
