// Build the static data the site reads: one JSON file per company plus an index.
//
//   SEC_USER_AGENT="Name email" node scripts/build-data.js [--target 50] [--only AAPL,MSFT]
//
// Companies are taken in SEC's ticker-list order (roughly largest first) until
// --target of them have a readable 10-K. A company whose latest filing hasn't
// changed since the last build is reused instead of re-downloaded.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { companyFromFiling, getTickers, latestAnnualReport } from '../lib/sec.js';
import { getFederalAwards } from '../lib/usaspending.js';

// Bump when the shape or the logic of the per-company data changes, to force a rebuild.
const DATA_VERSION = 9;
const MAX_ATTEMPTS_FACTOR = 2; // look at up to target*2 companies to find `target` usable ones

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const COMPANIES = DATA + 'c/';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const target = Number(arg('target')) || 50;
const only = arg('only')?.toUpperCase().split(',');

const readJson = (path) =>
  readFile(path, 'utf8')
    .then(JSON.parse)
    .catch(() => null);

await mkdir(COMPANIES, { recursive: true });
const previous = (await readJson(DATA + 'companies.json'))?.companies ?? [];

// Group share classes (GOOGL/GOOG, BRK-A/BRK-B) under one company.
const groups = new Map();
for (const t of await getTickers()) {
  if (!groups.has(t.cik)) groups.set(t.cik, { cik: t.cik, ticker: t.ticker, name: t.name, tickers: [] });
  groups.get(t.cik).tickers.push(t.ticker);
}
let queue = [...groups.values()];
if (only) queue = queue.filter((g) => g.tickers.some((t) => only.includes(t)));

const built = [];
const stats = { fresh: 0, reused: 0, skipped: 0, failed: 0 };
const started = Date.now();

for (const co of queue.slice(0, only ? queue.length : target * MAX_ATTEMPTS_FACTOR)) {
  if (built.length >= target && !only) break;
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
      console.log(`  warn  ${tag}: USAspending: ${err.message}`);
    }
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
for (const { co, name } of built) for (const t of co.tickers) companies.push([t, name, co.cik]);
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
