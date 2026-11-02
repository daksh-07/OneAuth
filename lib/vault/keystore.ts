'use client';

/**
 * Browser persistence for this device's Cloud key pair. CryptoKey objects are
 * stored by structured clone, so the non-extractable private key can be used
 * by this origin in this browser but can't be read out, even by our own code.
 *
 * The vault key itself is never persisted: it is unwrapped from the server's
 * envelope into memory on each visit.
 */
const DB = 'oneauth-vault';
const STORE = 'device-keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function loadDeviceKeys(userId: string): Promise<CryptoKeyPair | undefined> {
  return run('readonly', (s) => s.get(userId) as IDBRequest<CryptoKeyPair | undefined>);
}

export async function saveDeviceKeys(userId: string, keys: CryptoKeyPair): Promise<void> {
  await run('readwrite', (s) => s.put(keys, userId));
}

/** Forgets this browser's key pair (it will need approving again). */
export async function clearDeviceKeys(userId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(userId));
}
