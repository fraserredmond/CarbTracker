/**
 * CarbTracker web app. Lives in the "Beths Carbs Script" project next to onEdit.
 *
 * Setup:
 *   1. Paste this file's contents below onEdit in Code.gs (or add a new file).
 *   2. Project settings > Script properties: add SECRET = <a long random string>.
 *   3. Deploy > New deployment > Web app: execute as "Me", who has access "Anyone". Copy the URL.
 *   4. In the PWA's settings, paste the web app URL and the secret.
 *   5. Optional, once: run addSnackToMealDropdowns from the editor so Snack rows don't get a warning triangle.
 *
 * Every request is a POST with a JSON body: { secret, action: "fetch" | "save", sheet?, date?, meal? }.
 * `sheet` is set to "Testing" by the app's dev mode; otherwise the month sheet is derived from the date.
 */

const TEMPLATES_SHEET_NAME = 'Templates';
const APP_LOG_SHEET_NAME = 'AppLog';
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIRST_DATA_ROW_NUM = 2;
const DATA_COLS_NUM = 6; // A–F: Date, Meal, Food, Carbs, Carbs/100g, Weight (g).
const CARBS_FORMULA_COL_NUM = 7; // G: "= Carbs". Its formula marks how far down the month sheet is usable.
const DATE_NUMBER_FORMAT = 'ddd", "d" "mmm" "';
const LOG_HEADERS = ['id', 'savedAt', 'date', 'meal', 'totalCarbs', 'sheet', 'foods', 'rowNum', 'status'];
const LOG_STATUS_COL_NUM = 9;
const LOG_STATUS_WRITING = 'writing';
const LOG_STATUS_DONE = 'done';
const SNACK_DROPDOWN_SHEET_NAMES = ['Testing', 'Oct 2026', 'Nov 2026', 'Dec 2026'];

function doGet() {
  return ContentService.createTextOutput('CarbTracker web app is running. The app talks to it with POST.');
}

