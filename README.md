# CorpoExplorer

Pick a public company and see where every $100 it brings in comes from, using the revenue breakdowns in its latest annual report (Form 10-K).

## Run it

Requires Node 20+. There are no dependencies to install.

```sh
SEC_USER_AGENT="CorpoExplorer you@example.com" npm start
# open http://localhost:3000  (or http://localhost:3000/?t=AAPL)
```

SEC EDGAR requires a User-Agent with a name and contact email ([fair access policy](https://www.sec.gov/os/accessing-edgar-data)). The server won't start without one.

| Command | What it does |
| --- | --- |
| `npm start` | Start the server (`PORT` defaults to 3000) |
| `npm run dev` | Start the server and restart on changes |
| `npm test` | Run the unit tests (offline) |
| `npm run smoke [TICKERS…]` | Print live breakdowns from EDGAR for a few companies |

## How it works

1. **Find the filing.** Ticker → CIK (`company_tickers.json`) → most recent `10-K` (`data.sec.gov/submissions`).
2. **Read the data.** Every 10-K includes machine-readable XBRL. We download the instance document (`*_htm.xml`) and the labels (`*_lab.xml`, or the `.xsd` when labels are embedded there).
3. **Build breakdowns.** We take full-year revenue facts and group them three ways:
   - **What they sell** (`srt:ProductOrServiceAxis`)
   - **Business units** (`us-gaap:StatementBusinessSegmentsAxis`)
   - **Regions** (`srt:StatementGeographicalAxis`)

   Filings tag revenue in overlapping ways. Apple reports both "Products" and "iPhone / Mac / iPad / …". For each view we pick the **most detailed set of line items that adds up to total revenue** (within 1%). A gap larger than 0.5% gets its own "Not broken out in the filing" row. When products are reported inside a segment (Google's ad lines sit inside "Google Services"), we combine them with the segments that have no product detail (e.g. "Google Cloud").
4. **Show it per $100.** Shares are rounded to cents so they add up to exactly $100.00.

```
server.js          HTTP server: static files + /api/tickers, /api/revenue/:ticker
lib/sec.js         EDGAR fetching (throttled, cached in memory)
lib/xbrl.js        Instance + label parsing (no dependencies)
lib/breakdown.js   Picks the breakdowns and turns them into $ per 100
public/            The page (plain HTML/CSS/JS, no build step)
```

## Known limits

- Only US filers that file a 10-K. Foreign companies that file 20-F (e.g. TSMC, Toyota) aren't supported yet.
- Banks and insurers report revenue differently, so their breakdowns are thinner.
- Some companies don't tag their revenue tables in a way we can reconcile, so some views may be missing for them.
