// x402-sentinel: Watcher executors (the actual check logic)

import { walletBalanceExecutor } from './wallet-balance.js';
import { tokenPriceExecutor } from './token-price.js';

// Registry of built-in executors
const executors = new Map();

// Register built-in executors
executors.set('wallet-balance', walletBalanceExecutor);
executors.set('token-price', tokenPriceExecutor);

/**
 * Get an executor by watcher type
 */
export function getExecutor(executorId) {
  return executors.get(executorId);
}

/**
 * Register a custom executor
 */
export function registerExecutor(id, executor) {
  if (!executor.check || typeof executor.check !== 'function') {
    throw new Error('Executor must have a check() function');
  }
  if (!executor.describe || typeof executor.describe !== 'function') {
    throw new Error('Executor must have a describe() function');
  }
  executors.set(id, executor);
}

/**
 * List all available executor IDs
 */
export function listExecutors() {
  return Array.from(executors.keys());
}

/**
 * Standard executor interface:
 * 
 * {
 *   // Human-readable description
 *   describe(): { name, category, description, configSchema }
 *   
 *   // Check if condition is met
 *   check(config): Promise<{ triggered: boolean, data: any }>
 *   
 *   // Validate config (optional)
 *   validate?(config): { valid: boolean, errors?: string[] }
 * }
 */
export { walletBalanceExecutor } from './wallet-balance.js';
export { tokenPriceExecutor } from './token-price.js';