function doPost(evt) {
  let outObj;
  try {
    const reqObj = JSON.parse(evt.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || reqObj.secret !== secret) {
      outObj = { ok: false, error: 'BAD_SECRET' };
    } else {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        if (reqObj.action === 'fetch') outObj = fetchPayload_(reqObj);
        else if (reqObj.action === 'save') outObj = saveMeal_(reqObj);
        else outObj = { ok: false, error: 'BAD_ACTION' };
      } finally {
        lock.releaseLock();
      }
    }
  } catch (err) {
    outObj = { ok: false, error: 'EXCEPTION', message: String((err && err.stack) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(outObj)).setMimeType(ContentService.MimeType.JSON);
}

// --- fetch ---

function fetchPayload_(reqObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const templatesObj = readTemplates_(ss);
  const sheetNamesArr = ss.getSheets().map((sheet) => sheet.getName());
  const todayObj = parseYmd_(reqObj.date) || new Date();

  let lastMealObj = null;
  if (reqObj.sheet) {
    const sheet = ss.getSheetByName(reqObj.sheet);
    lastMealObj = sheet ? readLastMeal_(ss, sheet) : null;
  } else {
    const currentSheet = ss.getSheetByName(monthSheetName_(todayObj));
    lastMealObj = currentSheet ? readLastMeal_(ss, currentSheet) : null;
    if (!lastMealObj) {
      const prevSheet = ss.getSheetByName(monthSheetName_(new Date(todayObj.getFullYear(), todayObj.getMonth() - 1, 1)));
      lastMealObj = prevSheet ? readLastMeal_(ss, prevSheet) : null;
    }
  }

  return {
    ok: true,
    templates: templatesObj.templates,
    favourites: templatesObj.favourites,
    sheetNames: sheetNamesArr,
    spreadsheetUrl: ss.getUrl(),
    lastMeal: lastMealObj,
  };
}

/** Column A labels start sections: "Others" (favourites) or a meal name. Each food row has B=name, C=carbs, D=carbs/100g. */
function readTemplates_(ss) {
  const sheet = ss.getSheetByName(TEMPLATES_SHEET_NAME);
  const templates = { Breakfast: [], Lunch: [], Dinner: [], Snack: [] };
  const favourites = [];
  if (!sheet || sheet.getLastRow() < 1) return { templates, favourites };
  const valuesAoa = sheet.getRange(1, 1, sheet.getLastRow(), 4).getValues();
  let sectionName = '';
  valuesAoa.forEach((row) => {
    const label = String(row[0]).trim();
    if (label) sectionName = label;
    const name = String(row[1]).trim();
    if (!name) return;
    const foodObj = { name, carbs: numOrBlank_(row[2]), carbsPer100g: numOrBlank_(row[3]) };
    if (templates[sectionName]) templates[sectionName].push(foodObj);
    else favourites.push(foodObj);
  });
  return { templates, favourites };
}

/** The last meal on a month sheet: from the last row with a Meal in B down to the last row with a Food in C. */
function readLastMeal_(ss, sheet) {
  const lastRowNum = sheet.getLastRow();
  if (lastRowNum < FIRST_DATA_ROW_NUM) return null;
  const valuesAoa = sheet.getRange(FIRST_DATA_ROW_NUM, 1, lastRowNum - FIRST_DATA_ROW_NUM + 1, DATA_COLS_NUM).getValues();
  let endIdx = -1;
  for (let i = valuesAoa.length - 1; i >= 0; i--) {
    if (String(valuesAoa[i][2]).trim() !== '' || String(valuesAoa[i][1]).trim() !== '') { endIdx = i; break; }
  }
  if (endIdx < 0) return null;
  let startIdx = endIdx;
  while (startIdx > 0 && String(valuesAoa[startIdx][1]).trim() === '') startIdx--;
  let dateIdx = startIdx;
  while (dateIdx >= 0 && valuesAoa[dateIdx][0] === '') dateIdx--;

  const foodsArr = [];
  let totalNum = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const row = valuesAoa[i];
    const name = String(row[2]).trim();
    if (!name) continue;
    const foodObj = { name };
    const per100 = numOrBlank_(row[4]);
    const weight = numOrBlank_(row[5]);
    const carbs = numOrBlank_(row[3]);
    if (per100 !== '') {
      foodObj.carbsPer100g = per100;
      if (weight !== '') foodObj.weightG = weight;
    } else if (carbs !== '') {
      foodObj.carbs = carbs;
    }
    totalNum += foodCarbs_(foodObj);
    foodsArr.push(foodObj);
  }
  return {
    date: (dateIdx >= 0) ? cellToYmd_(ss, valuesAoa[dateIdx][0]) : '',
    meal: String(valuesAoa[startIdx][1]).trim(),
    totalCarbs: totalNum,
    foods: foodsArr,
  };
}

// --- save ---

