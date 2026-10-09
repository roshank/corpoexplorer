# CorpoExplorer

Pick a public company and see where every $100 it brings in comes from, and where it goes, straight from its latest annual report (Form 10-K).

## The website

The site is plain static files (`index.html`, `app.js`, `format.js`, `styles.css`) plus pre-built data in `data/`, served by GitHub Pages from the root of `main`. There's no server and nothing to install to use it.

SEC's filing archive doesn't allow browsers on other sites to load it (no CORS headers), so the data is prepared ahead of time:

- `data/companies.json` lists every ticker we cover.
- `data/c/<CIK>.json` holds one company's numbers (~3KB each).
- For now we cover the 50 largest companies by market cap that file a US 10-K, taken in SEC's ticker-list order, which is roughly by market cap. Change `--target` in the workflow to cover more.

### Keeping it fresh

The **Refresh data** GitHub Action (`.github/workflows/refresh-data.yml`) runs every Monday and can also be run by hand from the Actions tab. It only re-downloads companies with a new 10-K and commits any changes, and Pages republishes on its own.

It needs one repository secret, because SEC rejects requests without a contact email: **Settings → Secrets and variables → Actions → New repository secret**, name `SEC_USER_AGENT`, value like `CorpoExplorer you@example.com`.

### Working on it locally

Requires Node 20+. There are no dependencies to install.

| Command | What it does |
| --- | --- |
| `npm run preview` | Serve the site at http://localhost:3000, the same way Pages does |
| `SEC_USER_AGENT="Name email" npm run build` | Rebuild `data/` from SEC (add `-- --only AAPL,MSFT` for a few companies) |
| `npm test` | Run the unit tests (offline) |
| `SEC_USER_AGENT="Name email" npm run smoke [TICKERS…]` | Print live results from SEC for a few companies |

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
index.html, app.js, format.js, styles.css   The site
data/              Pre-built company data the site reads
scripts/build-data.js   Builds data/ from SEC filings
lib/sec.js         EDGAR fetching (throttled, with retries)
lib/xbrl.js        Instance, label and presentation parsing (no dependencies)
lib/breakdown.js   Picks the revenue breakdowns and turns them into $ per 100
lib/spending.js    Costs, taxes, profit and what happened to the profit
```

## Known limits

- Only the 50 largest companies are included, and the data is refreshed weekly.
- Only US filers that file a 10-K. Foreign companies that file 20-F (e.g. TSMC, Toyota) aren't supported yet.
- Banks and insurers report revenue differently, so their breakdowns are thinner.
- Some companies don't tag their revenue tables in a way we can reconcile, so some views may be missing for them.
- Total employee pay is only shown when the filing reports it as its own line. Most non-financial US companies don't.
- Tax expense is the accounting figure. Cash taxes paid in the same year can be quite different, so we show both.
