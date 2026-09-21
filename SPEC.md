# CarbTracker spec

A PWA for logging a meal's foods and carbs into the "Beths carbs" Google Sheet. Agreed 2026-09-20.

## Stack

- No build step. Plain ES-module JavaScript, hand-written `manifest.json`, hand-rolled service worker (`sw.js`) with a cache version string bumped per release. JSDoc for types. No jQuery.
- Hosted on GitHub Pages from the public repo's `main` branch. Every path is relative so the `/CarbTracker/` sub-path works.
- Backend is an Apps Script web app bound to the spreadsheet (`Code.gs` in this repo, pasted into the script editor by hand and deployed as "execute as me, anyone"). `doGet` and `doPost` live alongside the existing `onEdit`, which is left untouched.
- Source lives in `~/fraser/CarbTracker/`. No commits unless asked.

## Spreadsheet facts the code relies on

- Month sheets are named `MMM YYYY` (e.g. `Sep 2026`). Columns: `Date | Meal | Food | Carbs | Carbs/100g | Weight (g) | = Carbs | Total | Blood | Bolus | isNewMeal | currMeal | ICR | consts`. G–M are formulas pre-filled to row 349. Whole-gram display, full-precision storage.
- The app writes only A–F. It finds the first row (from row 2) with A–F blank. Date goes on the first food row of every meal. Meal goes on the first food row only. Food always. Then either Carbs, or Carbs/100g + Weight. Never `= Carbs` or Total.
- If no blank row exists inside the formula range the web app returns an error and the meal stays queued.
- Column B validation list is `Breakfast,Lunch,Dinner`. Snack gets added to that list on `Testing`, `Oct 2026`, `Nov 2026`, `Dec 2026`. Fraser adds it to whatever future months are copied from.
- `Templates` sheet is parsed as-is: column A labels start sections (`Others` = favourites, `Breakfast`, `Lunch`, `Dinner`); each food row has a name in B and either Carbs in C or Carbs/100g in D. Named ranges and `onEdit` keep working for hand entry.
- `Testing` is a copy of a month sheet used when dev mode is on.
- `AppLog` sheet: `id | savedAt | date | meal | totalCarbs | sheet | foods | rowNum | status`. The row is logged as `writing` before the month sheet is touched and flipped to `done` after. A repeated id that's `done` returns success without writing again. A repeated id still marked `writing` means the earlier attempt was interrupted: the web app checks whether the rows landed at the logged row (same meal, food names and numbers), and only writes again if they didn't. Only saves take the script lock; fetches are read-only and run alongside.
- Blood and bolus are out of scope entirely. Columns I and J are never touched.

## API (web app)

Every request carries the secret (stored in Script Properties) and, in dev mode, `sheet: "Testing"`. A meal remembers the mode it was saved under, so a queued meal goes to the sheet it was meant for even if dev mode is toggled before it syncs. Wrong secret returns a JSON error the app shows as a toast pointing at settings.