function saveMeal_(reqObj) {
  const mealObj = reqObj.meal || {};
  const foodsArr = Array.isArray(mealObj.foods) ? mealObj.foods.filter((food) => food && String(food.name || '').trim() !== '') : [];
  if (typeof mealObj.id !== 'string' || !mealObj.id) return { ok: false, error: 'BAD_MEAL', message: 'Missing id.' };
  if (!parseYmd_(mealObj.date)) return { ok: false, error: 'BAD_MEAL', message: 'Bad date.' };
  if (MEAL_NAMES.indexOf(mealObj.meal) < 0) return { ok: false, error: 'BAD_MEAL', message: 'Unknown meal type.' };
  if (foodsArr.length === 0) return { ok: false, error: 'BAD_MEAL', message: 'No foods.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = getOrCreateLogSheet_(ss);

  // The log row is written as "writing" before the month sheet is touched and flipped to "done" after. So a
  // repeated id is either finished (nothing to do) or was interrupted, in which case look whether the rows landed.
  let logRowNum = findLogRowNum_(logSheet, mealObj.id);
  if (logRowNum) {
    const logRow = logSheet.getRange(logRowNum, 1, 1, LOG_HEADERS.length).getValues()[0];
    if (String(logRow[LOG_STATUS_COL_NUM - 1]) !== LOG_STATUS_WRITING) return { ok: true, isDuplicate: true };
    const prevSheet = ss.getSheetByName(String(logRow[5]));
    const prevRowNum = Number(logRow[7]);
    if (prevSheet && prevRowNum >= FIRST_DATA_ROW_NUM && isMealAtRow_(prevSheet, prevRowNum, mealObj.meal, foodsArr)) {
      logSheet.getRange(logRowNum, LOG_STATUS_COL_NUM).setValue(LOG_STATUS_DONE);
      return { ok: true, isDuplicate: true, isRecovered: true };
    }
  }

  const sheetName = reqObj.sheet || monthSheetName_(parseYmd_(mealObj.date));
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { ok: false, error: 'NO_SHEET', sheetName };

  const rowNum = nextFreeRowNum_(sheet);
  if (!hasFormulaRows_(sheet, rowNum, foodsArr.length)) return { ok: false, error: 'NO_ROOM', sheetName };

  const totalNum = foodsArr.reduce((sumNum, food) => sumNum + foodCarbs_(food), 0);
  const foodsSummary = foodsArr.map((food) => food.name + ' ' + Math.round(foodCarbs_(food)) + 'g').join(', ');
  const logValuesArr = [mealObj.id, new Date(), mealObj.date, mealObj.meal, totalNum, sheetName, foodsSummary, rowNum, LOG_STATUS_WRITING];
  if (logRowNum) {
    logSheet.getRange(logRowNum, 1, 1, LOG_HEADERS.length).setValues([logValuesArr]);
  } else {
    logSheet.appendRow(logValuesArr);
    logRowNum = logSheet.getLastRow();
  }
  SpreadsheetApp.flush();

  const dateSerialNum = ymdToSerial_(mealObj.date);
  const valuesAoa = foodsArr.map((food, i) => [
    (i === 0) ? dateSerialNum : '',
    (i === 0) ? mealObj.meal : '',
    String(food.name).trim(),
    numOrBlank_(food.carbsPer100g) === '' ? numOrBlank_(food.carbs) : '',
    numOrBlank_(food.carbsPer100g),
    numOrBlank_(food.carbsPer100g) === '' ? '' : numOrBlank_(food.weightG),
  ]);
  sheet.getRange(rowNum, 1, valuesAoa.length, DATA_COLS_NUM).setValues(valuesAoa);
  sheet.getRange(rowNum, 1).setNumberFormat(DATE_NUMBER_FORMAT);
  SpreadsheetApp.flush();

  logSheet.getRange(logRowNum, LOG_STATUS_COL_NUM).setValue(LOG_STATUS_DONE);

  return { ok: true, sheetName, rowNum, totalCarbs: totalNum };
}

/** First row after the last row that has anything in A–F. Skips over blank rows in the middle of the month. */
function nextFreeRowNum_(sheet) {
  const maxRowNum = sheet.getMaxRows();
  const valuesAoa = sheet.getRange(FIRST_DATA_ROW_NUM, 1, maxRowNum - FIRST_DATA_ROW_NUM + 1, DATA_COLS_NUM).getValues();
  for (let i = valuesAoa.length - 1; i >= 0; i--) {
    if (valuesAoa[i].some((cell) => cell !== '')) return FIRST_DATA_ROW_NUM + i + 1;
  }
  return FIRST_DATA_ROW_NUM;
}

/** The month sheets carry formulas in G–M down to a fixed row. Beyond that a written row would have no total. */
function hasFormulaRows_(sheet, rowNum, rowsCount) {
  if (rowNum + rowsCount - 1 > sheet.getMaxRows()) return false;
  const formulasAoa = sheet.getRange(rowNum, CARBS_FORMULA_COL_NUM, rowsCount, 1).getFormulas();
  return formulasAoa.every((row) => row[0] !== '');
}

function getOrCreateLogSheet_(ss) {
  let sheet = ss.getSheetByName(APP_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(APP_LOG_SHEET_NAME);
  }
  // Also upgrades a log that predates the rowNum and status columns. Rows without a status count as done.
  const headerRange = sheet.getRange(1, 1, 1, LOG_HEADERS.length);
  if (String(headerRange.getValues()[0][LOG_STATUS_COL_NUM - 1]) !== LOG_HEADERS[LOG_STATUS_COL_NUM - 1]) {
    headerRange.setValues([LOG_HEADERS]);
  }
  return sheet;
}

/** Row number of the log entry for `id`, or 0. */
function findLogRowNum_(logSheet, id) {
  const lastRowNum = logSheet.getLastRow();
  if (lastRowNum < 2) return 0;
  const idsArr = logSheet.getRange(2, 1, lastRowNum - 1, 1).getValues().map((row) => String(row[0]));
  const idx = idsArr.indexOf(id);
  return (idx < 0) ? 0 : idx + 2;
}

/** True when the rows starting at `rowNum` hold this meal: the meal type on the first row and the same food names in order. */
function isMealAtRow_(sheet, rowNum, mealName, foodsArr) {
  if (rowNum + foodsArr.length - 1 > sheet.getMaxRows()) return false;
  const valuesAoa = sheet.getRange(rowNum, 2, foodsArr.length, 2).getValues();
  if (String(valuesAoa[0][0]).trim() !== mealName) return false;
  return foodsArr.every((food, i) => String(valuesAoa[i][1]).trim() === String(food.name).trim());
}

// --- One-off helpers to run from the editor ---

/** Adds Snack to the Meal dropdown on the sheets listed in SNACK_DROPDOWN_SHEET_NAMES. */
function addSnackToMealDropdowns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(MEAL_NAMES, true).setAllowInvalid(true).build();
  SNACK_DROPDOWN_SHEET_NAMES.forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    sheet.getRange(FIRST_DATA_ROW_NUM, 2, sheet.getMaxRows() - FIRST_DATA_ROW_NUM + 1, 1).setDataValidation(rule);
  });
}

