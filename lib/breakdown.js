// Turn a filing's revenue facts into simple "for every $100" breakdowns.
//
// Filings tag revenue many overlapping ways (Apple reports both "Products" and
// "iPhone/Mac/iPad/…"; Google nests ad lines under a segment). For each view we
// pick the most detailed set of line items that actually adds up to total revenue.

import { humanize } from './xbrl.js';

// Revenue concepts, in priority order for the headline total.
export const REVENUE_CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'RevenuesNetOfInterestExpense',
];

const PRODUCT_AXIS = 'srt:ProductOrServiceAxis';
const SEGMENT_AXIS = 'us-gaap:StatementBusinessSegmentsAxis';
const GEO_AXIS = 'srt:StatementGeographicalAxis';
const CONSOLIDATION_AXIS = 'srt:ConsolidationItemsAxis';

export const VIEWS = [
  { key: 'product', axis: PRODUCT_AXIS, title: 'What they sell' },
  { key: 'segment', axis: SEGMENT_AXIS, title: 'Business units' },
  { key: 'geography', axis: GEO_AXIS, title: 'Regions' },
];

const TOLERANCE = 0.01; // a breakdown must add up to within 1% of total revenue
const RESIDUAL_SHOWN = 0.005; // gaps above 0.5% get their own "not broken out" row
const MAX_CANDIDATES = 20; // subset search is 2^n
const MAX_ROWS = 8;

const isFullYear = (c) => {
  if (!c.start || !c.end) return false;
  const days = (Date.parse(c.end) - Date.parse(c.start)) / 864e5;
  return days >= 350 && days <= 380;
};

/** Drop the "operating segments" qualifier some filers add to segment facts. */
function normalizeDims(dims) {
  const out = [];
  for (const d of dims) {
    if (d.axis === CONSOLIDATION_AXIS) {
      if (d.member === 'us-gaap:OperatingSegmentsMember') continue;
      return null; // eliminations, corporate, reconciling items: not a slice of revenue
    }
    out.push(d);
  }
  return out;
}

/**
 * @param {{contexts, facts}} instance  from parseInstance()
 * @param {Record<string,string>} labels from parseLabels()
 * @param {string} [periodEnd] fiscal year end (YYYY-MM-DD); inferred if omitted
 */
