// Wallet Balance Executor
// Watches for wallet balance above/below threshold

import { createPublicClient, http, formatEther } from 'viem';
import { base, mainnet, optimism, arbitrum } from 'viem/chains';

// Chain clients
const chains = {
  base: createPublicClient({ chain: base, transport: http('https://mainnet.base.org') }),
  ethereum: createPublicClient({ chain: mainnet, transport: http('https://eth.llamarpc.com') }),
  optimism: createPublicClient({ chain: optimism, transport: http('https://mainnet.optimism.io') }),
  arbitrum: createPublicClient({ chain: arbitrum, transport: http('https://arb1.arbitrum.io/rpc') }),
};

export const walletBalanceExecutor = {
  describe() {
    return {
      id: 'wallet-balance',
      name: 'Wallet Balance Alert',
      category: 'wallet',
      description: 'Get notified when a wallet balance goes above or below a threshold',
      configSchema: {
        type: 'object',
        required: ['address', 'threshold', 'direction'],
        properties: {
          address: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
            description: 'Wallet address to watch',
          },
          threshold: {
            type: 'number',
            minimum: 0,
            description: 'Balance threshold in ETH',
          },
          direction: {
            type: 'string',
            enum: ['above', 'below'],
            description: 'Alert when balance goes above or below threshold',
          },
          chain: {
            type: 'string',
            enum: ['base', 'ethereum', 'optimism', 'arbitrum'],
            default: 'base',
            description: 'Which chain to monitor',
          },
        },
      },
    };
  },

  validate(config) {
    const errors = [];
    
    if (!config.address || !config.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push('Invalid address format');
    }
    if (typeof config.threshold !== 'number' || config.threshold < 0) {
      errors.push('Threshold must be a non-negative number');
    }
    if (!['above', 'below'].includes(config.direction)) {
      errors.push('Direction must be "above" or "below"');
    }
    if (config.chain && !chains[config.chain]) {
      errors.push(`Unsupported chain: ${config.chain}`);
    }
    
    return { valid: errors.length === 0, errors };
  },

  async check(config) {
    const chain = config.chain || 'base';
    const client = chains[chain];
    
    if (!client) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    const balance = await client.getBalance({ address: config.address });
    const balanceEth = parseFloat(formatEther(balance));
    
    const triggered = config.direction === 'above'
      ? balanceEth > config.threshold
      : balanceEth < config.threshold;

    return {
      triggered,
      data: {
        address: config.address,
        chain,
        balance: balanceEth,
        threshold: config.threshold,
        direction: config.direction,
        condition: `${balanceEth.toFixed(6)} ETH is ${config.direction} ${config.threshold} ETH`,
      },
    };
  },
};
