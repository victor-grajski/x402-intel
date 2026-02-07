// x402-sentinel: Data store (file-based, swappable for DB later)

import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';

// File paths
const OPERATORS_FILE = path.join(DATA_DIR, 'operators.json');
const WATCHER_TYPES_FILE = path.join(DATA_DIR, 'watcher-types.json');
const WATCHERS_FILE = path.join(DATA_DIR, 'watchers.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

// Helpers
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) { /* ignore */ }
}

async function readJson(file, defaultValue = {}) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return defaultValue;
  }
}

async function writeJson(file, data) {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export function generateId() {
  return Math.random().toString(36).substring(2, 10) + 
         Math.random().toString(36).substring(2, 10);
}

// Operators
export async function getOperators() {
  const data = await readJson(OPERATORS_FILE, { operators: [] });
  return data.operators;
}

export async function getOperator(id) {
  const operators = await getOperators();
  return operators.find(o => o.id === id);
}

export async function getOperatorByWallet(wallet) {
  const operators = await getOperators();
  return operators.find(o => o.wallet.toLowerCase() === wallet.toLowerCase());
}

export async function createOperator(operator) {
  const data = await readJson(OPERATORS_FILE, { operators: [] });
  const newOperator = {
    id: generateId(),
    ...operator,
    status: 'active',
    createdAt: new Date().toISOString(),
    stats: {
      watchersCreated: 0,
      totalTriggers: 0,
      totalEarned: 0,
      uptimePercent: 100,
    },
  };
  data.operators.push(newOperator);
  await writeJson(OPERATORS_FILE, data);
  return newOperator;
}

export async function updateOperator(id, updates) {
  const data = await readJson(OPERATORS_FILE, { operators: [] });
  const index = data.operators.findIndex(o => o.id === id);
  if (index === -1) return null;
  data.operators[index] = { ...data.operators[index], ...updates };
  await writeJson(OPERATORS_FILE, data);
  return data.operators[index];
}

// Watcher Types
export async function getWatcherTypes(filters = {}) {
  const data = await readJson(WATCHER_TYPES_FILE, { types: [] });
  let types = data.types;
  
  if (filters.operatorId) {
    types = types.filter(t => t.operatorId === filters.operatorId);
  }
  if (filters.category) {
    types = types.filter(t => t.category === filters.category);
  }
  if (filters.status) {
    types = types.filter(t => t.status === filters.status);
  }
  
  return types;
}

export async function getWatcherType(id) {
  const types = await getWatcherTypes();
  return types.find(t => t.id === id);
}

export async function createWatcherType(type) {
  const data = await readJson(WATCHER_TYPES_FILE, { types: [] });
  const newType = {
    id: generateId(),
    ...type,
    status: 'active',
    createdAt: new Date().toISOString(),
    stats: {
      instances: 0,
      triggers: 0,
    },
  };
  data.types.push(newType);
  await writeJson(WATCHER_TYPES_FILE, data);
  return newType;
}

export async function updateWatcherType(id, updates) {
  const data = await readJson(WATCHER_TYPES_FILE, { types: [] });
  const index = data.types.findIndex(t => t.id === id);
  if (index === -1) return null;
  data.types[index] = { ...data.types[index], ...updates };
  await writeJson(WATCHER_TYPES_FILE, data);
  return data.types[index];
}

// Watchers (instances)
export async function getWatchers(filters = {}) {
  const data = await readJson(WATCHERS_FILE, { watchers: [] });
  let watchers = data.watchers;
  
  if (filters.operatorId) {
    watchers = watchers.filter(w => w.operatorId === filters.operatorId);
  }
  if (filters.typeId) {
    watchers = watchers.filter(w => w.typeId === filters.typeId);
  }
  if (filters.customerId) {
    watchers = watchers.filter(w => w.customerId === filters.customerId);
  }
  if (filters.status) {
    watchers = watchers.filter(w => w.status === filters.status);
  }
  
  return watchers;
}

export async function getWatcher(id) {
  const watchers = await getWatchers();
  return watchers.find(w => w.id === id);
}

export async function createWatcher(watcher) {
  const data = await readJson(WATCHERS_FILE, { watchers: [] });
  const newWatcher = {
    id: generateId(),
    ...watcher,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastChecked: null,
    lastTriggered: null,
    triggerCount: 0,
  };
  data.watchers.push(newWatcher);
  await writeJson(WATCHERS_FILE, data);
  return newWatcher;
}

export async function updateWatcher(id, updates) {
  const data = await readJson(WATCHERS_FILE, { watchers: [] });
  const index = data.watchers.findIndex(w => w.id === id);
  if (index === -1) return null;
  data.watchers[index] = { ...data.watchers[index], ...updates };
  await writeJson(WATCHERS_FILE, data);
  return data.watchers[index];
}

export async function deleteWatcher(id) {
  const data = await readJson(WATCHERS_FILE, { watchers: [] });
  const index = data.watchers.findIndex(w => w.id === id);
  if (index === -1) return false;
  data.watchers.splice(index, 1);
  await writeJson(WATCHERS_FILE, data);
  return true;
}

// Payments
export async function getPayments(filters = {}) {
  const data = await readJson(PAYMENTS_FILE, { payments: [] });
  let payments = data.payments;
  
  if (filters.operatorId) {
    payments = payments.filter(p => p.operatorId === filters.operatorId);
  }
  if (filters.customerId) {
    payments = payments.filter(p => p.customerId === filters.customerId);
  }
  
  return payments;
}

export async function createPayment(payment) {
  const data = await readJson(PAYMENTS_FILE, { payments: [] });
  const newPayment = {
    id: generateId(),
    ...payment,
    createdAt: new Date().toISOString(),
  };
  data.payments.push(newPayment);
  await writeJson(PAYMENTS_FILE, data);
  return newPayment;
}

// Stats helpers
export async function incrementOperatorStats(operatorId, field, amount = 1) {
  const data = await readJson(OPERATORS_FILE, { operators: [] });
  const index = data.operators.findIndex(o => o.id === operatorId);
  if (index === -1) return;
  
  data.operators[index].stats[field] = 
    (data.operators[index].stats[field] || 0) + amount;
  await writeJson(OPERATORS_FILE, data);
}

export async function incrementWatcherTypeStats(typeId, field, amount = 1) {
  const data = await readJson(WATCHER_TYPES_FILE, { types: [] });
  const index = data.types.findIndex(t => t.id === typeId);
  if (index === -1) return;
  
  data.types[index].stats[field] = 
    (data.types[index].stats[field] || 0) + amount;
  await writeJson(WATCHER_TYPES_FILE, data);
}
