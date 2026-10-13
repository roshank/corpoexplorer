// Turn a filing's revenue facts into simple "for every $100" breakdowns.
//
// Filings tag revenue many overlapping ways (Apple reports both "Products" and
// "iPhone/Mac/iPad/…"; Google nests ad lines under a segment). For each view we
// pick the most detailed set of line items that actually adds up to total revenue.

import { humanize } from './xbrl.js';

// Revenue concepts, in priority order for the headline total.
export const REVENUE_CONCEPTS = [
  'Revenues',
  // A utility's total operating revenue; its contract revenue leaves some out (NextEra).
  'RegulatedAndUnregulatedOperatingRevenue',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'RevenuesNetOfInterestExpense',
];

// More concepts that break revenue down, though they're never the headline total: insurers'
// premiums, REITs' lease income.
const LEASE_INCOME = ['OperatingLeaseLeaseIncome', 'LeaseIncome'];
const BREAKDOWN_CONCEPTS = ['PremiumsEarnedNet', 'SupplementaryInsuranceInformationPremiumRevenue', ...LEASE_INCOME];

// Banks that tag no revenue total: their revenue is net interest income plus fees and other
// noninterest income.
const NET_INTEREST = 'us-gaap:InterestIncomeExpenseNet';
const NONINTEREST = 'us-gaap:NoninterestIncome';
const BANK_REVENUE = 'NetInterestAndNoninterestIncome';
const BANK_LABELS = { [NET_INTEREST]: 'Net interest income', [NONINTEREST]: 'Fees & other income' };

// Shares of revenue given as percentages (Ross Stores: ladies 29%, home 24%, ...), turned
// into amounts.
const SHARE = 'RevenueShare';
const CONCENTRATION = 'us-gaap:ConcentrationRiskPercentage1';
const BENCHMARK_AXIS = 'us-gaap:ConcentrationRiskByBenchmarkAxis';
const RISK_TYPE_AXIS = 'us-gaap:ConcentrationRiskByTypeAxis';

const PRODUCT_AXIS = 'srt:ProductOrServiceAxis';
const SEGMENT_AXIS = 'us-gaap:StatementBusinessSegmentsAxis';
const GEO_AXIS = 'srt:StatementGeographicalAxis';
const CUSTOMER_AXIS = 'srt:MajorCustomersAxis';
const CONSOLIDATION_AXIS = 'srt:ConsolidationItemsAxis';
const ENTITY_AXIS = 'dei:LegalEntityAxis';

export const VIEWS = [
  { key: 'product', axis: PRODUCT_AXIS, title: 'What they sell' },
  { key: 'segment', axis: SEGMENT_AXIS, title: 'Business units' },
  { key: 'geography', axis: GEO_AXIS, title: 'Regions' },
  { key: 'customers', axis: CUSTOMER_AXIS, title: 'Customers' },
];
const VIEW_AXES = new Set(VIEWS.map((v) => v.axis));