export function buildBreakdowns(instance, labels = {}, periodEnd) {
  const label = (q) => labels[q] || humanize(q);

  // All full-year revenue facts, deduplicated.
  const rows = [];
  const seen = new Set();
  for (const f of instance.facts) {
    if (f.prefix !== 'us-gaap' || !REVENUE_CONCEPTS.includes(f.name)) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.typed || !isFullYear(c)) continue;
    const dims = normalizeDims(c.dims);
    if (!dims) continue;
    const key = `${f.name}|${c.end}|${dims.map((d) => d.axis + '=' + d.member).join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ concept: f.name, end: c.end, dims, value: f.value });
  }

  const totals = rows.filter((r) => r.dims.length === 0);
  if (!periodEnd) periodEnd = totals.map((r) => r.end).sort().pop();
  const yearRows = rows.filter((r) => r.end === periodEnd);

  let total = null;
  for (const concept of REVENUE_CONCEPTS) {
    const t = yearRows.find((r) => r.concept === concept && r.dims.length === 0);
    if (t) {
      total = { concept, value: t.value };
      break;
    }
  }
  if (!total || total.value <= 0) return { periodEnd, total: null, views: [] };

  const views = [];
  for (const view of VIEWS) {
    let best = null;
    for (const concept of REVENUE_CONCEPTS) {
      const pool = candidates(yearRows.filter((r) => r.concept === concept), view, label);
      const pick = bestSubset(pool, total.value);
      if (pick && (!best || better(pick, best))) best = { ...pick, concept };
    }
    if (best) views.push(finishView(view, best, total.value));
  }

  return { periodEnd, total, views };
}

/** Line items that could make up one view. */
function candidates(rows, view, label) {
  const single = rows
    .filter((r) => r.dims.length === 1 && r.dims[0].axis === view.axis)
    .map((r) => ({ id: r.dims[0].member, label: label(r.dims[0].member), value: r.value }));
  if (view.axis !== PRODUCT_AXIS) return single;

  // Products reported inside a segment (e.g. Google: "YouTube ads" within "Google Services").
  // Segments with no product detail are added whole (e.g. "Google Cloud") so the pieces can
  // still add up to the total.
  const nested = rows.filter(
    (r) =>
      r.dims.length === 2 &&
      r.dims.some((d) => d.axis === PRODUCT_AXIS) &&
      r.dims.some((d) => d.axis === SEGMENT_AXIS),
  );
  if (!nested.length) return single;
  const segOf = (r) => r.dims.find((d) => d.axis === SEGMENT_AXIS).member;
  const prodOf = (r) => r.dims.find((d) => d.axis === PRODUCT_AXIS).member;
  const detailed = new Set(nested.map(segOf));
  const nestedItems = nested.map((r) => ({
    id: `${segOf(r)}/${prodOf(r)}`,
    mergeKey: prodOf(r),
    label: label(prodOf(r)),
    value: r.value,
  }));
  const wholeSegments = rows
    .filter((r) => r.dims.length === 1 && r.dims[0].axis === SEGMENT_AXIS && !detailed.has(r.dims[0].member))
    .map((r) => ({ id: r.dims[0].member, label: label(r.dims[0].member), value: r.value }));
  const nestedPool = [...nestedItems, ...wholeSegments];
  // Use whichever pool yields the more detailed reconciliation.
  return { alternatives: [single, nestedPool] };
}

function better(a, b) {
  if (a.items.length !== b.items.length) return a.items.length > b.items.length;
  return a.error < b.error;
}

/**
 * Find the largest set of items whose sum is within TOLERANCE of total.
 * Ties go to the closer sum.
 */
export function bestSubset(pool, total) {
  if (pool && pool.alternatives) {
    let best = null;
    for (const p of pool.alternatives) {
      const pick = bestSubset(p, total);
      if (pick && (!best || better(pick, best))) best = pick;
    }
    return best;
  }
  if (!pool || pool.length < 2) return null;
  const items = [...pool].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, MAX_CANDIDATES);
  const n = items.length;
  const sums = new Float64Array(1 << n);
  const counts = new Uint8Array(1 << n);
  let bestMask = 0;
  let bestErr = Infinity;
  for (let mask = 1; mask < 1 << n; mask++) {
    const low = mask & -mask;
    const bit = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + items[bit].value;
    counts[mask] = counts[mask ^ low] + 1;
    if (counts[mask] < 2) continue;
    const err = Math.abs(sums[mask] - total) / total;
    if (err > TOLERANCE) continue;
    if (counts[mask] > counts[bestMask] || (counts[mask] === counts[bestMask] && err < bestErr)) {
      bestMask = mask;
      bestErr = err;
    }
  }
  if (!bestMask) return null;
  return { items: items.filter((_, i) => bestMask & (1 << i)), error: bestErr };
}

function finishView(view, pick, total) {
  // Merge the same product reported under several segments (Walmart "Grocery").
  const merged = new Map();
  for (const it of pick.items) {
    const k = it.mergeKey ?? it.id;
    const m = merged.get(k);
    if (m) m.value += it.value;
    else merged.set(k, { label: it.label, value: it.value });
  }
  let items = [...merged.values()].sort((a, b) => b.value - a.value);

  if (items.length > MAX_ROWS) {
    const keep = items.slice(0, MAX_ROWS - 1);
    const rest = items.slice(MAX_ROWS - 1);
    items = [...keep, { label: 'Everything else', value: rest.reduce((s, i) => s + i.value, 0), folded: rest.length }];
  }

  const sum = items.reduce((s, i) => s + i.value, 0);
  const residual = total - sum;
  let base = sum; // tiny gaps (rounding, hedging) are spread proportionally
  if (Math.abs(residual) / total > RESIDUAL_SHOWN) {
    items.push({ label: residual > 0 ? 'Not broken out in the filing' : 'Adjustments', value: residual, residual: true });
    base = total;
  }

  const per100 = toCents(items.map((i) => (i.value / base) * 100));
  return {
    key: view.key,
    title: view.title,
    concept: pick.concept,
    items: items.map((i, idx) => ({ ...i, per100: per100[idx] })),
  };
}

/** Round shares to cents so they add up to exactly $100.00 (largest remainder). */
export function toCents(shares) {
  const cents = shares.map((s) => s * 100);
  const floors = cents.map(Math.floor);
  let left = 10000 - floors.reduce((a, b) => a + b, 0);
  const order = cents.map((c, i) => [c - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k][1]]++;
  for (let k = order.length - 1; left < 0; k = (k - 1 + order.length) % order.length, left++) floors[order[k][1]]--;
  return floors.map((c) => c / 100);
}
