# CarbTracker

A small PWA that logs a meal's foods and carbs into the "Beths carbs" Google Sheet. No build step: it's plain HTML, CSS and ES modules. The design decisions are in [SPEC.md](SPEC.md).

## Files

| File | What it is |
|---|---|
| `index.html`, `app.css` | The page and its styles |
| `js/app.js` | Screens, food rows, settings dialog |
| `js/api.js` | Talks to the Apps Script web app (or a built-in mock) |
| `js/sync.js` | Drains the offline queue, refreshes the cached payload |
| `js/store.js` | localStorage settings/cache/draft, IndexedDB queue |
| `js/theme.js`, `js/icons.js`, `js/util.js` | Theme, inline SVG icons, helpers |
| `sw.js`, `manifest.json`, `icons/` | The PWA bits |
| `Code.gs` | The Apps Script web app, pasted into the spreadsheet's script project |

## One-time setup

### 1. The web app

1. Open the spreadsheet, then Extensions > Apps Script.
2. Paste the contents of `Code.gs` below the existing `onEdit` function (or into a new file in the same project).
3. Generate a secret and add it under Project settings > Script properties as `SECRET`:
   ```bash
   openssl rand -hex 24
   ```
4. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Copy the web app URL (ends in `/exec`).
5. Optional: run `addSnackToMealDropdowns` once from the editor so Snack rows don't get a validation warning. Run `debugFetch` to see what the app will receive.

Every later change to `Code.gs` needs Deploy > Manage deployments > edit > new version, or the URL keeps serving the old code.

### 2. The app

Open the app, tap the cog, paste the web app URL and the secret, then "Save and test". Tick dev mode to point everything at the `Testing` sheet.

## Hosting

GitHub Pages, from the public repo's `main` branch, folder `/`. The repo holds no secrets: the web app URL and secret live only in each phone's localStorage. One-time setup is in the section below; after that a push is a deploy.

## Running locally

Any static server works:

```bash
python3 -m http.server 8765 --directory ~/fraser/CarbTracker
```

Then open http://127.0.0.1:8765/. Service workers need HTTPS or localhost, so use localhost rather than a LAN IP when testing offline behaviour.

### Mock mode

Enter `mock` as the web app URL and the app runs against a copy of the Templates sheet baked into `js/api.js`. Saves go to `localStorage` under `ct.mockLog`. Add `?mockMissing=current` to the URL to see the missing-month banner.

## Releasing

1. Bump `CACHE_VERSION` in `sw.js` (for example `ct-v2`) so old cached files get dropped. The service worker is network-first, so installed copies fetch fresh files on their next online open either way.
2. Commit and `git push`. GitHub Pages serves the `main` branch as-is at `https://<user>.github.io/CarbTracker/` a minute or so later. Every path is relative, so the sub-path is fine. `.nojekyll` tells Pages to skip its Jekyll build.

## How saving works

The app writes one row per food into the first free row of the month sheet (columns A–F only). The date goes on the first row of every meal, the meal type on the first food row, then the food name and either Carbs or Carbs/100g + Weight. The sheet's own formulas in G–M do the rest. Each save carries a client id that's recorded in the `AppLog` sheet, so a retried save never writes twice.

Meals saved offline sit in IndexedDB and go up when the app next opens or the browser comes back online.
