// Screens, rows, settings dialog. Everything that touches the DOM lives here.

import { ApiError, ERROR_MESSAGES, fetchPayload, foodToRow } from './api.js';
import { ICONS } from './icons.js';
import { getDraft, getPayload, getSettings, queueAll, queuePut, setDraft, setSettings } from './store.js';
import { getSyncState, installSyncTriggers, refreshPayload, sync, syncEvents } from './sync.js';
import { COLOR_HUES, applyTheme, followSystemTheme } from './theme.js';
import {
  MEAL_NAMES, debounce, firstOfNextMonth, formatCarbs, formatHeaderDate, parseNum, rowCarbs,
  sheetNameFor, suggestedMeal, toYmd, totalCarbs, uid,
} from './util.js';

const state = {
  screen: `home`, // home | meal
  meal: ``,
  rowsArr: [],
  isDraftRestored: false,
  settings: getSettings(),
  payload: getPayload(),
  queueArr: [],
};

const el = (id) => document.getElementById(id);
const els = {
  sheetLink: el(`sheetLink`), headerDate: el(`headerDate`), devBadge: el(`devBadge`), settingsBtn: el(`settingsBtn`),
  barMealName: el(`barMealName`), barStatus: el(`barStatus`), barTotal: el(`barTotal`),
  cancelBtn: el(`cancelBtn`), saveBtn: el(`saveBtn`), banners: el(`banners`), main: el(`main`), toast: el(`toast`),
  dialog: el(`settingsDialog`), settingsCloseBtn: el(`settingsCloseBtn`), fontChoices: el(`fontChoices`),
  colorChoices: el(`colorChoices`), themeChoices: el(`themeChoices`), webAppUrlInput: el(`webAppUrlInput`),
  secretInput: el(`secretInput`), devModeInput: el(`devModeInput`), settingsSaveBtn: el(`settingsSaveBtn`),
  settingsTestResult: el(`settingsTestResult`), rowTpl: el(`rowTpl`),
  connectionToggleBtn: el(`connectionToggleBtn`), connectionFields: el(`connectionFields`),
};

const blankRow = () => ({ name: ``, carbs: ``, carbsPer100g: ``, weightG: `` });

// --- Header and bar ---

function renderHeader() {
  els.headerDate.textContent = formatHeaderDate(new Date());
  els.devBadge.hidden = !state.settings.isDevMode;
  const url = state.payload?.spreadsheetUrl ?? ``;
  els.sheetLink.href = url;
  els.sheetLink.setAttribute(`aria-disabled`, url ? `false` : `true`);
}

function renderBar() {
  if (state.screen === `meal`) {
    els.barMealName.textContent = state.meal;
    els.barStatus.textContent = ``;
    els.barStatus.classList.remove(`isError`);
    els.barTotal.textContent = formatCarbs(totalCarbs(state.rowsArr));
    els.cancelBtn.hidden = false;
    els.saveBtn.hidden = false;
    els.saveBtn.disabled = !state.rowsArr.some((row) => row.name.trim() !== ``);
    return;
  }
  const lastQueued = state.queueArr[state.queueArr.length - 1];
  const lastMeal = lastQueued ?? state.payload?.lastMeal ?? null;
  els.barMealName.textContent = lastMeal ? lastMeal.meal : `No meals yet`;
  els.barTotal.textContent = lastMeal ? formatCarbs(lastMeal.totalCarbs) : `0`;
  els.cancelBtn.hidden = true;
  els.saveBtn.hidden = true;

  const { isSyncing } = getSyncState();
  let statusStr = ``;
  if (state.queueArr.length > 0) {
    const countStr = (state.queueArr.length > 1) ? ` (${state.queueArr.length})` : ``;
    if (isSyncing) statusStr = `syncing…`;
    else if (!navigator.onLine) statusStr = `offline, queued${countStr}`;
    else statusStr = `queued${countStr}`;
  } else if (lastMeal) {
    statusStr = `last meal`;
  }
  els.barStatus.textContent = statusStr;
  els.barStatus.classList.toggle(`isError`, state.queueArr.length > 0 && !isSyncing && navigator.onLine);
}

