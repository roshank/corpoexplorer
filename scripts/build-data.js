// Build the static data the site reads: one JSON file per company plus an index.
//
//   SEC_USER_AGENT="Name email" node scripts/build-data.js [--only AAPL,MSFT]
//
// Covers the S&P 500: the current list comes from Wikipedia (lib/sp500.js) and is saved to
// data/sp500.json, which is used as-is if Wikipedia can't be reached. A company whose latest
// filing hasn't changed since the last build is reused instead of re-downloaded. Ends with a
// coverage report (scripts/coverage.js).

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { companyFromFiling, getTickers, latestAnnualReport } from '../lib/sec.js';
import { getFederalAwards } from '../lib/usaspending.js';
import { companyName, fetchSp500 } from '../lib/sp500.js';
import { stamp } from './stamp.js';
import { coverage } from './coverage.js';
import { writeSectorStats } from './sectors.js';

// Bump when the shape or the logic of the per-company data changes, to force a rebuild.
const DATA_VERSION = 15;

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const COMPANIES = DATA + 'c/';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const only = arg('only')?.toUpperCase().split(',');

const readJson = (path) =>
  readFile(path, 'utf8')
    .then(JSON.parse)
    .catch(() => null);

await mkdir(COMPANIES, { recursive: true });
const previous = (await readJson(DATA + 'companies.json'))?.companies ?? [];

// The S&P 500 list: fresh from Wikipedia, or the last saved copy if that fails.
let sp500;
try {
  sp500 = await fetchSp500();
  const saved = JSON.stringify(sp500, null, 1);
  if (saved !== (await readFile(DATA + 'sp500.json', 'utf8').catch(() => ''))) await writeFile(DATA + 'sp500.json', saved);
} catch (err) {
  sp500 = await readJson(DATA + 'sp500.json');
  if (!sp500) throw new Error(`No S&P 500 list: ${err.message}`);
  console.log(`  warn  Using the saved S&P 500 list: ${err.message}`);
}
const sectorOf = new Map(sp500.map((c) => [c.cik, c.sector]));
const indexName = new Map([...sp500].reverse().map((c) => [c.cik, c.name]));

// One entry per company, with all its share classes (GOOGL/GOOG, FOXA/FOX) from SEC's ticker
// list, in SEC's order (roughly largest first).
const groups = new Map();
for (const t of await getTickers()) {
  if (!sectorOf.has(t.cik)) continue;
  if (!groups.has(t.cik)) groups.set(t.cik, { cik: t.cik, ticker: t.ticker, name: t.name, tickers: [] });
  groups.get(t.cik).tickers.push(t.ticker);
}
// Members missing from SEC's ticker list still get built, under the index's tickers. The index's
// tickers come first: SEC's list can put a preferred share ("F-PD") ahead of the common stock.
for (const c of [...sp500].reverse()) {
  if (!groups.has(c.cik)) groups.set(c.cik, { cik: c.cik, ticker: c.ticker, name: c.name, tickers: [] });
  const g = groups.get(c.cik);
  g.tickers = [c.ticker, ...g.tickers.filter((t) => t !== c.ticker)];
  g.ticker = g.tickers[0];
}
let queue = [...groups.values()];
if (only) queue = queue.filter((g) => g.tickers.some((t) => only.includes(t)));

const built = [];
const stats = { fresh: 0, reused: 0, skipped: 0, failed: 0 };
const started = Date.now();

for (const co of queue) {
  const file = `${COMPANIES}${co.cik}.json`;
  const tag = `${co.ticker.padEnd(6)} ${co.name}`;
  try {
    const filing = await latestAnnualReport(co.cik);
    if (!filing) {
      stats.skipped++;
      console.log(`  skip  ${tag}: no 10-K`);
      continue;
    }
    const old = await readJson(file);
    let data;
    if (old && old.v === DATA_VERSION && old.accession === filing.accession) {
      data = { ...old };
      stats.reused++;
    } else {
      data = { v: DATA_VERSION, ...(await companyFromFiling(co, filing)) };
      stats.fresh++;
      console.log(`  build ${tag}`);
    }
    // Agencies keep reporting awards after the year ends, so these are refreshed every build.
    try {
      data.federal = await getFederalAwards(co.ticker, data.name, data.fiscalYearEnd);
    } catch (err) {
      // The service is down now and then: keep the last figures rather than none.
      if (old?.federal) data.federal = old.federal;
      console.log(`  warn  ${tag}: USAspending: ${err.message}`);
    }
    data.name = companyName(data.name, indexName.get(co.cik));
    if (JSON.stringify(data) !== JSON.stringify(old)) await writeFile(file, JSON.stringify(data));
    built.push({ co, name: data.name });
  } catch (err) {
    // Keep what we had if this was a hiccup; drop it if we never had it.
    const old = await readJson(file);
    if (old) built.push({ co, name: old.name });
    stats.failed++;
    console.log(`  fail  ${tag}: ${err.message}`);
  }
}

// The index the search box uses: one row per ticker, pointing at the company file.
const prevByCik = new Map(previous.map(([, , cik]) => [cik, true]));
const companies = [];
for (const { co, name } of built) for (const t of co.tickers) companies.push([t, name, co.cik, sectorOf.get(co.cik)]);
const index = only
  ? // A partial build keeps everything else that was already there.
    [...previous.filter(([, , cik]) => !built.some((b) => b.co.cik === cik)), ...companies]
  : companies;
await writeFile(DATA + 'companies.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), companies: index }));

// Remove files for companies that dropped out of the list.
if (!only) {
  const keep = new Set(built.map((b) => `${b.co.cik}.json`));
  for (const f of await readdir(COMPANIES)) if (!keep.has(f)) await rm(COMPANIES + f);
}

const secs = Math.round((Date.now() - started) / 1000);
console.log(
  `\n${built.length} companies (${stats.fresh} built, ${stats.reused} unchanged, ${stats.skipped} without a 10-K, ${stats.failed} failed) in ${secs}s` +
    (prevByCik.size ? `; previously ${prevByCik.size}` : ''),
);

// Typical figures per sector, for context on each page.
await writeSectorStats();

// What each part of the page covers, and results that look wrong (data/coverage.md).
await coverage();

// New data means a new data fingerprint in index.html, so browsers fetch it straight away.
if (await stamp()) console.log('Stamped index.html with the new data version.');
