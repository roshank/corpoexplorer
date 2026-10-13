// Coverage report: for every company in data/, which parts of the page we could fill, and
// results that look wrong. Written to data/coverage.md (readable on GitHub) and printed.
//
//   node scripts/coverage.js
//
// Run at the end of every data build. Checking 500 companies by hand doesn't scale, so the
// "Worth a look" list is where to start: unusual results that are often a parsing problem
// (though some are real, like a net tax benefit).

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { whoGets } from '../whogets.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

// The parts of the page, and whether a company has each one.
export const PARTS = [
  ['Where it comes from', (d) => d.views?.length > 0],
  ['Where it goes', (d) => !!d.spending],
  ['Itemized costs', (d) => !!d.spending && flags(d).every((f) => !/^(one cost line|not itemized)/.test(f))],
  ['Workers', (d) => !!whoGets(d)?.workers],
  ['CEO pay multiplier', (d) => !!d.workforce?.ceoRatio],
  ['US vs abroad taxes', (d) => whoGets(d)?.governments?.us != null],
];

// Unusual results checked against the filing and found to be real. Keyed by ticker; each review
// holds for one fiscal year (`fy`, the fiscal year end) and stops applying when a newer filing
// arrives. `flag` is the start of the flag it explains. Add an entry only after checking the
// filing's own numbers.
export const REVIEWED = {
  AES: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $181M on $75M pre-tax income; the 10-K states an effective rate of (241)%' },
  AMD: { flag: 'tax rate', fy: '2025-12-27', note: 'Tax benefit of $103M on $4.1B pre-tax income; the 10-K states (2.5)%' },
  APTV: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax of $700M on $919M pre-tax income; the 10-K states 76%' },
  AVGO: { flag: 'tax rate', fy: '2025-11-02', note: 'Net tax benefit of $397M on $22.7B pre-tax income, per the income statement' },
  AXON: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $106M (stock-pay deductions) on $19M pre-tax income' },
  CSGP: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax of $23M on $30M pre-tax income; the 10-K states 77%' },
  DD: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax of $102M on $200M pre-tax income from continuing operations (domestic loss, foreign profit)' },
  DIS: { flag: 'tax rate', fy: '2025-09-27', note: 'Tax benefit of $1.4B on $12.0B pre-tax income; the 10-K states negative 11.9%' },
  EL: { flag: 'tax rate', fy: '2026-06-30', note: 'Tax of $335M on $517M pre-tax income, per the income statement' },
  GEV: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $2.1B on $2.8B pre-tax income; the 10-K states (72.5)%' },
  GIS: { flag: 'tax rate', fy: '2026-05-31', note: 'Tax of $414M on $406M pre-tax income; the 10-K states 102.2% as reported' },
  GPC: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $14M on $52M pre-tax income; the 10-K states (26.4)%' },
  IBM: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $242M on $10.3B pre-tax income, per the income statement' },
  INTC: { flag: 'tax rate', fy: '2025-12-27', note: 'Tax of $1.5B on $1.6B pre-tax income; the 10-K states 98%' },
  LNT: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $149M on $661M pre-tax income (renewable energy credits)' },
  MGM: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $240M on $281M pre-tax income; the 10-K states (85.5)%' },
  MOS: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax of $640M on $1.2B pre-tax income; the 10-K states 52.7%' },
  NEE: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $802M on $4.5B pre-tax income (clean energy credits); the 10-K states about (18)%' },
  OMC: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax of $242M on $278M pre-tax income; the 10-K states 87%' },
  PCG: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $280M on $2.4B pre-tax income at PG&E Corporation, per the income statement' },
  PFE: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $266M on $7.5B pre-tax income; the 10-K states (3.5)% on continuing operations' },
  PSA: { flag: 'tax rate', fy: '2025-12-31', note: 'A REIT: tax benefit of $7M on $1.8B pre-tax income' },
  QCOM: { flag: 'tax rate', fy: '2025-09-28', note: 'Tax of $7.1B on $12.7B pre-tax income; the 10-K states 56%' },
  RDDT: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $1M on $529M pre-tax income, per the income statement' },
  UBER: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $4.3B on $5.8B pre-tax income, per the income statement' },
  VTR: { flag: 'tax rate', fy: '2025-12-31', note: 'A REIT: tax benefit of $14M on $204M pre-tax income' },
  WY: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $64M on $260M pre-tax income, per the income statement' },
  XEL: { flag: 'tax rate', fy: '2025-12-31', note: 'Tax benefit of $245M on $1.8B pre-tax income; the 10-K states (13.8)%' },
  APP: { flag: 'profit', fy: '2025-12-31', note: 'Net income $3.3B on $5.5B revenue' },
  CME: { flag: 'profit', fy: '2025-12-31', note: 'Net income $4.1B on $6.5B revenue' },
  ECHO: { flag: 'profit', fy: '2025-12-31', note: 'Net loss $14.5B on $15.0B revenue, after large impairments' },
  IBKR: { flag: 'profit', fy: '2025-12-31', note: 'Net income $4.4B (most of it to non-controlling interests) on $6.2B net revenues' },
  LITE: { flag: 'profit', fy: '2026-06-27', note: 'Net loss $6.9B on $3.0B revenue, from a $7.8B loss on extinguishing convertible notes' },
  MRNA: { flag: 'profit', fy: '2025-12-31', note: 'Net loss $2.8B on $1.9B revenue' },
  MU: { flag: 'profit', fy: '2026-09-03', note: 'Net income $85.0B on $133.2B revenue' },
  SPG: { flag: 'profit', fy: '2025-12-31', note: 'Net income $5.4B on $6.4B revenue, mostly gains below operating income' },
  TPL: { flag: 'profit', fy: '2025-12-31', note: 'Net income $481M on $798M revenue' },
  VICI: { flag: 'profit', fy: '2025-12-31', note: 'Net income $2.8B on $4.0B rent' },
  WDC: { flag: 'profit', fy: '2026-07-03', note: 'Net income $9.4B on $12.9B revenue, including a $6.5B gain on its retained Sandisk shares' },
  ERIE: { flag: 'one cost line', fy: '2025-12-31', note: 'The income statement shows one operating expense total ($3.35B, cost of operations), split only by service' },
};