function renderBanners() {
  els.banners.replaceChildren();
  const add = (cssClass, text) => {
    const bannerEl = document.createElement(`div`);
    bannerEl.className = `banner ${cssClass}`;
    bannerEl.innerHTML = `${ICONS.alert}<span></span>`;
    bannerEl.querySelector(`span`).textContent = text;
    els.banners.append(bannerEl);
  };
  if (!state.settings.webAppUrl) {
    add(`isInfo`, `Open settings to connect the spreadsheet. Meals are queued until then.`);
    return;
  }
  const { lastErrorCode } = getSyncState();
  if (lastErrorCode === `BAD_SECRET` || lastErrorCode === `BAD_RESPONSE`) add(`isError`, ERROR_MESSAGES[lastErrorCode]);
  if (!state.payload || state.settings.isDevMode) return;
  const today = new Date();
  const sheetNamesArr = state.payload.sheetNames ?? [];
  const currentName = sheetNameFor(today);
  if (!sheetNamesArr.includes(currentName)) {
    add(`isError`, `There's no "${currentName}" sheet yet. Meals will queue until it exists.`);
  }
  const nextName = sheetNameFor(firstOfNextMonth(today));
  if (today.getDate() > 20 && !sheetNamesArr.includes(nextName)) {
    add(`isWarn`, `Next month's sheet "${nextName}" doesn't exist yet.`);
  }
}

let toastTimeout = 0;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { els.toast.hidden = true; }, 4000);
}

// --- Home screen ---

function renderHome() {
  state.screen = `home`;
  const homeEl = document.createElement(`div`);
  homeEl.className = `home hasSuggestion`;
  const suggested = suggestedMeal(new Date());
  for (const mealName of MEAL_NAMES) {
    const btnEl = document.createElement(`button`);
    btnEl.type = `button`;
    btnEl.className = `mealBtn`;
    btnEl.dataset.meal = mealName;
    btnEl.textContent = mealName;
    if (mealName === suggested) btnEl.classList.add(`isSuggested`);
    if (mealName === `Snack`) btnEl.classList.add(`isSnack`);
    btnEl.addEventListener(`click`, () => openMeal(mealName));
    homeEl.append(btnEl);
  }
  els.main.replaceChildren(homeEl);
  renderBar();
  renderBanners();
}

function goHome(isClearDraft) {
  if (isClearDraft) setDraft(null);
  if (history.state?.screen === `meal`) history.back();
  else renderHome();
}

// --- Meal screen ---

function templateRows(mealName) {
  const templateArr = state.payload?.templates?.[mealName] ?? [];
  return templateArr.map(foodToRow);
}

function openMeal(mealName) {
  state.meal = mealName;
  const draft = getDraft();
  const isSameDraft = draft && draft.meal === mealName && draft.date === toYmd(new Date()) && Array.isArray(draft.rowsArr);
  state.rowsArr = isSameDraft ? draft.rowsArr.map((row) => ({ ...blankRow(), ...row })) : templateRows(mealName);
  state.isDraftRestored = Boolean(isSameDraft);
  ensureTrailingBlank();
  history.pushState({ screen: `meal`, meal: mealName }, ``);
  renderMeal();
  focusFirstEmptyWeight();
}

function ensureTrailingBlank() {
  const last = state.rowsArr[state.rowsArr.length - 1];
  if (!last || last.name.trim() !== ``) state.rowsArr.push(blankRow());
}

const saveDraft = debounce(() => {
  if (state.screen !== `meal`) return;
  setDraft({ date: toYmd(new Date()), meal: state.meal, rowsArr: state.rowsArr });
}, 200);

function renderMeal() {
  state.screen = `meal`;
  const wrapEl = document.createElement(`div`);
  wrapEl.className = `mealScreen`;

  const toolsEl = document.createElement(`div`);
  toolsEl.className = `mealTools`;
  if (state.isDraftRestored) {
    const restartBtn = document.createElement(`button`);
    restartBtn.type = `button`;
    restartBtn.className = `linkBtn`;
    restartBtn.innerHTML = `${ICONS.restart}<span>Start over</span>`;
    restartBtn.addEventListener(`click`, () => {
      state.rowsArr = templateRows(state.meal);
      state.isDraftRestored = false;
      ensureTrailingBlank();
      setDraft(null);
      renderMeal();
      focusFirstEmptyWeight();
    });
    toolsEl.append(restartBtn);
  }
  wrapEl.append(toolsEl);

  const rowsEl = document.createElement(`div`);
  rowsEl.className = `rows`;
  rowsEl.id = `rows`;
  for (const row of state.rowsArr) rowsEl.append(buildRowEl(row));
  wrapEl.append(rowsEl);

  els.main.replaceChildren(wrapEl);
  renderBar();
}

