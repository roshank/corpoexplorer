// Government money in the 10-K itself: how much revenue came from the government
// as a customer, and which tax breaks lowered the company's income tax bill.

import { isFullYear, REVENUE_CONCEPTS } from './breakdown.js';
import { humanize } from './xbrl.js';

const STATUTORY_RATE = 0.21;
const STATUTORY_TAX = 'us-gaap:IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate';
const TAX = 'us-gaap:IncomeTaxExpenseBenefit';
const PRETAX = /^us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes/;

// Lines of the tax rate reconciliation (statutory 21% tax -> actual tax) that are tax breaks.
// Filers don't agree on signs for credits and deductions (Lockheed tags its R&D credit as
// +$187M, Northrop as -$242M), but those always lower the bill, so `lowers: 0` means "use the
// size". Rate differences and excess stock benefits can go either way; filers tag them
// negative when they lower the bill (`lowers: -1`). Newer filings split lines by jurisdiction;
// those parts are added up. Each break has dollar concepts and, for filers that only report
// percentages, percent ones.
export const TAX_BREAKS = [
  {
    key: 'research',
    label: 'Research & development credit',
    note: 'A federal credit for spending on research',
    lowers: 0,
    amount: ['IncomeTaxReconciliationTaxCreditsResearch', 'EffectiveIncomeTaxRateReconciliationTaxCreditResearchAmount'],
    percent: ['EffectiveIncomeTaxRateReconciliationTaxCreditsResearch', 'EffectiveIncomeTaxRateReconciliationTaxCreditResearchPercent'],
  },
  {
    key: 'credits',
    label: 'Energy, investment & other credits',
    note: 'Credits for things like clean energy, manufacturing and hiring',
    lowers: 0,
    amount: ['IncomeTaxReconciliationTaxCreditsInvestment', 'IncomeTaxReconciliationTaxCreditsOther', 'EffectiveIncomeTaxRateReconciliationTaxCreditOtherAmount'],
    percent: ['EffectiveIncomeTaxRateReconciliationTaxCreditsInvestment', 'EffectiveIncomeTaxRateReconciliationTaxCreditsOther', 'EffectiveIncomeTaxRateReconciliationTaxCreditOtherPercent'],
  },
  {
    // The combined credits line, only used when the filing doesn't split it up.
    key: 'allCredits',
    label: 'Tax credits',
    note: 'Federal credits that directly reduce the tax bill',
    lowers: 0,
    onlyIfNone: ['research', 'credits'],
    amount: ['IncomeTaxReconciliationTaxCredits'],
    percent: ['EffectiveIncomeTaxRateReconciliationTaxCredits'],
  },
  {
    key: 'fdii',
    label: 'Lower rate on export profits (FDII)',
    note: 'Profits from selling to customers abroad are taxed at a reduced US rate',
    lowers: 0,
    amount: ['EffectiveIncomeTaxRateReconciliationFdiiAmount'],
    percent: ['EffectiveIncomeTaxRateReconciliationFdiiPercent'],
  },
  {
    key: 'stockPay',
    label: 'Deductions for stock paid to employees',
    note: 'When employee stock rises in value, the company deducts more than it booked as a cost',
    lowers: -1,
    amount: ['EffectiveIncomeTaxRateReconciliationShareBasedCompensationExcessTaxBenefitAmount'],
    percent: ['EffectiveIncomeTaxRateReconciliationShareBasedCompensationExcessTaxBenefitPercent'],
  },
  {
    key: 'foreign',
    label: 'Profits taxed at lower foreign rates',
    note: 'Profits booked in lower-tax countries. Not a US break, but it lowers the overall bill',
    lowers: -1,
    amount: ['IncomeTaxReconciliationForeignIncomeTaxRateDifferential'],
    percent: ['EffectiveIncomeTaxRateReconciliationForeignIncomeTaxRateDifferential'],
  },
  {
    key: 'exempt',
    label: 'Tax-exempt income',
    note: 'Income the law doesn\'t tax, such as interest on municipal bonds',
    lowers: 0,
    amount: ['IncomeTaxReconciliationTaxExemptIncome'],
    percent: ['EffectiveIncomeTaxRateReconciliationTaxExemptIncome'],
  },
  {
    key: 'deductions',
    label: 'Other special deductions',
    note: 'Deductions such as dividends paid to employee stock plans',
    lowers: 0,
    amount: ['IncomeTaxReconciliationDeductionsDividends', 'IncomeTaxReconciliationDeductionsQualifiedProductionActivities', 'IncomeTaxReconciliationDeductionsOther'],
    percent: ['EffectiveIncomeTaxRateReconciliationDeductionsDividends', 'EffectiveIncomeTaxRateReconciliationDeductionsQualifiedProductionActivities', 'EffectiveIncomeTaxRateReconciliationDeductionsOther'],
  },
];

