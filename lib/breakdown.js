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

// More concepts that break revenue down, though they're never the headline total: insurers'
// premiums, REITs' lease income, utilities' operating revenue.
const BREAKDOWN_CONCEPTS = [
  'PremiumsEarnedNet',
  'SupplementaryInsuranceInformationPremiumRevenue',
  'LeaseIncome',
  'OperatingLeaseLeaseIncome',
  'RegulatedAndUnregulatedOperatingRevenue',
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
const PARTIAL = 0.15; // failing that, one may cover 85% (insurers' premiums, REITs' rent), the rest shown as a gap
const RESIDUAL_SHOWN = 0.005; // gaps above 0.5% get their own "not broken out" row
const MAX_CANDIDATES = 20; // subset search is 2^n
const MAX_ROWS = 8;

export const isFullYear = (c) => {
  if (!c.start || !c.end) return false;
  const days = (Date.parse(c.end) - Date.parse(c.start)) / 864e5;
  return days >= 350 && days <= 380;
};

const ELIMINATION = /Elimination|Reconciling|Corporate/;

/**
 * Drop the "operating segments" qualifier some filers add to segment facts, and the
 * corporate qualifier on a segment's own figure. A fact with only an eliminations or
 * corporate qualifier is a consolidation adjustment (CVS: sales between its own businesses).
 * Returns { dims, adjustment } or null when the fact isn't a slice of revenue.
 */
function normalizeDims(dims) {
  const out = [];
  let adjustment = null;
  for (const d of dims) {
    if (d.axis === CONSOLIDATION_AXIS) {
      if (d.member === 'us-gaap:OperatingSegmentsMember') continue;
      if (!ELIMINATION.test(d.member)) return null;
      adjustment = d.member;
      continue;
    }
    out.push(d);
  }
  if (!adjustment) return { dims: out, adjustment: null };
  // A corporate segment's own figure ("Corporate and other") is a segment; reconciling items
  // tagged to a real segment (Nike's $0.05B next to its $45B "NIKE Brand") are not.
  if (out.length === 1 && out[0].axis === SEGMENT_AXIS && /Corporate/.test(adjustment) && !/Elimination|Reconciling/.test(adjustment)) {
    return { dims: out, adjustment: null, corporate: adjustment };
  }
  return out.length === 0 ? { dims: out, adjustment } : null;
}

/**
 * @param {{contexts, facts}} instance  from parseInstance()
 * @param {Record<string,string>} labels from parseLabels()
 * @param {string} [periodEnd] fiscal year end (YYYY-MM-DD); inferred if omitted
 */
export function buildBreakdowns(instance, labels = {}, periodEnd) {
  const label = (q) => labels[q] || humanize(q);

  // All full-year revenue facts, deduplicated. Concepts are qualified names (us-gaap:Revenues).
  const usGaap = new Set([...REVENUE_CONCEPTS, ...BREAKDOWN_CONCEPTS]);
  const rows = [];
  const seen = new Set();
  for (const f of instance.facts) {
    if (!(f.prefix === 'us-gaap' ? usGaap.has(f.name) : /Revenue/.test(f.name))) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.typed || !isFullYear(c)) continue;
    const norm = normalizeDims(c.dims);
    if (!norm) continue;
    const concept = `${f.prefix}:${f.name}`;
    const key = `${concept}|${c.end}|${norm.adjustment ?? norm.corporate ?? ''}|${norm.dims.map((d) => d.axis + '=' + d.member).join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ concept, end: c.end, dims: norm.dims, adjustment: norm.adjustment, corporate: !!norm.corporate, value: f.value });
  }

  const isTotal = (r) => r.dims.length === 0 && !r.adjustment;
  const totals = rows.filter((r) => isTotal(r) && REVENUE_CONCEPTS.includes(r.concept.replace(/^us-gaap:/, '')));
  if (!periodEnd) periodEnd = totals.map((r) => r.end).sort().pop();
  const yearRows = rows.filter((r) => r.end === periodEnd);

  let total = null;
  for (const name of REVENUE_CONCEPTS) {
    const t = yearRows.find((r) => r.concept === `us-gaap:${name}` && isTotal(r));
    if (t) {
      total = { concept: name, value: t.value };
      break;
    }
  }
  if (!total || total.value <= 0) return { periodEnd, total: null, views: [] };

  // Concepts to try: the standard ones, plus a company's own revenue concept when its total
  // matches total revenue (Elevance's "operating revenue", Cigna's "segment revenues").
  const concepts = [...REVENUE_CONCEPTS, ...BREAKDOWN_CONCEPTS].map((n) => `us-gaap:${n}`);
  for (const r of yearRows) {
    if (!r.concept.startsWith('us-gaap:') && isTotal(r) && Math.abs(r.value - total.value) <= total.value * TOLERANCE && !concepts.includes(r.concept)) {
      concepts.push(r.concept);
    }
  }

  const views = [];
  for (const view of VIEWS) {
    // Breakdowns that add up to the total first; only then ones that cover most of it.
    for (const under of [0, PARTIAL]) {
      let best = null;
      for (const concept of concepts) {
        const pool = candidates(yearRows.filter((r) => r.concept === concept), view, label);
        const pick = bestSubset(pool, total.value, TOLERANCE, under);
        if (pick && (!best || better(pick, best))) best = { ...pick, concept: concept.replace(/^us-gaap:/, '') };
      }
      if (best) {
        const v = finishView(view, best, total.value);
        // A breakdown needs at least two real lines: one line and a gap tells the reader nothing.
        if (v.items.filter((i) => !i.residual && !i.folded && !i.adjustment && i.per100 >= 0.5).length >= 2) views.push(v);
        break;
      }
    }
  }

  return { periodEnd, total, views };
}

/**
 * Drop an item that repeats another's exact value under a longer or shorter version of its name:
 * the same line tagged twice (Allstate: "Accident and health insurance" and "Accident and health
 * insurance premiums and contract charges").
 */
const distinct = (items) =>
  items.filter((it, i) => {
    const a = it.label.toLowerCase();
    return !items.some((o, j) => j < i && o.value === it.value && (a.includes(o.label.toLowerCase()) || o.label.toLowerCase().includes(a)));
  });

/** Line items that could make up one view. */
function candidates(rows, view, label) {
  const pool = candidatePool(rows, view, label);
  return pool.alternatives ? { alternatives: pool.alternatives.map(distinct) } : distinct(pool);
}

function candidatePool(rows, view, label) {
  const one = rows.filter((r) => !r.adjustment && r.dims.length === 1 && r.dims[0].axis === view.axis);
  // A corporate-tagged figure only stands in for a segment that has no figure of its own.
  const single = one
    .filter((r) => !r.corporate || !one.some((o) => !o.corporate && o.dims[0].member === r.dims[0].member))
    .map((r) => ({ id: r.dims[0].member, label: label(r.dims[0].member), value: r.value }));
  if (view.axis === SEGMENT_AXIS) {
    // Segments often add up only after removing sales between them (CVS, Cigna).
    const adjustments = rows
      .filter((r) => r.adjustment && r.dims.length === 0)
      .map((r) => ({
        id: `adjust:${r.adjustment}`,
        label: r.value < 0 ? 'Sales between its own businesses' : 'Corporate & other adjustments',
        value: r.value,
        adjustment: true,
      }));
    return adjustments.length && single.length ? { alternatives: [single, [...single, ...adjustments]] } : single;
  }
  if (view.axis !== PRODUCT_AXIS) return single;

  // Products reported inside a segment (e.g. Google: "YouTube ads" within "Google Services").
  // Segments with no product detail are added whole (e.g. "Google Cloud") so the pieces can
  // still add up to the total.
  const nested = rows.filter(
    (r) =>
      !r.adjustment &&
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
    .filter((r) => !r.adjustment && r.dims.length === 1 && r.dims[0].axis === SEGMENT_AXIS && !detailed.has(r.dims[0].member))
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
 * Find the largest set of items whose sum is within `tolerance` of total.
 * Ties go to the closer sum. With `under`, sums up to that fraction *below* total
 * are also accepted (the caller shows the remainder separately).
 */
export function bestSubset(pool, total, tolerance = TOLERANCE, under = 0) {
  if (pool && pool.alternatives) {
    let best = null;
    for (const p of pool.alternatives) {
      const pick = bestSubset(p, total, tolerance, under);
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
    const diff = (sums[mask] - total) / Math.abs(total);
    const err = Math.abs(diff);
    if (diff > tolerance || diff < -Math.max(tolerance, under)) continue;
    if (counts[mask] > counts[bestMask] || (counts[mask] === counts[bestMask] && err < bestErr)) {
      bestMask = mask;
      bestErr = err;
    }
  }
  if (!bestMask) return null;
  return { items: items.filter((_, i) => bestMask & (1 << i)), error: bestErr };
}

function finishView(view, pick, total) {
  // Sales between a company's own businesses are counted in both segments' revenue and taken
  // out once. Show each segment's share of the segments' combined revenue, and say how much
  // was taken out, rather than a negative slice.
  const removed = pick.items.filter((i) => i.adjustment && i.value < 0).reduce((s, i) => s + i.value, 0);
  if (removed) total -= removed;
  // Merge the same product reported under several segments (Walmart "Grocery").
  const merged = new Map();
  for (const it of pick.items) {
    if (it.adjustment && it.value < 0) continue;
    const k = it.mergeKey ?? it.id;
    const m = merged.get(k);
    if (m) m.value += it.value;
    else merged.set(k, { label: it.label, value: it.value, ...(it.adjustment ? { adjustment: true } : {}) });
  }
  // Lines under half a cent per $100 would show as $0.00.
  let items = [...merged.values()].filter((i) => Math.abs(i.value) >= total * 0.00005).sort((a, b) => b.value - a.value);

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
    ...(removed ? { betweenBusinesses: -removed } : {}),
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
