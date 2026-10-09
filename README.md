# CorpoExplorer

Pick a public company and see where every $100 it brings in comes from, and where it goes, straight from its latest annual report (Form 10-K).

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

### Where it goes

1. **Costs.** We find the income statement in the filing's presentation linkbase (`*_pre.xml`, or the `.xsd`) and take the company's own cost lines between revenue and operating income (pre-tax income for banks). We use the most detailed set that adds up within 0.5%, so Amazon's "Fulfillment" and JPMorgan's "Compensation" show up as their own rows. Common lines get plain-English names, and the filing's wording is shown alongside.
2. **Below the line.** Interest, investment gains and other items are whatever remains between operating income and taxes plus profit. When that's money *in* (e.g. Alphabet's investment gains), it's listed separately and the bar runs past $100.
3. **Taxes and profit.** Income tax expense and net income, so every row adds back to revenue.
4. **What it did with the money.** Dividends, buybacks and capital spending, from the cash flow statement.
5. **Spotlights.**
   - **Taxes:** the effective tax rate (compared with the 21% federal rate) and cash taxes actually paid.
   - **Employees:** the pay line when the filing has one (banks usually do). Otherwise stock-based pay, with a note that US companies don't have to report total wages.

```
server.js          HTTP server: static files + /api/tickers, /api/company/:ticker
lib/sec.js         EDGAR fetching (throttled, cached in memory)
lib/xbrl.js        Instance, label and presentation parsing (no dependencies)
lib/breakdown.js   Picks the revenue breakdowns and turns them into $ per 100
lib/spending.js    Costs, taxes, profit and what happened to the profit
public/            The page (plain HTML/CSS/JS, no build step)
```

## Known limits

- Only US filers that file a 10-K. Foreign companies that file 20-F (e.g. TSMC, Toyota) aren't supported yet.
- Banks and insurers report revenue differently, so their breakdowns are thinner.
- Some companies don't tag their revenue tables in a way we can reconcile, so some views may be missing for them.
- Total employee pay is only shown when the filing reports it as its own line. Most non-financial US companies don't.
- Tax expense is the accounting figure. Cash taxes paid in the same year can be quite different, so we show both.