function focusFirstEmptyWeight() {
  const rowsEl = el(`rows`);
  if (!rowsEl) return;
  const idx = state.rowsArr.findIndex((row) => row.carbsPer100g !== `` && row.weightG === `` && row.name.trim() !== ``);
  const rowEl = rowsEl.children[idx >= 0 ? idx : state.rowsArr.length - 1];
  const inputEl = rowEl?.querySelector(idx >= 0 ? `.weightInput` : `.nameInput`);
  inputEl?.focus({ preventScroll: true });
  keepRowsVisible();
}

/** @param {object} row */
function buildRowEl(row) {
  const rowEl = els.rowTpl.content.firstElementChild.cloneNode(true);
  const nameInput = rowEl.querySelector(`.nameInput`);
  const per100Input = rowEl.querySelector(`.per100Input`);
  const weightInput = rowEl.querySelector(`.weightInput`);
  const carbsInput = rowEl.querySelector(`.carbsInput`);
  const delBtn = rowEl.querySelector(`.delBtn`);
  const favsEl = rowEl.querySelector(`.favs`);
  delBtn.innerHTML = ICONS.x;

  nameInput.value = row.name;
  per100Input.value = row.carbsPer100g;
  weightInput.value = row.weightG;

  const refresh = () => {
    const isPer100Mode = row.carbsPer100g.trim() !== ``;
    carbsInput.readOnly = isPer100Mode;
    if (isPer100Mode) {
      const carbsNum = rowCarbs(row);
      carbsInput.value = (carbsNum === null) ? `` : formatCarbs(carbsNum);
      carbsInput.placeholder = `?`;
    } else {
      carbsInput.value = row.carbs;
      carbsInput.placeholder = ``;
    }
    weightInput.classList.toggle(`isMissing`, isPer100Mode && row.weightG.trim() === `` && row.name.trim() !== ``);
    rowEl.classList.toggle(`isBlank`, row.name.trim() === `` && rowCarbs(row) === null);
    renderBar();
    saveDraft();
  };

  const onChanged = () => {
    const isLast = state.rowsArr[state.rowsArr.length - 1] === row;
    if (isLast && row.name.trim() !== ``) {
      const newRow = blankRow();
      state.rowsArr.push(newRow);
      rowEl.parentElement.append(buildRowEl(newRow));
    }
    refresh();
  };

  nameInput.addEventListener(`input`, () => { row.name = nameInput.value; renderFavs(); onChanged(); });
  per100Input.addEventListener(`input`, () => { row.carbsPer100g = per100Input.value; onChanged(); });
  weightInput.addEventListener(`input`, () => { row.weightG = weightInput.value; onChanged(); });
  carbsInput.addEventListener(`input`, () => { if (!carbsInput.readOnly) { row.carbs = carbsInput.value; onChanged(); } });

  delBtn.addEventListener(`click`, () => {
    const idx = state.rowsArr.indexOf(row);
    if (idx < 0) return;
    state.rowsArr.splice(idx, 1);
    rowEl.remove();
    const rowsEl = el(`rows`);
    const before = state.rowsArr.length;
    ensureTrailingBlank();
    if (state.rowsArr.length > before) rowsEl.append(buildRowEl(state.rowsArr[state.rowsArr.length - 1]));
    renderBar();
    saveDraft();
  });

  // Favourites under the name field.
  let activeFavIdx = -1;
  const favourites = () => state.payload?.favourites ?? [];
  const matchingFavs = () => {
    const needle = nameInput.value.trim().toLowerCase();
    return favourites().filter((fav) => needle === `` || fav.name.toLowerCase().includes(needle));
  };
  const pickFav = (fav) => {
    row.name = fav.name;
    row.carbs = String(fav.carbs ?? ``);
    row.carbsPer100g = String(fav.carbsPer100g ?? ``);
    row.weightG = ``;
    nameInput.value = row.name;
    per100Input.value = row.carbsPer100g;
    weightInput.value = row.weightG;
    hideFavs();
    onChanged();
    (row.carbsPer100g !== `` ? weightInput : carbsInput).focus();
  };
  const renderFavs = () => {
    if (document.activeElement !== nameInput) return;
    const matchesArr = matchingFavs();
    activeFavIdx = -1;
    favsEl.replaceChildren();
    for (const fav of matchesArr) {
      const liEl = document.createElement(`li`);
      const hintStr = (fav.carbsPer100g !== `` && fav.carbsPer100g !== undefined) ? `${fav.carbsPer100g}/100g` : `${fav.carbs}g`;
      liEl.innerHTML = `<span></span><small></small>`;
      liEl.firstElementChild.textContent = fav.name;
      liEl.lastElementChild.textContent = hintStr;
      // mousedown only fires for a real tap or click, never for a scroll gesture. Cancelling it keeps the name focused.
      liEl.addEventListener(`mousedown`, (evt) => evt.preventDefault());
      liEl.addEventListener(`click`, () => pickFav(fav));
      favsEl.append(liEl);
    }
    favsEl.hidden = matchesArr.length === 0;
    keepRowsVisible();
  };
  const hideFavs = () => { favsEl.hidden = true; favsEl.replaceChildren(); };
  nameInput.addEventListener(`focus`, renderFavs);
  nameInput.addEventListener(`blur`, () => window.setTimeout(hideFavs, 150));
  nameInput.addEventListener(`keydown`, (evt) => {
    const itemsArr = [...favsEl.children];
    if (evt.key === `ArrowDown` && itemsArr.length) {
      evt.preventDefault();
      activeFavIdx = (activeFavIdx + 1) % itemsArr.length;
      itemsArr.forEach((li, i) => li.classList.toggle(`isActive`, i === activeFavIdx));
      itemsArr[activeFavIdx].scrollIntoView({ block: `nearest` });
    } else if (evt.key === `ArrowUp` && itemsArr.length) {
      evt.preventDefault();
      activeFavIdx = (activeFavIdx - 1 + itemsArr.length) % itemsArr.length;
      itemsArr.forEach((li, i) => li.classList.toggle(`isActive`, i === activeFavIdx));
    } else if (evt.key === `Enter` && activeFavIdx >= 0) {
      evt.preventDefault();
      pickFav(matchingFavs()[activeFavIdx]);
    } else if (evt.key === `Escape`) {
      hideFavs();
    }
  });

  // Enter / Next moves along the row, then to the next row's name.
  for (const inputEl of [nameInput, per100Input, weightInput, carbsInput]) {
    inputEl.addEventListener(`keydown`, (evt) => {
      if (evt.key !== `Enter` || evt.defaultPrevented) return;
      evt.preventDefault();
      focusNext(rowEl, inputEl);
    });
  }

  refresh();
  return rowEl;
}

