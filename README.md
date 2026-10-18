# CorpoExplorer

Pick a public company and see where every $100 it brings in comes from, and where it goes, straight from its latest annual report (Form 10-K).

## The website

The site is plain static files (`index.html`, `app.js`, `format.js`, `styles.css`) plus pre-built data in `data/`, served by GitHub Pages from the root of `main`. There's no server and nothing to install to use it.

SEC's filing archive doesn't allow browsers on other sites to load it (no CORS headers), so the data is prepared ahead of time:

- `data/companies.json` lists every ticker we cover.
- `data/c/<CIK>.json` holds one company's numbers (~3KB each).
- We cover the S&P 500. The SEC doesn't publish index membership, so the build reads Wikipedia's [list of S&P 500 companies](https://en.wikipedia.org/wiki/List_of_S%26P_500_companies), which has each company's SEC ID (CIK) and sector (`lib/sp500.js`). It's saved to `data/sp500.json`, and that copy is used if Wikipedia can't be reached or its table looks wrong (not ~503 rows).
- `data/coverage.md` shows which parts of the page each company has, by sector, plus unusual results worth checking. It's regenerated after every build (`scripts/coverage.js`).

### Keeping it fresh

The **Refresh data** GitHub Action (`.github/workflows/refresh-data.yml`) runs every Monday and can also be run by hand from the Actions tab. It only re-downloads companies with a new 10-K and commits any changes, and Pages republishes on its own.

It needs one repository secret, because SEC rejects requests without a contact email: **Settings → Secrets and variables → Actions → New repository secret**, name `SEC_USER_AGENT`, value like `CorpoExplorer you@example.com`.

### Version stamps

GitHub Pages tells browsers to reuse files for 10 minutes, so after a change people could see the old site. `scripts/stamp.js` adds a fingerprint of each file to its link in `index.html`:
- `styles.css?v=…` and `app.js?v=…`
- an import map for the modules `app.js` imports
- a data version that `app.js` adds to every data request

Any change gives a new URL, so a normal reload gets everything new. The **Stamp versions** Action re-stamps `index.html` after every push to `main`, the data build re-stamps after new data, and `npm test` fails if the stamps are stale (fix it with `npm run stamp`).

### Working on it locally

Requires Node 20+. There are no dependencies to install.

| Command | What it does |
| --- | --- |
| `npm run preview` | Serve the site at http://localhost:3000, the same way Pages does |
| `SEC_USER_AGENT="Name email" npm run build` | Rebuild `data/` from SEC (add `-- --only AAPL,MSFT` for a few companies) |
| `npm run coverage` | Regenerate `data/coverage.md` from `data/` |
| `npm run stamp` | Update the version stamps in `index.html` (`npm test` checks them) |
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
4. **What it did with the money.** Dividends and buybacks, from the cash flow statement. When a company uses its own tag for them (Simon Property's "PaymentsOfOrdinaryDividendsCommonStockAndPreferredStock"), that's used; failing a payment, the dividends declared or shares bought back in the year from the equity statement. Payments tagged as negative numbers count as payments.

### The page

- **Who gets the $100** (top of the page): the revenue split by who ends up with it, adding up to exactly $100 (`whogets.js`):
  - **Other businesses:** all costs except employee pay: suppliers, materials, rent, advertising, interest.
  - **Workers:** the pay line when the filing reports one (banks usually do). Otherwise an estimate, labeled "at least": employees (from the 10-K text) × the median employee's pay (from the CEO pay-ratio disclosure in the proxy statement, DEF 14A), which counts stock at its value when granted. It understates the total because the average is above the median; for banks that report their actual pay bill, the estimate comes to 40–75% of it. An estimate above 90% of costs is treated as wrong and left out.
  - **Governments:** income taxes, split between the US (federal, state and local) and abroad when the filing breaks it down, compared with the 21% federal rate.
  - **Owners:** dividends and buybacks.
  - **Kept by the company:** profit left after dividends and buybacks. Negative when a company paid out more than it earned.
  A line underneath shows how much of the $100 came from the government.
- **Top 5 lists** (home page): the companies whose $100 goes most to workers, owners (dividends and buybacks) and governments (income taxes), that get the most from the government (as a customer or through federal awards), and that keep the most to reinvest (profit after payouts). Per $100 of revenue in the latest 10-K, built with the data (`scripts/leaders.js` → `data/leaders.json`). A row opens that company.
- **Workers vs owners** (under Owners' profit): a balance scale of pay to workers against dividends and buybacks, per $100. Below it, both over the company's last five fiscal years; pick a year, or press play, and the scale tips year by year. Earlier years are read from each year's own 10-K and proxy statement, the same way as the latest (`yearFromFiling` in `lib/sec.js`), and kept in the company file as `history`. Past filings don't change, so a year already read is reused; a year whose filings lack a headcount or median pay shows as a gap.
  - A headcount or median pay far out of line with the company's other years is taken as misread and left out (`flagOutliers` in `lib/workforce.js`), so that year shows as a gap too: revenue per employee or median pay more than 2.5× away from the other years (5× for the latest year, so growth by acquisition stays), or a headcount that would mean under $10k of revenue per employee. Flagged latest years are listed in `data/coverage.md`.
- **Show details:** filing labels, agency lists and method notes are hidden until the reader turns them on (remembered in the browser).
- Rows under 1¢ per $100 in the Government money & taxes card are combined into one row.
- **Click a row in "Where it goes"** to see what it means: a plain-English explanation (`explain.js`) and, when the filing has one, the company's own description of that line from its 10-K. The build pulls these from the filing text (`lib/describe.js`): the sentence that starts with the line's name and defines it ("Our cost of revenue consists of…"), up to the end of its paragraph. About a third of cost lines have one.
- The effective tax rate and cash taxes paid are shown in the Government money & taxes card.

### Government money

How the US government puts money into the company, in three parts:

1. **As a customer.** Defense and government contractors tag revenue from the US government on the major customers axis (`srt:MajorCustomersAxis`), e.g. Lockheed's "U.S. Government". Filers often tag parts too ("Department of Defense"), so we take the largest figure. When there's only a percentage (`ConcentrationRiskPercentage1`, e.g. Booz Allen's 98% from government contracts), we apply it to revenue.
2. **Federal contracts & awards.** From [USAspending.gov](https://api.usaspending.gov) (no key needed), for the 10-K's fiscal year. Agencies keep reporting awards after a year ends, so the data build refreshes these every run, even when the 10-K hasn't changed. We find the company's top-level recipient records by its exact legal name ("APPLE INC", not "APPLE CORPORATION"), plus a short alias list for companies paid under another name (Alphabet → Google, Amazon → Amazon Web Services). Totals are split into contracts, grants, loans and other payments, by agency.
3. **Tax breaks.** From the income tax rate reconciliation (21% federal tax on pre-tax profit → actual tax): R&D and other credits, the FDII export deduction, extra deductions for employee stock, profits taxed at lower foreign rates, tax-exempt income and other special deductions. Filers disagree on the sign of credits and deductions, so we use their size (they always lower the bill). Rate differences and stock deductions count only when they lower the bill. Filings under the new disclosure rules (ASU 2023-09) split lines by jurisdiction; we add those parts up. When a line is only given as a percentage, we multiply it by pre-tax income.

```
index.html, app.js, format.js, styles.css   The site
government.js      The "Government money & taxes" card
explain.js         Plain-English explanations for the "Where it goes" rows
whogets.js         The five-way split of the $100
data/              Pre-built company data the site reads
scripts/build-data.js   Builds data/ from SEC filings
scripts/leaders.js      The home page's top 5 lists (data/leaders.json)
lib/sec.js         EDGAR fetching (throttled, with retries)
lib/xbrl.js        Instance, label and presentation parsing (no dependencies)
lib/breakdown.js   Picks the revenue breakdowns and turns them into $ per 100
lib/spending.js    Costs, taxes, profit and what happened to the profit
lib/government.js  Government revenue and tax breaks from the 10-K
lib/usaspending.js Federal contracts and awards from USAspending.gov
lib/describe.js    The company's own description of each cost line, from the 10-K text
lib/workforce.js   Headcount (10-K text) and median employee pay (proxy statement)
```

## Known limits

- Worker pay is an estimate for most companies and is on the low side. Headcount and median pay are read from filing text, so a company that phrases them unusually may be missing them (Chevron's headcount, Lilly's and Bank of America's median pay today); its pay then stays inside Other businesses.

- Only S&P 500 companies are included, and the data is refreshed weekly. Some parts of the page are missing for some companies, mostly insurers, real-estate trusts and utilities; see `data/coverage.md`.
- Only US filers that file a 10-K. Foreign companies that file 20-F (e.g. TSMC, Toyota) aren't supported yet.
- Banks and insurers report revenue differently, so their breakdowns are thinner.
- Some companies don't tag their revenue tables in a way we can reconcile, so some views may be missing for them.
- Total employee pay is only shown when the filing reports it as its own line. Most non-financial US companies don't.
- Tax expense is the accounting figure. Cash taxes paid in the same year can be quite different, so we show both.
- Federal awards are what agencies committed (obligated) during the fiscal year, which can differ from the revenue the company booked. Awards to subsidiaries under other names are missed unless listed in `ALIASES` in `lib/usaspending.js`.
- USAspending.gov doesn't show some large awards, e.g. CHIPS Act funding to Intel and Micron, so those companies may show little or nothing.
- State and local subsidies (tax abatements, incentive deals) aren't covered yet. There's no public API for them; [Good Jobs First's Subsidy Tracker](https://subsidytracker.goodjobsfirst.org/) is the main source.
- The tax breaks list only covers what the reconciliation names. Companies fold some breaks into "other" lines.