// Revenue lines on the income statement that keep a generic name ("Revenues") on their own.
const LINE_NAMES = {
  'us-gaap:OperatingLeaseLeaseIncome': 'Lease income',
  'us-gaap:LeaseIncome': 'Lease income',
  'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax': 'Other revenue',
  'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax': 'Other revenue',
};
// Labels that only say "revenue": the filing's own ("Revenues") or the taxonomy's.
const GENERIC_LABEL = /^((total )?revenues?\b|revenue from contract with customer)/i;

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
export function buildBreakdowns(instance, labels = {}, periodEnd, statement = []) {
  const label = (q) => BANK_LABELS[q] ?? (labels[q] || humanize(q));

  // All full-year revenue facts, deduplicated. Concepts are qualified names (us-gaap:Revenues).
  const usGaap = new Set([...REVENUE_CONCEPTS, ...BREAKDOWN_CONCEPTS, NET_INTEREST.slice(8), NONINTEREST.slice(8)]);
  const byKey = new Map();
  for (const f of instance.facts) {
    if (!(f.prefix === 'us-gaap' ? usGaap.has(f.name) : /Revenue/.test(f.name))) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.typed || !isFullYear(c)) continue;
    // A slice of one subsidiary's revenue (NextEra's Florida Power & Light segment, Edison's
    // customer classes at Southern California Edison) is a slice of the company's.
    // A segment only when the subsidiary is that segment: Sempra tags each utility's revenue to a
    // generic "reportable segment".
    let entity = c.dims.find((d) => d.axis === ENTITY_AXIS)?.member;
    const slice = c.dims.find((d) => VIEW_AXES.has(d.axis));
    if (!slice || (slice.axis === SEGMENT_AXIS && slice.member !== entity)) entity = undefined;
    const norm = normalizeDims(entity ? c.dims.filter((d) => d.axis !== ENTITY_AXIS) : c.dims);
    if (!norm) continue;
    const concept = `${f.prefix}:${f.name}`;
    const key = `${concept}|${c.end}|${norm.adjustment ?? norm.corporate ?? ''}|${norm.dims.map((d) => d.axis + '=' + d.member).join('|')}`;
    const row = { concept, end: c.end, dims: norm.dims, adjustment: norm.adjustment, corporate: !!norm.corporate, value: f.value, entity };
    const had = byKey.get(key);
    // The company's own figure beats a subsidiary's; two subsidiaries with the same slice cancel out.
    if (!had || (had.entity && !entity)) byKey.set(key, row);
    else if (had.entity && entity && had.entity !== entity) had.conflict = true;
  }
  const rows = [...byKey.values()].filter((r) => !r.conflict);

  const totals = rows.filter((r) => isTotal(r) && REVENUE_CONCEPTS.includes(r.concept.replace(/^us-gaap:/, '')));
  if (!periodEnd) periodEnd = totals.map((r) => r.end).sort().pop();
  const yearRows = rows.filter((r) => r.end === periodEnd);

  let total = undimensionedTotal(yearRows, REVENUE_CONCEPTS);
  // Contract revenue can be only the fees: a bank earns mostly interest (Huntington), a REIT
  // mostly rent (Camden).
  const fees = total && /^RevenueFromContract/.test(total.concept) ? total : null;
  const bank = bankRevenue(yearRows);
  const rent = undimensionedTotal(yearRows, LEASE_INCOME);
  if (bank && (!total || (fees && fees.value < bank.value / 2))) {
    yearRows.push(...bank.rows);
    total = { concept: BANK_REVENUE, value: bank.value, parts: [NET_INTEREST, NONINTEREST] };
  } else if (fees && rent && rent.value > fees.value) {
    total = { concept: rent.concept, value: rent.value + fees.value };
  }
  // No total at all: a REIT's rent, or the pieces of revenue added up.
  total ??= rent ?? totalFromProducts(yearRows);
  if (!total || total.value <= 0) return { periodEnd, total: null, views: [] };
  yearRows.push(...revenueShares(instance, periodEnd, total.value));

  // Concepts to try: the standard ones, plus a company's own revenue concept when its total
  // matches total revenue (Elevance's "operating revenue", Cigna's "segment revenues") or
  // covers most of it (BXP's rental revenue).
  const concepts = [...REVENUE_CONCEPTS, ...BREAKDOWN_CONCEPTS, BANK_REVENUE, SHARE].map((n) => `us-gaap:${n}`);
  for (const r of yearRows) {
    const near = r.value <= total.value * (1 + TOLERANCE) && r.value >= total.value * (1 - PARTIAL);
    if (!r.concept.startsWith('us-gaap:') && isTotal(r) && near && !concepts.includes(r.concept)) {
      concepts.push(r.concept);
    }
  }

  const views = [];
  for (const view of VIEWS) {
    // Breakdowns that add up to the total first; only then ones that cover most of it.
    for (const under of [0, PARTIAL]) {
      let best = null;
      for (const concept of concepts) {
        // Shares given as rounded percentages only when no amounts add up.
        if (concept === `us-gaap:${SHARE}` && best) continue;
        const pool = candidates(yearRows.filter((r) => r.concept === concept), view, label);
        for (const p of pool.alternatives ?? [pool]) {
          const pick = bestSubset(p, total.value, TOLERANCE, under);
          // Two real lines at least: a line and a sliver says nothing (Chevron's "reportable
          // segments" and "all other").
          const real = pick?.items.filter((i) => !i.adjustment && Math.abs(i.value) >= total.value * 0.00495).length;
          if (real >= 2 && (!best || better(pick, best))) best = { ...pick, concept: concept.replace(/^us-gaap:/, '') };
        }
      }
      const v = best && finishView(view, best, total.value);
      if (v && informative(v)) {
        views.push(v);
        break;
      }
    }
  }

  // Failing a products view, the revenue lines on the income statement (Crown Castle: site
  // rental, and services).
  if (!views.some((v) => v.key === 'product')) {
    const lineLabel = (q) => (LINE_NAMES[q] && GENERIC_LABEL.test(label(q)) ? LINE_NAMES[q] : label(q));
    const lines = statementLines(instance, statement, periodEnd, total, lineLabel);
    const pick = lines && bestSubset(lines, total.value, TOLERANCE / 2);
    const v = pick && finishView(VIEWS[0], { ...pick, concept: 'IncomeStatement' }, total.value);
    if (v && informative(v)) views.unshift(v);
  }

  return { periodEnd, total, views };
}

