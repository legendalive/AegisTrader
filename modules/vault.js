import { putItem, getItem, clearStore, STORES } from './state.js';

const VAULT_KEY = 'main_vault';

let memoryState = {
  unlocked: false,
  testnetKeys: null,
  liveKeys: null
};

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(key, data) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(data))
  );
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptData(key, encrypted) {
  const dec = new TextDecoder();
  const iv = new Uint8Array(encrypted.iv);
  const data = new Uint8Array(encrypted.data);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return JSON.parse(dec.decode(decrypted));
}

export async function getVaultStatus() {
  const vaultData = await getItem(STORES.VAULT, VAULT_KEY);
  return {
    exists: !!vaultData,
    unlocked: memoryState.unlocked
  };
}

export async function createVault(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  
  const emptyData = { testnet: null, live: null };
  const encrypted = await encryptData(key, emptyData);
  
  await putItem(STORES.VAULT, {
    key: VAULT_KEY,
    salt: Array.from(salt),
    encrypted
  });
  
  memoryState.unlocked = true;
  memoryState.testnetKeys = null;
  memoryState.liveKeys = null;
}

export async function unlockVault(passphrase) {
  const vaultData = await getItem(STORES.VAULT, VAULT_KEY);
  if (!vaultData) throw new Error('Vault does not exist.');

  const salt = new Uint8Array(vaultData.salt);
  const key = await deriveKey(passphrase, salt);

  try {
    const decrypted = await decryptData(key, vaultData.encrypted);
    memoryState.unlocked = true;
    memoryState.testnetKeys = decrypted.testnet;
    memoryState.liveKeys = decrypted.live;
  } catch (err) {
    throw new Error('Invalid passphrase.');
  }
}

export function lockVault() {
  memoryState.unlocked = false;
  memoryState.testnetKeys = null;
  memoryState.liveKeys = null;
}

export function isUnlocked() {
  return memoryState.unlocked;
}

export async function saveKeys(network, apiKey, apiSecret) {
  if (!memoryState.unlocked) throw new Error('Vault is locked.');
  
  const vaultData = await getItem(STORES.VAULT, VAULT_KEY);
  const salt = new Uint8Array(vaultData.salt);
  
  // We need the passphrase to re-encrypt. 
  // Since we don't store the passphrase, we must require the user to enter it again to save keys,
  // OR we keep the derived key in memory. For maximum security, we keep the derived key in memory while unlocked.
  // To do this cleanly without passing the key around, we will assume the UI handles passphrase re-entry if needed,
  // but for this MVP, we will derive a temporary session key when unlocking.
  
  // Actually, let's just use the passphrase prompt in the UI layer and pass it to a dedicated save function.
  throw new Error('Use saveKeysWithPassphrase instead.');
}

export async function saveKeysWithPassphrase(passphrase, network, apiKey, apiSecret) {
  const vaultData = await getItem(STORES.VAULT, VAULT_KEY);
  const salt = new Uint8Array(vaultData.salt);
  const key = await deriveKey(passphrase, salt);
  
  let decrypted;
  try {
    decrypted = await decryptData(key, vaultData.encrypted);
  } catch (err) {
    throw new Error('Invalid passphrase.');
  }

  if (network === 'testnet') {
    decrypted.testnet = { apiKey, apiSecret };
    memoryState.testnetKeys = { apiKey, apiSecret };
  } else {
    decrypted.live = { apiKey, apiSecret };
    memoryState.liveKeys = { apiKey, apiSecret };
  }

  const newEncrypted = await encryptData(key, decrypted);
  vaultData.encrypted = newEncrypted;
  await putItem(STORES.VAULT, vaultData);
}

export function getKeys(network) {
  if (!memoryState.unlocked) return null;
  return network === 'testnet' ? memoryState.testnetKeys : memoryState.liveKeys;
}

export async function deleteVault() {
  await clearStore(STORES.VAULT);
  lockVault();
}
