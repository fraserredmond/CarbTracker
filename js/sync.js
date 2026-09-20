// Pushes queued meals to the web app, oldest first, then refreshes the cached payload.

import { fetchPayload, saveMeal, ApiError } from './api.js';
import { getSettings, queueAll, queueDelete, queuePut, setPayload } from './store.js';

export const syncEvents = new EventTarget();
let isSyncing = false;
let lastErrorCode = ``;

export function getSyncState() {
  return { isSyncing, lastErrorCode };
}

function emit(name, detailObj = {}) {
  syncEvents.dispatchEvent(new CustomEvent(name, { detail: detailObj }));
}

/** Refresh templates, favourites, sheet list and last meal. Silent on failure. */
export async function refreshPayload() {
  const settings = getSettings();
  if (!settings.webAppUrl || !navigator.onLine) return null;
  try {
    const payloadObj = await fetchPayload(settings);
    payloadObj.fetchedAt = Date.now();
    payloadObj.isDevMode = settings.isDevMode;
    setPayload(payloadObj);
    lastErrorCode = ``;
    emit(`payload`, { payloadObj });
    return payloadObj;
  } catch (err) {
    lastErrorCode = (err instanceof ApiError) ? err.code : `NETWORK`;
    emit(`error`, { code: lastErrorCode, message: err.message });
    return null;
  }
}

/** Send every queued meal in order; stop at the first failure so order is kept. */
export async function sync() {
  if (isSyncing) return;
  const settings = getSettings();
  if (!settings.webAppUrl || !navigator.onLine) return;
  isSyncing = true;
  emit(`state`);
  let savedCount = 0;
  try {
    const queuedArr = await queueAll();
    for (const recordObj of queuedArr) {
      try {
        await saveMeal(settings, {
          id: recordObj.id,
          date: recordObj.date,
          meal: recordObj.meal,
          foods: recordObj.foods,
        });
        await queueDelete(recordObj.id);
        savedCount++;
        lastErrorCode = ``;
        emit(`queue`);
      } catch (err) {
        lastErrorCode = (err instanceof ApiError) ? err.code : `NETWORK`;
        recordObj.attempts = (recordObj.attempts ?? 0) + 1;
        recordObj.lastErrorCode = lastErrorCode;
        await queuePut(recordObj);
        emit(`error`, { code: lastErrorCode, message: err.message });
        break;
      }
    }
  } finally {
    isSyncing = false;
    emit(`state`);
  }
  if (savedCount > 0 || !lastErrorCode) await refreshPayload();
}

export function installSyncTriggers() {
  window.addEventListener(`online`, () => { sync(); });
  document.addEventListener(`visibilitychange`, () => {
    if (document.visibilityState === `visible`) sync();
  });
}
