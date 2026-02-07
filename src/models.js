// x402-sentinel: Core data models for the marketplace

/**
 * Operator - An agent or entity that provides watcher services
 */
export const OperatorSchema = {
  id: 'string',           // unique ID
  name: 'string',         // display name
  wallet: 'string',       // payment address (80% goes here)
  description: 'string',  // what they offer
  website: 'string?',     // optional URL
  status: 'string',       // active, suspended, pending
  createdAt: 'string',    // ISO timestamp
  stats: {
    watchersCreated: 'number',
    totalTriggers: 'number', 
    totalEarned: 'number',   // in USD
    uptimePercent: 'number', // 0-100
  },
};

/**
 * WatcherType - A template for a kind of watcher an operator offers
 */
export const WatcherTypeSchema = {
  id: 'string',           // unique ID
  operatorId: 'string',   // who created this type
  name: 'string',         // e.g., "Wallet Balance Alert"
  category: 'string',     // wallet, price, contract, social, custom
  description: 'string',  // what it does
  price: 'number',        // cost in USD to create an instance
  configSchema: 'object', // JSON schema for required config
  status: 'string',       // active, deprecated
  createdAt: 'string',
  stats: {
    instances: 'number',   // how many active watchers
    triggers: 'number',    // total triggers across all instances
  },
};

/**
 * Watcher - An instance of a watcher type, created by a paying customer
 */
export const WatcherSchema = {
  id: 'string',
  typeId: 'string',       // which watcher type
  operatorId: 'string',   // who runs it
  customerId: 'string',   // who paid for it (wallet or agent ID)
  config: 'object',       // type-specific configuration
  webhook: 'string',      // where to send alerts
  status: 'string',       // active, paused, expired
  createdAt: 'string',
  expiresAt: 'string?',   // optional expiry
  lastChecked: 'string?',
  lastTriggered: 'string?',
  triggerCount: 'number',
};

/**
 * Payment - Record of a transaction
 */
export const PaymentSchema = {
  id: 'string',
  watcherId: 'string',
  operatorId: 'string',
  customerId: 'string',
  amount: 'number',       // total paid in USD
  operatorShare: 'number', // 80%
  platformShare: 'number', // 20%
  txHash: 'string?',      // blockchain tx if applicable
  network: 'string',
  createdAt: 'string',
};

// Default categories
export const CATEGORIES = [
  'wallet',    // balance, transfers
  'price',     // token prices, DEX rates
  'contract',  // smart contract events
  'social',    // mentions, follows
  'defi',      // yields, liquidations
  'custom',    // catch-all
];

// Revenue split
export const PLATFORM_FEE = 0.20; // 20%
export const OPERATOR_SHARE = 0.80; // 80%