function focusNext(rowEl, fromInput) {
  const orderArr = [`.nameInput`, `.per100Input`, `.weightInput`, `.carbsInput`];
  const idx = orderArr.findIndex((sel) => rowEl.querySelector(sel) === fromInput);
  for (let i = idx + 1; i < orderArr.length; i++) {
    const nextInput = rowEl.querySelector(orderArr[i]);
    if (!nextInput.readOnly) { nextInput.focus(); return; }
  }
  rowEl.nextElementSibling?.querySelector(`.nameInput`)?.focus();
}

/** Keep the focused row visible above the keyboard, and the trailing blank row too when it fits. */
function keepRowsVisible() {
  const activeRowEl = document.activeElement?.closest?.(`.row`);
  const rowsEl = el(`rows`);
  if (!activeRowEl || !rowsEl) return;
  const mainRect = els.main.getBoundingClientRect();
  const activeRect = activeRowEl.getBoundingClientRect();
  const favsEl = activeRowEl.querySelector(`.favs`);
  const activeBottom = (favsEl && !favsEl.hidden) ? Math.max(activeRect.bottom, favsEl.getBoundingClientRect().bottom) : activeRect.bottom;
  const lastRect = rowsEl.lastElementChild.getBoundingClientRect();
  const padPx = 8;
  const canFitBoth = (lastRect.bottom - activeRect.top + padPx) <= mainRect.height;
  const targetBottom = Math.max(activeBottom, canFitBoth ? lastRect.bottom : activeBottom);
  if (targetBottom + padPx > mainRect.bottom) {
    els.main.scrollTop += targetBottom + padPx - mainRect.bottom;
  } else if (activeRect.top - padPx < mainRect.top) {
    els.main.scrollTop -= mainRect.top - activeRect.top + padPx;
  }
}

