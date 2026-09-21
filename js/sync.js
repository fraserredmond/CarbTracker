// Pushes queued meals to the web app, oldest first, then refreshes the cached payload.

import { fetchPayload, saveMeal, ApiError } from './api.js';
import { getPayload, getSettings, queueAll, queueDelete, queuePut, setPayload } from './store.js';

export const syncEvents = new EventTarget();
let isSyncing = false;
let isSyncRequested = false;
let lastErrorCode = ``;

const RETRY_MIN_MS = 15 * 1000;
const RETRY_MAX_MS = 10 * 60 * 1000;
let retryDelayMs = RETRY_MIN_MS;
let retryTimeout = 0;

// A record the web app itself keeps rejecting is dropped once it's this old, so it can't block later meals forever.
// Connection, secret and missing-month-sheet failures never count: those are fixable and say nothing about the record.
const DROP_AFTER_MS = 20 * 60 * 60 * 1000;
const NEVER_DROP_CODES = [`NETWORK`, `BAD_RESPONSE`, `BAD_SECRET`, `NO_URL`, `NO_SHEET`];

function isDroppable(recordObj, code) {
  return !NEVER_DROP_CODES.includes(code) && (Date.now() - recordObj.createdAt) > DROP_AFTER_MS;
}

function scheduleRetry() {
  window.clearTimeout(retryTimeout);
  retryTimeout = window.setTimeout(() => { sync(); }, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
}

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
  if (isSyncing) { isSyncRequested = true; return; } // Run again afterwards: this run's queue snapshot may miss a new meal.
  const settings = getSettings();
  if (!settings.webAppUrl || !navigator.onLine) return;
  window.clearTimeout(retryTimeout);
  isSyncing = true;
  isSyncRequested = false;
  emit(`state`);
  let savedCount = 0;
  let isFailed = false;
  try {
    const queuedArr = await queueAll();
    for (const recordObj of queuedArr) {
      try {
        await saveMeal(settings, {
          id: recordObj.id,
          date: recordObj.date,
          meal: recordObj.meal,
          foods: recordObj.foods,
        }, recordObj.isDevMode ?? settings.isDevMode);
        await queueDelete(recordObj.id);
        // Until the refresh below returns, the cached payload still names the previous meal. Patch it now.
        const cachedPayload = getPayload();
        if (cachedPayload) {
          cachedPayload.lastMeal = { date: recordObj.date, meal: recordObj.meal, totalCarbs: recordObj.totalCarbs };
          setPayload(cachedPayload);
        }
        savedCount++;
        lastErrorCode = ``;
        emit(`queue`);
      } catch (err) {
        lastErrorCode = (err instanceof ApiError) ? err.code : `NETWORK`;
        if (isDroppable(recordObj, lastErrorCode)) {
          await queueDelete(recordObj.id);
          lastErrorCode = ``;
          emit(`dropped`, { recordObj });
          continue;
        }
        recordObj.attempts = (recordObj.attempts ?? 0) + 1;
        recordObj.lastErrorCode = lastErrorCode;
        await queuePut(recordObj);
        emit(`error`, { code: lastErrorCode, message: err.message });
        isFailed = true;
        break;
      }
    }
  } finally {
    isSyncing = false;
    emit(`state`);
  }
  if (savedCount > 0 || !lastErrorCode) await refreshPayload();
  if (isSyncRequested) { await sync(); return; }
  if (isFailed) scheduleRetry();
  else retryDelayMs = RETRY_MIN_MS;
}

export function installSyncTriggers() {
  window.addEventListener(`online`, () => { sync(); });
  document.addEventListener(`visibilitychange`, () => {
    if (document.visibilityState === `visible`) sync();
  });
}
