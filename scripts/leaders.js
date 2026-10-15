// The home page's top 5 lists: the companies whose $100 goes most to workers, owners or
// governments, that get the most from the government, and that keep the most for themselves.
// Everything is per $100 of revenue, so a small company can top a list. Stored in data/leaders.json.
//
//   node scripts/leaders.js   (also run by the data build)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { whoGets } from '../whogets.js';
import { governmentShare } from '../government.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOP = 5;
const round = (v) => Math.round(v * 100) / 100;

// [key, what to rank by]; each returns $ per 100 (and whether it's an estimate), or null.
const MEASURES = [
  ['workers', (w) => w?.workers && { per100: w.workers.per100, estimate: w.workers.source === 'estimate' }],
  ['owners', (w) => w && { per100: w.owners.per100 }],
  ['governments', (w) => w && { per100: w.governments.per100 }],
  ['fromGovernment', (w, d) => governmentShare(d) && { per100: governmentShare(d).per100 }],
  ['kept', (w) => w && { per100: w.kept.per100 }],
];

/** { [key]: [{ ticker, name, per100, estimate? }] }, top 5 of each, from the data in data/c. */
export async function leaders() {
  const rows = Object.fromEntries(MEASURES.map(([k]) => [k, []]));
  for (const f of await readdir(DATA + 'c')) {
    const d = JSON.parse(await readFile(`${DATA}c/${f}`, 'utf8'));
    const w = whoGets(d);
    for (const [key, measure] of MEASURES) {
      const m = measure(w, d);
      if (m && m.per100 > 0) rows[key].push({ ticker: d.ticker, name: d.name, per100: round(m.per100), ...(m.estimate ? { estimate: true } : {}) });
    }
  }
  for (const k of Object.keys(rows)) rows[k] = rows[k].sort((a, b) => b.per100 - a.per100).slice(0, TOP);
  return rows;
}

/** Write data/leaders.json. */
export async function writeLeaders() {
  const out = await leaders();
  await writeFile(DATA + 'leaders.json', JSON.stringify(out));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await writeLeaders(), null, 1));
