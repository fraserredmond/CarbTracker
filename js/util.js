// Small helpers shared by every module. No DOM here.

export const DAY_NAMES = [`Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`];
export const MONTH_NAMES = [`Jan`, `Feb`, `Mar`, `Apr`, `May`, `Jun`, `Jul`, `Aug`, `Sep`, `Oct`, `Nov`, `Dec`];
export const MEAL_NAMES = [`Breakfast`, `Lunch`, `Dinner`, `Snack`];

/** @param {Date} date */
export function formatHeaderDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** @param {Date} date */
export function toYmd(date) {
  const pad = (n) => String(n).padStart(2, `0`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Sheet name for the month containing `date`, e.g. "Sep 2026". @param {Date} date */
export function sheetNameFor(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** @param {Date} date */
export function firstOfNextMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/** Which meal button to highlight, from the device clock. @param {Date} date */
export function suggestedMeal(date) {
  const hourNum = date.getHours();
  if (hourNum < 10) return `Breakfast`;
  if (hourNum < 15) return `Lunch`;
  return `Dinner`;
}

/** Whole grams for display, like the sheet. @param {number} carbsNum */
export function formatCarbs(carbsNum) {
  return String(Math.round(carbsNum));
}

/** Parse a decimal input; '' or junk gives null. @param {string} str */
export function parseNum(str) {
  const trimmed = String(str ?? ``).trim().replace(`,`, `.`);
  if (trimmed === ``) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

/**
 * Carbs for one row: computed from per-100g and weight when both present, else the typed carbs.
 * @param {{carbs: string, carbsPer100g: string, weightG: string}} row
 * @returns {number|null}
 */
export function rowCarbs(row) {
  const per100Num = parseNum(row.carbsPer100g);
  const weightNum = parseNum(row.weightG);
  if (per100Num !== null) {
    return (weightNum === null) ? null : per100Num * weightNum / 100;
  }
  return parseNum(row.carbs);
}

/** @param {Array<{carbs: string, carbsPer100g: string, weightG: string}>} rowsArr */
export function totalCarbs(rowsArr) {
  return rowsArr.reduce((sumNum, row) => sumNum + (rowCarbs(row) ?? 0), 0);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @param {Function} func @param {number} waitMs */
export function debounce(func, waitMs) {
  let timeout = 0;
  return (...argsArr) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...argsArr), waitMs);
  };
}