/** The review that explains this flag for this filing, or null. */
export function reviewed(ticker, d, flag) {
  const r = REVIEWED[ticker];
  return r && r.fy === d.fiscalYearEnd && flag.startsWith(r.flag) ? r : null;
}

/** Unusual results: often a sign we read the filing wrong, sometimes real. */
export function flags(d) {
  const out = [];
  const s = d.spending;
  if (!s) return ['no costs read'];
  const costs = s.rows.filter((r) => r.kind === 'cost');
  if (costs.length === 1) out.push('one cost line');
  const gap = s.rows.find((r) => r.residual);
  if (gap && Math.abs(gap.per100) > 3) out.push(`not itemized $${gap.per100.toFixed(2)}`);
  const profit = s.rows.find((r) => r.kind === 'profit')?.per100;
  if (profit > 60 || profit < -50) out.push(`profit $${profit.toFixed(2)} per $100`);
  const rate = s.taxes?.rate;
  if (rate != null && (rate < 0 || rate > 45)) out.push(`tax rate ${rate}%`);
  if (whoGets(d)?.workersMissing === 'implausible') out.push('workers estimate implausible');
  return out;
}

/** Build the report from data/. Returns { total, parts: [[name, count]], flagged: [[ticker, name, flags]], markdown }. */
export async function coverage({ quiet = false } = {}) {
  const index = JSON.parse(await readFile(DATA + 'companies.json', 'utf8'));
  // One row per company: its first ticker and its sector.
  const byCik = new Map();
  for (const [ticker, , cik, sector] of index.companies) if (!byCik.has(cik)) byCik.set(cik, { ticker, sector: sector ?? 'Other' });

  const companies = [];
  for (const f of (await readdir(DATA + 'c')).sort()) {
    const d = JSON.parse(await readFile(`${DATA}c/${f}`, 'utf8'));
    const meta = byCik.get(d.cik) ?? { ticker: d.ticker, sector: 'Other' };
    const all = flags(d);
    const checked = all.map((f) => [f, reviewed(meta.ticker, d, f)]).filter(([, r]) => r);
    companies.push({ d, ...meta, has: PARTS.map(([, ok]) => ok(d)), flags: all.filter((f) => !checked.some(([c]) => c === f)), checked });
  }
  companies.sort((a, b) => a.ticker.localeCompare(b.ticker));

  const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
  const total = companies.length;
  const parts = PARTS.map(([name], i) => [name, companies.filter((c) => c.has[i]).length]);
  const sectors = [...new Set(companies.map((c) => c.sector))].sort();
  const flagged = companies.filter((c) => c.flags.length).map((c) => [c.ticker, c.d.name, c.flags]);
  const checked = companies.filter((c) => c.checked.length);

  const md = [
    '# Data coverage',
    '',
    `${total} companies, built ${index.updated}. Generated by \`scripts/coverage.js\` after each data build.`,
    '',
    '## By part of the page',
    '',
    '| Part | Companies | Share |',
    '| --- | ---: | ---: |',
    ...parts.map(([name, n]) => `| ${name} | ${n} | ${pct(n, total)} |`),
    '',
    '## By sector',
    '',
    `| Sector | Companies | ${PARTS.map(([n]) => n).join(' | ')} |`,
    `| --- | ---: | ${PARTS.map(() => '---:').join(' | ')} |`,
    ...sectors.map((s) => {
      const cs = companies.filter((c) => c.sector === s);
      return `| ${s} | ${cs.length} | ${PARTS.map((_, i) => pct(cs.filter((c) => c.has[i]).length, cs.length)).join(' | ')} |`;
    }),
    '',
    `## Worth a look (${flagged.length})`,
    '',
    'Unusual results. Often the filing was read wrong, but some are real (a net tax benefit, a very profitable year).',
    '',
    '| Ticker | Company | Why |',
    '| --- | --- | --- |',
    ...flagged.map(([t, n, f]) => `| ${t} | ${n.replace(/\|/g, '/')} | ${f.join('; ')} |`),
    '',
    '<details>',
    `<summary>Checked and real (${checked.length})</summary>`,
    '',
    'Unusual results checked against the filing (`REVIEWED` in `scripts/coverage.js`). A check expires when a newer filing arrives.',
    '',
    '| Ticker | Company | Why | Checked |',
    '| --- | --- | --- | --- |',
    ...checked.map((c) => `| ${c.ticker} | ${c.d.name.replace(/\|/g, '/')} | ${c.checked.map(([f]) => f).join('; ')} | ${c.checked.map(([, r]) => r.note).join('; ')} |`),
    '',
    '</details>',
    '',
    '## Missing parts',
    '',
    '| Ticker | Sector | Missing |',
    '| --- | --- | --- |',
    ...companies
      .filter((c) => c.has.some((h) => !h))
      .map((c) => `| ${c.ticker} | ${c.sector} | ${PARTS.filter((_, i) => !c.has[i]).map(([n]) => n).join(', ')} |`),
    '',
  ].join('\n');

  await writeFile(DATA + 'coverage.md', md);
  if (!quiet) {
    console.log(`\nCoverage (${total} companies):`);
    for (const [name, n] of parts) console.log(`  ${name.padEnd(22)} ${String(n).padStart(4)}  ${pct(n, total)}`);
    console.log(`  Worth a look: ${flagged.length} (see data/coverage.md)`);
  }
  return { total, parts, flagged, markdown: md };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await coverage();