async function saveCurrentMeal() {
  const namedRowsArr = state.rowsArr.filter((row) => row.name.trim() !== ``);
  if (namedRowsArr.length === 0) { showToast(`Add a food first.`); return; }
  const foodsArr = namedRowsArr.map((row) => {
    const foodObj = { name: row.name.trim() };
    const per100Num = parseNum(row.carbsPer100g);
    if (per100Num !== null) {
      foodObj.carbsPer100g = per100Num;
      const weightNum = parseNum(row.weightG);
      if (weightNum !== null) foodObj.weightG = weightNum;
    } else {
      const carbsNum = parseNum(row.carbs);
      if (carbsNum !== null) foodObj.carbs = carbsNum;
    }
    return foodObj;
  });
  const recordObj = {
    id: uid(),
    date: toYmd(new Date()),
    meal: state.meal,
    foods: foodsArr,
    totalCarbs: totalCarbs(namedRowsArr),
    createdAt: Date.now(),
    attempts: 0,
  };
  await queuePut(recordObj);
  state.queueArr = await queueAll();
  goHome(true);
  sync();
}

// --- Settings dialog ---

function buildSettingsChoices() {
  const fontArr = [[`normal`, `Aa`, `Normal`], [`large`, `Aa`, `Large`]];
  els.fontChoices.replaceChildren(...fontArr.map(([value, glyph, label]) => {
    const btn = document.createElement(`button`);
    btn.type = `button`;
    btn.className = `btn`;
    btn.dataset.value = value;
    btn.innerHTML = `<span style="font-size:${value === `large` ? `1.25em` : `1em`}">${glyph}</span> ${label}`;
    btn.addEventListener(`click`, () => updateSetting(`fontSize`, value));
    return btn;
  }));
  els.colorChoices.replaceChildren(...COLOR_HUES.map((hue, idx) => {
    const btn = document.createElement(`button`);
    btn.type = `button`;
    btn.className = `swatch`;
    btn.dataset.value = String(idx);
    btn.style.setProperty(`--swatchHue`, String(hue));
    btn.setAttribute(`aria-label`, `Colour ${idx + 1}`);
    btn.addEventListener(`click`, () => updateSetting(`colorIdx`, idx));
    return btn;
  }));
  const themeArr = [[`light`, ICONS.sun, `Light`], [`dark`, ICONS.moon, `Dark`], [`auto`, ICONS.auto, `Auto`]];
  els.themeChoices.replaceChildren(...themeArr.map(([value, icon, label]) => {
    const btn = document.createElement(`button`);
    btn.type = `button`;
    btn.className = `btn`;
    btn.dataset.value = value;
    btn.innerHTML = `${icon}<span>${label}</span>`;
    btn.addEventListener(`click`, () => updateSetting(`theme`, value));
    return btn;
  }));
}

function updateSetting(key, valueMixed) {
  state.settings = { ...state.settings, [key]: valueMixed };
  setSettings(state.settings);
  applyTheme(state.settings);
  reflectSettingsChoices();
}

function reflectSettingsChoices() {
  const mark = (containerEl, valueStr) => {
    for (const btn of containerEl.children) btn.classList.toggle(`isActive`, btn.dataset.value === valueStr);
  };
  mark(els.fontChoices, state.settings.fontSize);
  mark(els.colorChoices, String(state.settings.colorIdx));
  mark(els.themeChoices, state.settings.theme);
}

function openSettings() {
  els.webAppUrlInput.value = state.settings.webAppUrl;
  els.secretInput.value = state.settings.secret;
  els.devModeInput.checked = state.settings.isDevMode;
  els.settingsTestResult.textContent = ``;
  els.settingsTestResult.className = `testResult`;
  setConnectionExpanded(!state.settings.webAppUrl);
  reflectSettingsChoices();
  els.dialog.showModal();
}

function setConnectionExpanded(isExpanded) {
  els.connectionFields.hidden = !isExpanded;
  els.connectionToggleBtn.textContent = isExpanded ? `Hide` : `Show`;
  els.connectionToggleBtn.setAttribute(`aria-expanded`, String(isExpanded));
}

let settingsCloseTimeout = 0;

