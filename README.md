# damm-dashboard

Static dashboard for DAMM fund share prices, consumed live from the Lagoon GraphQL API
(`https://api.lagoon.finance/query`, public, CORS-open). No backend.

## Usage

Open `index.html` in a browser, or serve it:

```bash
python3 -m http.server 8000   # http://localhost:8000
```

## What it shows

Per vault (tabs: DAMMstable / DAMMeth):

- **Headline cards** — current share price, return since inception, TVL (USD), last settlement date
- **Share price chart** — synthetic daily series (linear interpolation of `stateHistory.pricePerShare`
  at UTC midnights, no extrapolation past the last settlement) with real settlement points marked
- **Period APR chart** — bars of annualized simple return `(p_end/p_start − 1) × 365/days`,
  with toggles for granularity (daily/weekly/monthly), bucketing (calendar Mon–Sun weeks &
  calendar months ⇄ fixed 7d/30d windows from inception), and a trailing rolling-mean line
  with adjustable window (in bars)

Settlements are roughly weekly, so daily bars between settlements are interpolation plateaus —
only weekly/monthly granularity carries information beyond the settlement cadence.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page: fetch, UI, Chart.js wiring |
| `core.js` | Pure data logic (interpolation, bucketing, APR, rolling mean) — shared by page and tests |
| `test.js` | Unit tests for `core.js` — `node test.js` |
| `smoke.js` | End-to-end data check against the live API — `node smoke.js` |

## Adding a vault

Append to the `VAULTS` array in `index.html` (address, chainId, asset decimals).
