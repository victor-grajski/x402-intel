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
 * 
 * IDEMPOTENCY: Same request params return the same receipt without duplicate charges.
 * The fulfillmentHash is computed from (typeId, config, webhook, customerId).
 */
router.post('/watchers', async (req, res) => {
  try {
    const { typeId, config, webhook, customerId: rawCustomerId } = req.body;
    const customerId = rawCustomerId || req.headers['x-customer-id'] || 'anonymous';
    
    // Generate idempotency hash from request params
    const fulfillmentHash = store.generateFulfillmentHash({ 
      typeId, config, webhook, customerId 
    });
    
    // Check for existing receipt (idempotency)
    const existingReceipt = await store.getReceiptByHash(fulfillmentHash);
    if (existingReceipt) {
      const existingWatcher = await store.getWatcher(existingReceipt.watcherId);
      console.log(`🔄 Idempotent request - returning existing receipt ${existingReceipt.id}`);
      
      return res.status(200).json({
        success: true,
        idempotent: true,
        watcher: existingWatcher ? {
          id: existingWatcher.id,
          typeId: existingWatcher.typeId,
          status: existingWatcher.status,
        } : { id: existingReceipt.watcherId },
        receipt: existingReceipt,
        message: 'Returning existing receipt (idempotent request)',
      });
    }
    
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
      customerId,
      config,
      webhook,
    });
    
    // Record payment (in real implementation, this comes from x402 middleware)
    const network = process.env.NETWORK || 'eip155:8453';
    const payment = await store.createPayment({
      watcherId: watcher.id,
      operatorId: type.operatorId,
      customerId: watcher.customerId,
      amount: type.price,
      operatorShare: type.price * OPERATOR_SHARE,
      platformShare: type.price * PLATFORM_FEE,
      network,
    });
    
    // Create receipt for audit trail and idempotency
    const receipt = await store.createReceipt({
      watcherId: watcher.id,
      typeId: type.id,
      amount: type.price,
      chain: network,
      rail: 'x402',
      fulfillmentHash,
      customerId: watcher.customerId,
      operatorId: type.operatorId,
      paymentId: payment.id,
    });
    
    // Update stats
    await store.incrementOperatorStats(type.operatorId, 'watchersCreated');
    await store.incrementWatcherTypeStats(typeId, 'instances');
    
    console.log(`✅ Created watcher ${watcher.id} (type: ${type.name}) for ${watcher.customerId}`);
    console.log(`📄 Receipt ${receipt.id} issued (hash: ${fulfillmentHash.slice(0, 8)}...)`);
    
    res.status(201).json({
      success: true,
      idempotent: false,
      watcher: {
        id: watcher.id,
        typeId: watcher.typeId,
        status: watcher.status,
      },
      receipt,
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
