// Talks to the Apps Script web app. Every call is a POST with a text/plain JSON body,
// which keeps the browser from sending a CORS preflight that Apps Script can't answer.

import { getMockLog, setMockLog } from './store.js';
import { MEAL_NAMES, sheetNameFor, toYmd, totalCarbs, firstOfNextMonth } from './util.js';

export class ApiError extends Error {
  /** @param {string} code @param {string} [message] */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

export const ERROR_MESSAGES = {
  NO_URL: `Set the web app URL in settings.`,
  BAD_SECRET: `The secret was rejected. Check it in settings.`,
  NO_SHEET: `No sheet for that month yet. The meal is queued.`,
  NO_ROOM: `That month's sheet has no free rows left.`,
  NETWORK: `Couldn't reach the web app.`,
  BAD_RESPONSE: `The web app sent something that isn't JSON. Is the URL right?`,
};

/**
 * @param {object} settings
 * @param {'fetch'|'save'} action
 * @param {object} extraObj
 */
export async function callWebApp(settings, action, extraObj = {}) {
  if (!settings.webAppUrl) throw new ApiError(`NO_URL`);
  if (settings.webAppUrl === `mock`) return mockCall(action, extraObj);

  const bodyObj = {
    secret: settings.secret,
    action,
    sheet: settings.isDevMode ? `Testing` : ``,
    ...extraObj,
  };
  let res;
  try {
    res = await fetch(settings.webAppUrl, {
      method: `POST`,
      headers: { 'Content-Type': `text/plain;charset=utf-8` },
      body: JSON.stringify(bodyObj),
      redirect: `follow`,
    });
  } catch (err) {
    throw new ApiError(`NETWORK`, String(err));
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`BAD_RESPONSE`);
  }
  if (!json.ok) throw new ApiError(json.error ?? `UNKNOWN`, json.message);
  return json;
}

/** @param {object} settings */
export function fetchPayload(settings) {
  return callWebApp(settings, `fetch`, { date: toYmd(new Date()) });
}

/**
 * `isDevMode` is the mode the meal was saved under, which can differ from the current setting by the time a queued meal is sent.
 * @param {object} settings @param {object} mealObj @param {boolean} isDevMode
 */
export function saveMeal(settings, mealObj, isDevMode) {
  return callWebApp({ ...settings, isDevMode }, `save`, { meal: mealObj });
}

// --- Mock mode: webAppUrl === "mock". Mirrors the real Templates sheet. ---

const MOCK_TEMPLATES = {
  Breakfast: [
    { name: `Toast`, carbs: ``, carbsPer100g: `30` },
    { name: `Yoghurt`, carbs: `12`, carbsPer100g: `` },
  ],
  Lunch: [
    { name: `Sandwich`, carbs: ``, carbsPer100g: `30` },
    { name: `Crisps`, carbs: `13`, carbsPer100g: `` },
    { name: `Biscuit`, carbs: `11`, carbsPer100g: `` },
    { name: `Straw milk`, carbs: `11`, carbsPer100g: `` },
    { name: `Banana`, carbs: ``, carbsPer100g: `23` },
  ],
  Dinner: [
    { name: `Cake`, carbs: `11`, carbsPer100g: `` },
    { name: `Ice cream`, carbs: `13`, carbsPer100g: `` },
  ],
  Snack: [],
};

const MOCK_FAVOURITES = [
  { name: `Pasta`, carbs: `25`, carbsPer100g: `` },
  { name: `Bread`, carbs: ``, carbsPer100g: `30` },
  { name: `Potato stars`, carbs: ``, carbsPer100g: `32` },
  { name: `Fish fingers`, carbs: ``, carbsPer100g: `20` },
  { name: `Chicken Goujons`, carbs: ``, carbsPer100g: `19` },
  { name: `Chicken nuggets`, carbs: ``, carbsPer100g: `18` },
  { name: `Chicken supreme`, carbs: ``, carbsPer100g: `11` },
  { name: `Roast potatoes`, carbs: ``, carbsPer100g: `26` },
  { name: `Mashed potato`, carbs: ``, carbsPer100g: `17` },
  { name: `Lasagne`, carbs: ``, carbsPer100g: `9` },
  { name: `Maple syrup`, carbs: ``, carbsPer100g: `68` },
  { name: `Chicken`, carbs: `0`, carbsPer100g: `` },
  { name: `Meat`, carbs: `0`, carbsPer100g: `` },
  { name: `Sausages`, carbs: `4`, carbsPer100g: `` },
  { name: `Rice noodles with veg`, carbs: ``, carbsPer100g: `22` },
  { name: `Choc spread`, carbs: ``, carbsPer100g: `60` },
];

async function mockCall(action, extraObj) {
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  const logArr = getMockLog();
  if (action === `save`) {
    const mealObj = extraObj.meal;
    if (!logArr.some((row) => row.id === mealObj.id)) {
      logArr.push({ ...mealObj, totalCarbs: totalCarbs(mealObj.foods.map(foodToRow)), savedAt: Date.now() });
      setMockLog(logArr);
    }
    return { ok: true, sheetName: `Testing`, rowNum: 2 + logArr.length };
  }
  const today = new Date();
  const params = new URLSearchParams(location.search);
  const sheetNamesArr = [`Templates`, `Testing`, `AppLog`];
  if (params.get(`mockMissing`) !== `current`) sheetNamesArr.push(sheetNameFor(today));
  if (params.get(`mockMissing`) === `none` || !params.has(`mockMissing`)) sheetNamesArr.push(sheetNameFor(firstOfNextMonth(today)));
  const lastObj = logArr[logArr.length - 1];
  return {
    ok: true,
    templates: MOCK_TEMPLATES,
    favourites: MOCK_FAVOURITES,
    sheetNames: sheetNamesArr,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/MOCK_SPREADSHEET_ID/edit`,
    lastMeal: lastObj
      ? { date: lastObj.date, meal: lastObj.meal, totalCarbs: lastObj.totalCarbs }
      : { date: toYmd(today), meal: MEAL_NAMES[2], totalCarbs: 53 },
  };
}

/** Web-app food shape to the app's row shape. @param {object} foodObj */
export function foodToRow(foodObj) {
  return {
    name: foodObj.name ?? ``,
    carbs: (foodObj.carbs ?? ``) === `` ? `` : String(foodObj.carbs),
    carbsPer100g: (foodObj.carbsPer100g ?? ``) === `` ? `` : String(foodObj.carbsPer100g),
    weightG: (foodObj.weightG ?? ``) === `` ? `` : String(foodObj.weightG),
  };
}
