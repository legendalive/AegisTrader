const DB_NAME = 'AegisTraderDB';
const DB_VERSION = 1;

export const STORES = {
  SETTINGS: 'settings',
  SIGNALS: 'signals',
  TRADES: 'trades',
  LOGS: 'logs',
  ORDERS: 'orders',
  STATE: 'state',
  AI_DECISIONS: 'aiDecisions',
  VAULT: 'vault'
};

let dbInstance = null;

export async function initDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          if (store === STORES.SETTINGS || store === STORES.STATE || store === STORES.VAULT) {
            db.createObjectStore(store, { keyPath: 'key' });
          } else {
            db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
          }
        }
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

function getStore(storeName, mode = 'readonly') {
  if (!dbInstance) throw new Error('Database not initialized. Call initDB() first.');
  const tx = dbInstance.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

export async function setSetting(key, value) {
  const store = getStore(STORES.SETTINGS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getSetting(key, defaultValue = null) {
  const store = getStore(STORES.SETTINGS);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
    req.onerror = () => reject(req.error);
  });
}

export async function addItem(storeName, item) {
  const store = getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putItem(storeName, item) {
  const store = getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getItem(storeName, key) {
  const store = getStore(storeName);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllItems(storeName) {
  const store = getStore(storeName);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName) {
  const store = getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
