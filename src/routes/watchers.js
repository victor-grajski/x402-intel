// Watcher creation (x402 protected) and cron endpoints

import { Router } from 'express';
import * as store from '../store.js';
import { getExecutor } from '../executors/index.js';
import { PLATFORM_FEE, OPERATOR_SHARE } from '../models.js';

const router = Router();

// Platform wallet (receives 20% fee)
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || process.env.WALLET_ADDRESS;

/**
 * Create a watcher instance (x402 protected)
 * Payment goes to: 80% operator, 20% platform
 */
router.post('/watchers', async (req, res) => {
  try {
    const { typeId, config, webhook, customerId } = req.body;
    
    // Get watcher type
    const type = await store.getWatcherType(typeId);
    if (!type) {
      return res.status(404).json({ error: 'Watcher type not found' });
    }
    
    // Get operator
    const operator = await store.getOperator(type.operatorId);
    if (!operator) {
      return res.status(500).json({ error: 'Operator not found' });
    }
    
    // Validate webhook
    if (!webhook || !webhook.startsWith('http')) {
      return res.status(400).json({ error: 'Valid webhook URL required' });
    }
    
    // Validate config against executor if available
    if (type.executorId) {
      const executor = getExecutor(type.executorId);
      if (executor?.validate) {
        const validation = executor.validate(config);
        if (!validation.valid) {
          return res.status(400).json({ 
            error: 'Invalid config',
            details: validation.errors,
          });
        }
      }
    }
    
    // Create watcher
    const watcher = await store.createWatcher({
      typeId,
      operatorId: type.operatorId,
      customerId: customerId || req.headers['x-customer-id'] || 'anonymous',
      config,
      webhook,
    });
    
    // Record payment (in real implementation, this comes from x402 middleware)
    const payment = await store.createPayment({
      watcherId: watcher.id,
      operatorId: type.operatorId,
      customerId: watcher.customerId,
      amount: type.price,
      operatorShare: type.price * OPERATOR_SHARE,
      platformShare: type.price * PLATFORM_FEE,
      network: process.env.NETWORK || 'eip155:8453',
    });
    
    // Update stats
    await store.incrementOperatorStats(type.operatorId, 'watchersCreated');
    await store.incrementWatcherTypeStats(typeId, 'instances');
    
    console.log(`✅ Created watcher ${watcher.id} (type: ${type.name}) for ${watcher.customerId}`);
    
    res.status(201).json({
      success: true,
      watcher: {
        id: watcher.id,
        typeId: watcher.typeId,
        status: watcher.status,
      },
      payment: {
        amount: payment.amount,
        operatorShare: payment.operatorShare,
        platformShare: payment.platformShare,
      },
      message: `Watcher created. Monitoring will begin on next cron cycle.`,
    });
  } catch (error) {
    console.error('Error creating watcher:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cron endpoint - check all active watchers
 */
router.post('/cron/check', async (req, res) => {
  const results = { checked: 0, triggered: 0, errors: 0, skipped: 0 };
  const startTime = Date.now();
  
  try {
    const watchers = await store.getWatchers({ status: 'active' });
    
    for (const watcher of watchers) {
      try {
        // Get type to find executor
        const type = await store.getWatcherType(watcher.typeId);
        if (!type || !type.executorId) {
          results.skipped++;
          continue;
        }
        
        const executor = getExecutor(type.executorId);
        if (!executor) {
          results.skipped++;
          continue;
        }
        
        results.checked++;
        
        // Run the check
        const result = await executor.check(watcher.config);
        
        // Update watcher
        await store.updateWatcher(watcher.id, {
          lastChecked: new Date().toISOString(),
          lastCheckResult: result.data,
        });
        
        if (result.triggered) {
          // Fire webhook
          try {
            await fetch(watcher.webhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'watcher_triggered',
                watcher: {
                  id: watcher.id,
                  typeId: watcher.typeId,
                },
                data: result.data,
                timestamp: new Date().toISOString(),
                source: 'x402-sentinel',
              }),
            });
            
            // Update trigger stats
            await store.updateWatcher(watcher.id, {
              lastTriggered: new Date().toISOString(),
              triggerCount: watcher.triggerCount + 1,
            });
            await store.incrementOperatorStats(watcher.operatorId, 'totalTriggers');
            await store.incrementWatcherTypeStats(watcher.typeId, 'triggers');
            
            results.triggered++;
            console.log(`🔔 Triggered watcher ${watcher.id}: ${JSON.stringify(result.data).slice(0, 100)}`);
          } catch (webhookError) {
            console.error(`Webhook failed for ${watcher.id}:`, webhookError.message);
            results.errors++;
          }
        }
      } catch (e) {
        console.error(`Error checking watcher ${watcher.id}:`, e.message);
        results.errors++;
      }
    }
    
    res.json({
      success: true,
      ...results,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Cron check error:', error);
    res.status(500).json({ error: 'Cron check failed', ...results });
  }
});

export default router;