/** A breakdown needs at least two real lines: one line and a gap tells the reader nothing. */
const informative = (v) => v.items.filter((i) => !i.residual && !i.folded && !i.adjustment && i.per100 >= 0.5).length >= 2;

const isTotal = (r) => r.dims.length === 0 && !r.adjustment;

/** The first of these concepts reported as a plain, undimensioned total. */
function undimensionedTotal(rows, names) {
  for (const name of names) {
    const t = rows.find((r) => r.concept === `us-gaap:${name}` && isTotal(r));
    if (t) return { concept: name, value: t.value };
  }
  return null;
}

/**
 * A bank's revenue (net interest income plus noninterest income), and the same sum for every
 * slice both are reported for (each segment). Fee lines reported only as noninterest income
 * sit next to one "Net interest income" line, so the products view can show both.
 */
function bankRevenue(rows) {
  const key = (r) => `${r.adjustment ?? ''}|${r.corporate}|${r.dims.map((d) => d.axis + '=' + d.member).join('|')}`;
  const interest = new Map(rows.filter((r) => r.concept === NET_INTEREST).map((r) => [key(r), r]));
  const fees = rows.filter((r) => r.concept === NONINTEREST);
  const totalInterest = interest.get(key({ dims: [], corporate: false }));
  if (!totalInterest || !fees.some(isTotal)) return null;
  const out = [];
  for (const f of fees) {
    const i = interest.get(key(f));
    if (i) out.push({ ...f, concept: `us-gaap:${BANK_REVENUE}`, value: f.value + i.value });
    else if (!f.adjustment && f.dims.length === 1 && f.dims[0].axis === PRODUCT_AXIS) out.push({ ...f, concept: `us-gaap:${BANK_REVENUE}` });
  }
  // Interest against fees, for banks that break neither down further.
  if (![...interest.values()].some((r) => r.dims[0]?.axis === PRODUCT_AXIS)) {
    out.push({ ...totalInterest, concept: `us-gaap:${BANK_REVENUE}`, dims: [{ axis: PRODUCT_AXIS, member: NET_INTEREST }] });
    out.push({ ...fees.find(isTotal), concept: `us-gaap:${BANK_REVENUE}`, dims: [{ axis: PRODUCT_AXIS, member: NONINTEREST }] });
  }
  const total = out.find(isTotal);
  return { value: total.value, rows: out };
}

/**
 * Revenue shares reported as percentages, as amounts: a concentration-of-sales percentage
 * measured against revenue, or a company's own "percent of sales" concept (Tractor Supply).
 * Each view's percentages must add up to about 100% to count.
 */
function revenueShares(instance, periodEnd, total) {
  const groups = new Map();
  for (const f of instance.facts) {
    const concept = `${f.prefix}:${f.name}`;
    const custom = f.prefix !== 'us-gaap' && /(Revenue|Sales)\w*Percent|Percent\w*(Revenue|Sales)/.test(f.name);
    if (concept !== CONCENTRATION && !custom) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    const benchmark = c.dims.find((d) => d.axis === BENCHMARK_AXIS)?.member;
    if (concept === CONCENTRATION && !/Revenue|Sales/.test(benchmark ?? '')) continue;
    const dims = c.dims.filter((d) => d.axis !== BENCHMARK_AXIS && d.axis !== RISK_TYPE_AXIS);
    if (dims.length !== 1 || !VIEW_AXES.has(dims[0].axis)) continue;
    const key = `${concept}|${dims[0].axis}`;
    const g = groups.get(key) ?? new Map();
    if (!g.has(dims[0].member)) g.set(dims[0].member, f.value);
    groups.set(key, g);
  }
  const out = [];
  for (const [key, shares] of groups) {
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    // Percentages are fractions (0.29), though some filers write 29.
    const scale = Math.abs(sum - 1) <= 0.02 ? 1 : Math.abs(sum - 100) <= 2 ? 100 : 0;
    if (!scale || shares.size < 2) continue;
    const axis = key.split('|')[1];
    for (const [member, pct] of shares) {
      out.push({ concept: `us-gaap:${SHARE}`, end: periodEnd, dims: [{ axis, member }], adjustment: null, corporate: false, value: (pct / scale) * total });
    }
  }
  return out;
}

/**
 * The revenue lines above the total on the income statement: concepts with a figure of their
 * own, and the products or services the statement itself lists (BXP: parking, hotel, ...).
 */
