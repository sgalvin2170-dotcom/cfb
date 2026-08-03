# CFB Predictor

College football prediction dashboard (Android via Expo, desktop via Expo Web) backed by InstantDB, with a daily ETL pipeline pulling from CollegeFootballData.com, ESPN, and (in later phases) Sagarin, FEI, TeamRankings, and ThePredictionTracker into an ensemble ATS/O-U/ML model.

See `.claude/plans` history / project notes for the full architecture and phased build plan. This is currently **Phase 2: CFBD-only vertical slice** — schedule, teams, venues, and market lines flow end-to-end into InstantDB and render on the dashboard. The rating sources and ensemble math come next.

## One-time setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Create an InstantDB app** at https://instantdb.com/dash and grab, from its "Admin" tab:
   - App ID
   - Admin Token

3. **Get a free CFBD API key** at https://collegefootballdata.com/key

4. **Configure env vars**
   ```
   cp .env.example .env
   ```
   Fill in `EXPO_PUBLIC_INSTANT_APP_ID`, `INSTANT_APP_ID` (same value), `INSTANT_APP_ADMIN_TOKEN`, `CFBD_API_KEY`.

5. **Push the schema and permissions to InstantDB**
   ```
   npx instant-cli@latest push schema
   npx instant-cli@latest push perms
   ```

## Running the app (Android)

```
npm run android
```

Or `npm run web` for the desktop/browser build, `npm start` for the Expo dev server + QR code.

## Running the ETL manually

```
npm run etl            # all weeks for the current season
npm run etl -- 1        # just week 1
```

This populates InstantDB and writes `exports/<date>/cfb_today_<date>.csv`.

## Automating it daily (GitHub Actions)

The workflow at `.github/workflows/daily-scrape.yml` runs the ETL once a day and commits the CSV back to the repo. In the GitHub repo settings, add:

- **Secrets** (Settings → Secrets and variables → Actions → Secrets): `INSTANT_APP_ID`, `INSTANT_APP_ADMIN_TOKEN`, `CFBD_API_KEY`
- **Variables** (same page, Variables tab): `CFB_SEASON` (e.g. `2026`)

You can also trigger it manually from the Actions tab (`workflow_dispatch`), optionally specifying a week.

## Project layout

- `instant.schema.ts` / `instant.perms.ts` — InstantDB schema and permission rules (client is read-only; only the ETL's admin token can write)
- `app/` — Expo Router screens (dashboard, game detail, settings)
- `components/` — shared UI (team badges, game cards, week selector)
- `scripts/etl/` — the daily data pipeline: `sources/` per-provider fetchers, `upsertCore.ts` (InstantDB writes), `csv.ts` (export), `index.ts` (entrypoint)
