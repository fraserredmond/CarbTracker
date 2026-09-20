// Persistence: localStorage for small things, IndexedDB for the unsent-meal queue.

const PREFIX = `ct.`;

function lsGet(key, fallbackMixed) {
  try {
    const json = localStorage.getItem(PREFIX + key);
    return (json === null) ? fallbackMixed : JSON.parse(json);
  } catch {
    return fallbackMixed;
  }
}

function lsSet(key, valueMixed) {
  try {
    if (valueMixed === null || valueMixed === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(valueMixed));
  } catch {
    // Private mode or full storage: the app still works for this session.
  }
}

export const DEFAULT_SETTINGS = Object.freeze({
  webAppUrl: ``,
  secret: ``,
  isDevMode: false,
  fontSize: `normal`, // normal | large
  colorIdx: 0,
  theme: `auto`, // auto | light | dark
});

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...lsGet(`settings`, {}) };
}

export function setSettings(settingsObj) {
  lsSet(`settings`, settingsObj);
}

/** Last successful fetch from the web app, kept for offline opens. */
export function getPayload() {
  return lsGet(`payload`, null);
}

export function setPayload(payloadObj) {
  lsSet(`payload`, payloadObj);
}

/** In-progress meal so a lock screen doesn't lose it. */
export function getDraft() {
  return lsGet(`draft`, null);
}

export function setDraft(draftObj) {
  lsSet(`draft`, draftObj);
}

/** Only used when the web app URL is "mock". */
export function getMockLog() {
  return lsGet(`mockLog`, []);
}

export function setMockLog(logArr) {
  lsSet(`mockLog`, logArr);
}

// --- Queue (IndexedDB) ---

const DB_NAME = `carbtracker`;
const STORE_NAME = `queue`;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: `id` });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, workFunc) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const req = workFunc(store);
    transaction.oncomplete = () => resolve(req?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

/** @returns {Promise<Array<object>>} oldest first */
export async function queueAll() {
  const recordsArr = await tx(`readonly`, (store) => store.getAll());
  return (recordsArr ?? []).sort((a, b) => a.createdAt - b.createdAt);
}

export function queuePut(recordObj) {
  return tx(`readwrite`, (store) => store.put(recordObj));
}

export function queueDelete(id) {
  return tx(`readwrite`, (store) => store.delete(id));
}
