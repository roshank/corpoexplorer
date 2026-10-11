// Typical figures per sector, for context on each company's page: e.g. REITs must pay out most
// of their income, so owners get far more than workers there by law. Stored in data/companies.json.
//
//   node scripts/sectors.js   (also run by the data build)

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ownersToWorkers, whoGets } from '../whogets.js';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/** { [sector]: { companies, ownersToWorkers } }, from the data in data/c. */
export async function sectorStats(index) {
  const sectorOf = new Map(index.companies.map((r) => [r[2], r[3]]));
  const ratios = {};
  const counts = {};
  for (const f of await readdir(DATA + 'c')) {
    const d = JSON.parse(await readFile(`${DATA}c/${f}`, 'utf8'));
    const sector = sectorOf.get(d.cik);
    if (!sector) continue;
    counts[sector] = (counts[sector] ?? 0) + 1;
    const r = ownersToWorkers(whoGets(d));
    if (r?.ratio != null) (ratios[sector] ??= []).push(r.ratio);
  }
  const out = {};
  for (const s of Object.keys(counts).sort()) {
    const m = median(ratios[s] ?? []);
    out[s] = { companies: counts[s], ownersToWorkers: m == null ? null : Math.round(m * 100) / 100 };
  }
  return out;
}

/** Add sector figures to data/companies.json. */
export async function writeSectorStats() {
  const file = DATA + 'companies.json';
  const index = JSON.parse(await readFile(file, 'utf8'));
  index.sectors = await sectorStats(index);
  await writeFile(file, JSON.stringify(index));
  return index.sectors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await writeSectorStats());
