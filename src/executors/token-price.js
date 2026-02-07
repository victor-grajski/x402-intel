// Token Price Executor
// Watches for token prices from CoinGecko (free API)

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Common token ID mappings
const TOKEN_IDS = {
  'eth': 'ethereum',
  'btc': 'bitcoin',
  'usdc': 'usd-coin',
  'usdt': 'tether',
  'dai': 'dai',
  'weth': 'weth',
  'matic': 'matic-network',
  'sol': 'solana',
  'avax': 'avalanche-2',
  'op': 'optimism',
  'arb': 'arbitrum',
  'link': 'chainlink',
  'uni': 'uniswap',
  'aave': 'aave',
};

export const tokenPriceExecutor = {
  describe() {
    return {
      id: 'token-price',
      name: 'Token Price Alert',
      category: 'price',
      description: 'Get notified when a token price crosses a threshold',
      configSchema: {
        type: 'object',
        required: ['token', 'threshold', 'direction'],
        properties: {
          token: {
            type: 'string',
            description: 'Token symbol (e.g., ETH, BTC) or CoinGecko ID',
          },
          threshold: {
            type: 'number',
            minimum: 0,
            description: 'Price threshold in USD',
          },
          direction: {
            type: 'string',
            enum: ['above', 'below'],
            description: 'Alert when price goes above or below threshold',
          },
          currency: {
            type: 'string',
            default: 'usd',
            description: 'Quote currency (default: usd)',
          },
        },
      },
      notes: 'Uses CoinGecko free API. Rate limited to ~10-30 calls/minute.',
    };
  },

  validate(config) {
    const errors = [];
    
    if (!config.token || typeof config.token !== 'string') {
      errors.push('Token is required');
    }
    if (typeof config.threshold !== 'number' || config.threshold < 0) {
      errors.push('Threshold must be a non-negative number');
    }
    if (!['above', 'below'].includes(config.direction)) {
      errors.push('Direction must be "above" or "below"');
    }
    
    return { valid: errors.length === 0, errors };
  },

  async check(config) {
    // Resolve token symbol to CoinGecko ID
    const tokenLower = config.token.toLowerCase();
    const coinId = TOKEN_IDS[tokenLower] || tokenLower;
    const currency = config.currency || 'usd';
    
    // Fetch price from CoinGecko
    const url = `${COINGECKO_API}/simple/price?ids=${coinId}&vs_currencies=${currency}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data[coinId] || data[coinId][currency] === undefined) {
      throw new Error(`Price not found for ${config.token}`);
    }
    
    const price = data[coinId][currency];
    
    const triggered = config.direction === 'above'
      ? price > config.threshold
      : price < config.threshold;

    return {
      triggered,
      data: {
        token: config.token.toUpperCase(),
        coinId,
        price,
        currency: currency.toUpperCase(),
        threshold: config.threshold,
        direction: config.direction,
        condition: `${config.token.toUpperCase()} at $${price.toLocaleString()} is ${config.direction} $${config.threshold.toLocaleString()}`,
      },
    };
  },
};