const JURISDICTION_AXIS = /Geographical|Jurisdiction|TaxAuthority|IncomeTax/i;
// Filers adopting the new tax disclosure rules (ASU 2023-09) tag every line with an
// "adopted prospectively" member. It labels the whole table, not a slice of it.
const ADOPTION_MEMBER = /AccountingStandardsUpdate/;
const ownDims = (c) => c.dims.filter((d) => !ADOPTION_MEMBER.test(d.member));
const isPercentUnit = (u) => /pure|number|percent/i.test(u ?? '');

/**
 * Full-year values for each concept in `names` (local us-gaap names), as a Map.
 * Uses the undimensioned fact when there is one, otherwise adds up the
 * by-jurisdiction parts (filings under ASU 2023-09 report some lines only that way).
 */
function collect(instance, periodEnd, names, percent) {
  const want = new Set(names.map((n) => `us-gaap:${n}`));
  const total = new Map();
  const parts = new Map();
  const seen = new Set();
  for (const f of instance.facts) {
    const q = `${f.prefix}:${f.name}`;
    if (!want.has(q) || isPercentUnit(f.unit) !== percent) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    const dims = ownDims(c);
    if (dims.length === 0) {
      if (!total.has(q)) total.set(q, f.value);
    } else if (dims.length === 1 && JURISDICTION_AXIS.test(dims[0].axis)) {
      const key = `${q}|${dims[0].member}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.set(q, (parts.get(q) ?? 0) + f.value);
    }
  }
  for (const [q, v] of parts) if (!total.has(q)) total.set(q, v);
  return total;
}

const sum = (m) => (m.size ? [...m.values()].reduce((s, v) => s + v, 0) : null);

function undimensioned(instance, periodEnd, qname, test = (q) => q === qname) {
  for (const f of instance.facts) {
    if (!test(`${f.prefix}:${f.name}`) || isPercentUnit(f.unit)) continue;
    const c = instance.contexts[f.contextRef];
    if (c && !ownDims(c).length && c.end === periodEnd && isFullYear(c)) return f.value;
  }
  return null;
}

/**
 * Tax breaks from the income tax rate reconciliation.
 * Returns { pretaxIncome, statutoryTax, actualTax, items: [{ key, label, note, value, estimated }], total }
 * or null when the filing has no pre-tax income to compare against.
 */
export function buildTaxBreaks(instance, periodEnd) {
  const pretax = undimensioned(instance, periodEnd, null, (q) => PRETAX.test(q));
  const actual = undimensioned(instance, periodEnd, TAX);
  if (pretax == null || actual == null) return null;
  const statutory = undimensioned(instance, periodEnd, STATUTORY_TAX) ?? pretax * STATUTORY_RATE;

  const items = [];
  for (const b of TAX_BREAKS) {
    if (b.onlyIfNone && items.some((i) => b.onlyIfNone.includes(i.key))) continue;
    let raw = sum(collect(instance, periodEnd, b.amount, false));
    let estimated = false;
    if (raw == null && pretax > 0) {
      const pct = sum(collect(instance, periodEnd, b.percent, true));
      if (pct != null) {
        raw = pct * pretax;
        estimated = true;
      }
    }
    const value = raw == null ? 0 : b.lowers ? raw * b.lowers : Math.abs(raw);
    if (value > 0) items.push({ key: b.key, label: b.label, note: b.note, value: Math.round(value), estimated });
  }
  items.sort((a, b) => b.value - a.value);

  return {
    pretaxIncome: pretax,
    statutoryTax: statutory,
    actualTax: actual,
    items,
    total: items.reduce((s, i) => s + i.value, 0),
  };
}

const MAJOR_CUSTOMERS = 'srt:MajorCustomersAxis';
const GOV_MEMBER = /government|federal|department ?of ?(defense|war)|\bDoD\b|defense/i;
const NOT_US_GOV = /foreign|international|non ?(us|u ?s|government)|commercial|other|private/i;
const CONSOLIDATION_AXIS = 'srt:ConsolidationItemsAxis';
const isRevenue = (q) => q.startsWith('us-gaap:') && REVENUE_CONCEPTS.includes(q.slice(8));

/**
 * Revenue that came from the US government as a customer, when the 10-K tags it
 * (defense and government contractors usually do, on the major customers axis).
 * Filers often tag parts too ("Department of Defense"), so the largest figure wins.
 * Returns { value, label, member, fromPercent } or null.
 */
export function buildGovernmentCustomer(instance, labels, periodEnd, revenue) {
  const memberLabel = (m) => labels[m] || humanize(m);
  const isGov = (m) => {
    const words = `${humanize(m)} ${labels[m] ?? ''}`;
    // "US government, excluding foreign military sales" is still the US government.
    return GOV_MEMBER.test(words) && !NOT_US_GOV.test(words.replace(/\bexcluding\b.*/i, ''));
  };

  let best = null;
  for (const f of instance.facts) {
    const q = `${f.prefix}:${f.name}`;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    const dims = c.dims.filter((d) => !(d.axis === CONSOLIDATION_AXIS && d.member === 'us-gaap:OperatingSegmentsMember'));
    const customer = dims.find((d) => d.axis === MAJOR_CUSTOMERS);

    if (isRevenue(q) && dims.length === 1 && customer && isGov(customer.member)) {
      if (f.value > 0 && f.value <= revenue * 1.001 && (!best || f.value > best.value)) {
        best = { value: f.value, label: memberLabel(customer.member), member: customer.member, fromPercent: false };
      }
      continue;
    }

    // Fallback: a concentration percentage of revenue ("98% of revenue came from US government contracts").
    if (q !== 'us-gaap:ConcentrationRiskPercentage1') continue;
    const benchmark = dims.find((d) => d.axis === 'us-gaap:ConcentrationRiskByBenchmarkAxis');
    if (!benchmark || !/Revenue|Sales/i.test(benchmark.member)) continue;
    const type = dims.find((d) => d.axis === 'us-gaap:ConcentrationRiskByTypeAxis');
    const geo = dims.find((d) => d.axis === 'srt:StatementGeographicalAxis');
    const govType = type?.member === 'us-gaap:GovernmentContractsConcentrationRiskMember' && (!geo || geo.member === 'country:US');
    const govCustomer = customer && isGov(customer.member);
    const other = dims.filter((d) => ![benchmark, type, geo, customer].includes(d));
    if (other.length || !(govType || govCustomer) || !(f.value > 0 && f.value <= 1)) continue;
    const value = f.value * revenue;
    if (!best || value > best.value) {
      best = {
        value,
        label: govCustomer ? memberLabel(customer.member) : 'US government contracts',
        member: govCustomer ? customer.member : type.member,
        fromPercent: true,
      };
    }
  }
  return best;
}

// Income tax split by government: federal, state and local, and foreign. Filers report it as
// totals per jurisdiction or as current and deferred parts; either way they add up to the tax line.
const JURISDICTIONS = {
  federal: ['FederalIncomeTaxExpenseBenefitContinuingOperations', ['CurrentFederalTaxExpenseBenefit', 'DeferredFederalIncomeTaxExpenseBenefit']],
  state: ['StateAndLocalIncomeTaxExpenseBenefitContinuingOperations', ['CurrentStateAndLocalTaxExpenseBenefit', 'DeferredStateAndLocalIncomeTaxExpenseBenefit']],
  foreign: ['ForeignIncomeTaxExpenseBenefitContinuingOperations', ['CurrentForeignTaxExpenseBenefit', 'DeferredForeignIncomeTaxExpenseBenefit']],
};

/**
 * Where the income tax went: { us, federal, state, foreign, total }, or null when the
 * filing's parts don't add up to its total tax.
 */
export function buildTaxSplit(instance, periodEnd) {
  const fact = (name) => undimensioned(instance, periodEnd, `us-gaap:${name}`);
  const total = fact('IncomeTaxExpenseBenefit');
  if (total == null) return null;
  const parts = {};
  for (const [key, [totalName, [current, deferred]]] of Object.entries(JURISDICTIONS)) {
    const whole = fact(totalName);
    const c = fact(current);
    const d = fact(deferred);
    parts[key] = whole ?? (c == null && d == null ? null : (c ?? 0) + (d ?? 0));
  }
  if (parts.federal == null || parts.foreign == null) return null;
  // state stays null when the filing doesn't report it separately (it's then inside federal).
  const sum = parts.federal + (parts.state ?? 0) + parts.foreign;
  if (Math.abs(sum - total) > Math.max(Math.abs(total) * 0.03, 5e7)) return null;
  return { us: parts.federal + (parts.state ?? 0), ...parts, total };
}