- `GET` returns one JSON payload: templates per meal, favourites, list of sheet names, last saved meal (from the current month's sheet, falling back to the previous month; `Testing` only in dev mode), and the spreadsheet URL.
- `POST` appends one meal: `{ id, date: "YYYY-MM-DD", meal, foods: [{ name, carbs?, carbsPer100g?, weightG? }] }`. Sent as `text/plain` JSON with `redirect: "follow"` to avoid CORS preflight and the Apps Script POST redirect.
- The script turns the date string into a date cell in the spreadsheet's time zone. It never shifts the day.

## Screens

Shared chrome on every screen:

- Top line: spreadsheet link (icon, opens in a new tab, disabled until the first successful fetch) on the left, the date in the middle as `Sat, 19 Sep` from the device clock, a settings cog on the right. "DEV" badge in the header when dev mode is on.
- Directly under it, a fixed bar with the meal type and total carbs in the same position on both screens. Home: last saved meal's type and total, plus a status word ("syncing", "queued") when relevant. Meal screen: the current meal's type and running total, plus Cancel and Save. Anchored to the top so the keyboard never hides or moves it.
- Banners: red if the current month's sheet is missing, yellow if it's after the 20th and next month's is missing. Neither blocks saving. Off in dev mode.

Home screen: three large buttons Breakfast, Lunch, Dinner in the middle, a smaller Snack button below. Redrawn whenever the app comes back to the foreground, so the highlight is never hours old. Highlight by device local time: Lunch for 10:00 ≤ now < 15:00, Breakfast before, Dinner after. Highlight = the others at reduced opacity. Snack is never highlighted.

Meal screen:

- Opens pre-populated from the meal's template (Snack: one blank row). First empty Weight field gets focus with the numeric keyboard.
- Each food row: name, Carbs/100g, Weight (g), Carbs. Two lines on phones (name, then the three numbers), one line on wider screens. All fields are plain inputs, `inputmode="decimal"`, always editable. A small × removes a row.
- If Carbs/100g and Weight are both filled, Carbs is computed (`E*F/100`) and read-only. Typing into Carbs directly leaves the other two blank.
- Tapping an empty name shows the favourites list under it, filtered as you type. Picking one fills the name and its Carbs or Carbs/100g; a favourite with Carbs/100g moves focus to Weight. Free-typed names are fine.
- The trailing blank row becomes real on its first character or a favourite pick, and a new blank row appears below. Clearing a name doesn't remove the row. Unnamed rows are dropped on save.
- Enter / Next moves to the next field on the row, then the next row's name.
- On focus and on `visualViewport` resize, the focused row scrolls into view; the trailing blank row is kept visible too when there's room.
- Save needs at least one named row; numbers may be blank. Save queues the meal, returns home, shows the new total. Cancel returns home and clears the draft.
- Draft is saved to localStorage as you type. Tapping the same meal type on the same day restores it, with a "Start over" link that reloads the template. There's one draft slot: typing in a different meal type replaces it.

Settings popup (a `<dialog>`): font size toggle (two root sizes, ~16px and ~20px), background colour (cycle of 10 pastels, darkened variants in dark mode), theme (dark / light / auto via `prefers-color-scheme`), web app URL, secret, dev mode toggle. Saving runs a test `GET` and shows tick or cross.

## Offline and sync

- Settings, theme, colour, font, draft, and the cached `GET` payload live in localStorage. Unsent meals live in IndexedDB, one record per meal with a client-generated id. If IndexedDB can't be used, the queue falls back to localStorage so saving still works.
- Sync runs on app open, on the browser `online` event, and right after each save. A sync requested while one is running reruns straight after. A failed sync retries with a backoff from 15 seconds up to 10 minutes. No Background Sync API.
- Meals are sent oldest first and a failure stops the run, so order is kept. A meal the web app itself keeps rejecting is dropped 20 hours after its first rejection so it can't block later meals. Time spent waiting offline doesn't count, and connection, secret, and missing-month-sheet failures never cause a drop. Requests to the web app give up after 45 seconds.
- Service worker precaches the app shell so it opens offline. Online it's network-first and bypasses the browser's HTTP cache, falling back to its own cache if the network fails or the page hasn't arrived in 3 seconds. The page request sets the mode for the whole load so new and old files never mix: a page from the network makes its files wait up to 10 seconds for the network, a page from the cache takes its files from the cache too. After a timeout the next page request is served from the cache at once for 30 seconds.

## Misc

- Icons are inline SVG (Lucide), no icon font, no CDN.
- App icon: calculator-style, pink-to-purple gradient, with a "B". 192 and 512 PNGs plus the SVG.
- Desktop: single column, max ~600px, centred.
- Everything time-related uses the device clock, so travelling changes the day and the lunch window with the phone.
- Front end is testable with Playwright against a mocked payload immediately. Real saves into `Testing` wait for Fraser to paste `Code.gs`, set the secret, and deploy.
