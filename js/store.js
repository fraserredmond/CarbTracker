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

/** @returns {boolean} false when the write didn't happen (private mode, full storage). */
function lsSet(key, valueMixed) {
  try {
    if (valueMixed === null || valueMixed === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(valueMixed));
    return true;
  } catch {
    return false;
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
    req.onblocked = () => reject(new Error(`IndexedDB open blocked`));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: `id` });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open isn't remembered, so the next call gets a fresh try.
  dbPromise.catch(() => { dbPromise = null; });
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

// When IndexedDB can't be used (some private modes, storage trouble), queued meals live in localStorage instead.
// The two stores are read together, so a record is found wherever it landed.
const FALLBACK_KEY = `queueFallback`;
const fallbackAll = () => lsGet(FALLBACK_KEY, []);

/** @returns {Promise<Array<object>>} oldest first */
export async function queueAll() {
  let recordsArr = [];
  try {
    recordsArr = (await tx(`readonly`, (store) => store.getAll())) ?? [];
  } catch {
    recordsArr = [];
  }
  return [...recordsArr, ...fallbackAll()].sort((a, b) => a.createdAt - b.createdAt);
}

/** Rejects only when neither store would take the record. */
export async function queuePut(recordObj) {
  const fallbackArr = fallbackAll();
  const isInFallback = fallbackArr.some((row) => row.id === recordObj.id);
  if (!isInFallback) {
    try {
      await tx(`readwrite`, (store) => store.put(recordObj));
      return;
    } catch {
      // Fall through to localStorage.
    }
  }
  const nextArr = [...fallbackArr.filter((row) => row.id !== recordObj.id), recordObj];
  if (!lsSet(FALLBACK_KEY, nextArr)) throw new Error(`No storage available for the queue`);
}

export async function queueDelete(id) {
  const fallbackArr = fallbackAll();
  if (fallbackArr.some((row) => row.id === id)) lsSet(FALLBACK_KEY, fallbackArr.filter((row) => row.id !== id));
  try {
    await tx(`readwrite`, (store) => store.delete(id));
  } catch {
    // Nothing to delete from a store that can't be opened.
  }
}