function statementLines(instance, statement, periodEnd, total, label) {
  // Banks list interest income and interest expense above their net revenue.
  if (total.concept === 'RevenuesNetOfInterestExpense') return null;
  const at = statement.indexOf(`us-gaap:${total.concept}`);
  if (at < 1) return null;
  const section = statement.slice(0, at);
  const members = new Set(section.filter((q) => /Member$/.test(q)));
  const lines = new Set(section.filter((q) => !/(Abstract|Axis|Domain|Member|Table|LineItems|List)$/.test(q)));
  const items = new Map();
  for (const f of instance.facts) {
    const q = `${f.prefix}:${f.name}`;
    if (!lines.has(q)) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    // Subtotals ("Total") are left out; their lines are there.
    if (!c.dims.length && !items.has(q) && !/^total\b/i.test(label(q))) items.set(q, { id: q, label: label(q), value: f.value });
    const m = c.dims.length === 1 && c.dims[0].axis === PRODUCT_AXIS && c.dims[0].member;
    if (m && members.has(m) && !items.has(`${q}/${m}`)) items.set(`${q}/${m}`, { id: `${q}/${m}`, label: label(m), value: f.value });
  }
  // A handful of lines, or the search could find a sum by chance.
  return items.size >= 2 && items.size <= 10 ? distinct([...items.values()]) : null;
}

/**
 * Revenue reported only in pieces, with no total (L3Harris: products and services; APA: oil
 * and gas, which is its own production plus what it bought and resold).
 */
function totalFromProducts(rows) {
  for (const name of REVENUE_CONCEPTS) {
    const products = rows.filter((r) => r.concept === `us-gaap:${name}` && !r.adjustment && r.dims.length === 1 && r.dims[0].axis === PRODUCT_AXIS);
    const value = (member) => products.find((r) => r.dims[0].member === member)?.value;
    const [goods, services] = [value('us-gaap:ProductMember'), value('us-gaap:ServiceMember')];
    if (goods != null && services != null) return { concept: name, value: goods + services };
    // A member that is exactly the sum of others is the whole.
    for (const r of [...products].sort((a, b) => b.value - a.value)) {
      const others = products.filter((o) => o !== r).map((o) => ({ value: o.value }));
      if (bestSubset(others, r.value, 0.001)) return { concept: name, value: r.value };
    }
  }
  return null;
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
  // Customer classes often come with their subtotals (Evergy's "total retail", Boeing's "total
  // revenues from contracts"), and sales between a company's own businesses (Freeport).
  const plain = (items) => (view.axis === CUSTOMER_AXIS ? items.filter((i) => !/Total|Intersegment/.test(i.id) && !/^total\b|intersegment/i.test(i.label)) : items);
  const pools = [view.axis === CUSTOMER_AXIS ? withoutSubtotals(plain(single)) : single, ...splitBySecondAxis(rows, view, label).map((p) => withoutSubtotals(plain(p)))];
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
    if (adjustments.length) pools.push(...pools.filter((p) => p.length).map((p) => [...p, ...adjustments]));
  }
  if (view.axis !== PRODUCT_AXIS) return pools.length > 1 ? { alternatives: pools } : pools[0];

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
  if (!nested.length) return pools.length > 1 ? { alternatives: pools } : pools[0];
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
  return { alternatives: [...pools, nestedPool] };
}

/**
 * Drop lines that are exactly the sum of other lines in the pool (Lilly's "Oncology" next to
 * Verzenio and its other cancer drugs), so the pool holds one level of detail.
 */
function withoutSubtotals(items) {
  if (items.length > 16) return items;
  return items.filter((it) => !bestSubset(items.filter((o) => o !== it && Math.abs(o.value) < Math.abs(it.value)), it.value, 0.001));
}

/**
 * Slices reported only split by a second view's axis (Chevron: each segment in the US and
 * abroad; Netflix: each region's streaming revenue), added up. These make a pool of their
 * own, apart from the slices reported alone, which can be a different level of detail.
 * One pool per second axis.
 */
function splitBySecondAxis(rows, view, label) {
  const byAxis = new Map();
  for (const r of rows) {
    if (r.adjustment || r.dims.length !== 2) continue;
    const mine = r.dims.find((d) => d.axis === view.axis);
    const other = r.dims.find((d) => d.axis !== view.axis);
    if (!mine || !VIEW_AXES.has(other.axis)) continue;
    const sums = byAxis.get(other.axis) ?? new Map();
    sums.set(mine.member, (sums.get(mine.member) ?? 0) + r.value);
    byAxis.set(other.axis, sums);
  }
  return [...byAxis.values()].map((sums) => [...sums].map(([m, value]) => ({ id: m, label: label(m), value })));
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
    // Several adjustments of one kind show as one line.
    const k = it.mergeKey ?? (it.adjustment ? it.label : it.id);
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