/** Logs what the app would receive from a fetch. Run from the editor to check the parsing without deploying. */
function debugFetch() {
  const todayYmd = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  Logger.log(JSON.stringify(fetchPayload_({ date: todayYmd }), null, 2));
}

// --- Small utilities ---

function monthSheetName_(dateObj) {
  return MONTH_NAMES[dateObj.getMonth()] + ' ' + dateObj.getFullYear();
}

/** "YYYY-MM-DD" to a local Date, or null. Only used to pick month sheets. */
function parseYmd_(ymd) {
  const matchArr = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!matchArr) return null;
  return new Date(Number(matchArr[1]), Number(matchArr[2]) - 1, Number(matchArr[3]));
}

/** Sheets date serial (days since 1899-12-30) for a calendar date. No time zone involved. */
function ymdToSerial_(ymd) {
  const matchArr = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const utcMs = Date.UTC(Number(matchArr[1]), Number(matchArr[2]) - 1, Number(matchArr[3]));
  return Math.round((utcMs - Date.UTC(1899, 11, 30)) / 86400000);
}

function cellToYmd_(ss, cellMixed) {
  if (cellMixed instanceof Date) return Utilities.formatDate(cellMixed, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  if (typeof cellMixed === 'number') {
    const dateObj = new Date(Date.UTC(1899, 11, 30) + cellMixed * 86400000);
    return Utilities.formatDate(dateObj, 'UTC', 'yyyy-MM-dd');
  }
  return '';
}

function numOrBlank_(valueMixed) {
  if (valueMixed === '' || valueMixed === null || valueMixed === undefined) return '';
  const num = Number(valueMixed);
  return isNaN(num) ? '' : num;
}

function foodCarbs_(foodObj) {
  const per100 = numOrBlank_(foodObj.carbsPer100g);
  const weight = numOrBlank_(foodObj.weightG);
  const carbs = numOrBlank_(foodObj.carbs);
  if (per100 !== '') return (weight === '') ? 0 : per100 * weight / 100;
  return (carbs === '') ? 0 : carbs;
}