async function saveConnectionSettings() {
  state.settings = {
    ...state.settings,
    webAppUrl: els.webAppUrlInput.value.trim(),
    secret: els.secretInput.value.trim(),
    isDevMode: els.devModeInput.checked,
  };
  setSettings(state.settings);
  renderHeader();
  els.settingsTestResult.textContent = `Testing…`;
  els.settingsTestResult.className = `testResult`;
  els.settingsSaveBtn.disabled = true;
  try {
    const payloadObj = await refreshPayload();
    if (!payloadObj) throw new ApiError(getSyncState().lastErrorCode || `NETWORK`);
    els.settingsTestResult.innerHTML = `${ICONS.check} Connected`;
    els.settingsTestResult.className = `testResult isOk`;
    sync();
    window.clearTimeout(settingsCloseTimeout);
    settingsCloseTimeout = window.setTimeout(() => { if (els.dialog.open) els.dialog.close(); }, 2000);
  } catch (err) {
    const code = (err instanceof ApiError) ? err.code : `NETWORK`;
    els.settingsTestResult.textContent = ERROR_MESSAGES[code] ?? `Failed: ${code}`;
    els.settingsTestResult.className = `testResult isError`;
  } finally {
    els.settingsSaveBtn.disabled = false;
  }
  if (state.screen === `home`) renderHome();
}

// --- Wiring ---

function onSyncChanged() {
  queueAll().then((queueArr) => {
    state.queueArr = queueArr;
    state.payload = getPayload();
    renderHeader();
    if (state.screen === `home`) { renderBar(); renderBanners(); }
  });
}

function installViewportHandling() {
  const vv = window.visualViewport;
  const update = () => {
    if (vv) document.documentElement.style.setProperty(`--vvh`, `${Math.round(vv.height)}px`);
    keepRowsVisible();
  };
  vv?.addEventListener(`resize`, update);
  window.addEventListener(`resize`, update);
  document.addEventListener(`focusin`, (evt) => {
    if (evt.target.closest?.(`.row`)) window.setTimeout(keepRowsVisible, 50);
  });
}

async function init() {
  els.sheetLink.innerHTML = ICONS.sheet;
  els.settingsBtn.innerHTML = ICONS.settings;
  els.settingsCloseBtn.innerHTML = ICONS.x;
  els.cancelBtn.innerHTML = ICONS.x;
  applyTheme(state.settings);
  followSystemTheme(() => state.settings);
  buildSettingsChoices();

  els.settingsBtn.addEventListener(`click`, openSettings);
  els.settingsSaveBtn.addEventListener(`click`, saveConnectionSettings);
  els.connectionToggleBtn.addEventListener(`click`, () => setConnectionExpanded(els.connectionFields.hidden));
  els.dialog.addEventListener(`close`, () => window.clearTimeout(settingsCloseTimeout));
  els.cancelBtn.addEventListener(`click`, () => goHome(true));
  els.saveBtn.addEventListener(`click`, saveCurrentMeal);
  window.addEventListener(`popstate`, () => { if (state.screen === `meal`) renderHome(); });
  document.addEventListener(`visibilitychange`, () => { if (document.visibilityState === `visible`) renderHeader(); });
  window.addEventListener(`online`, () => { if (state.screen === `home`) renderBar(); });
  window.addEventListener(`offline`, () => { if (state.screen === `home`) renderBar(); });

  syncEvents.addEventListener(`queue`, onSyncChanged);
  syncEvents.addEventListener(`payload`, onSyncChanged);
  syncEvents.addEventListener(`state`, onSyncChanged);
  syncEvents.addEventListener(`error`, (evt) => {
    onSyncChanged();
    const code = evt.detail.code;
    if (code !== `BAD_SECRET` && code !== `BAD_RESPONSE`) showToast(ERROR_MESSAGES[code] ?? `Sync failed: ${code}`);
  });

  installViewportHandling();
  installSyncTriggers();

  // A reload while on the meal screen lands on home; the draft survives for the next tap.
  if (history.state?.screen === `meal`) history.replaceState(null, ``);
  state.queueArr = await queueAll();
  renderHeader();
  renderHome();
  sync();

  if (`serviceWorker` in navigator) {
    navigator.serviceWorker.register(`./sw.js`).catch(() => {});
  }
}

init();

// Handy in the console while debugging.
window.ct = { state, fetchPayload, sync };
