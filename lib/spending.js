// Where the money goes: split each $100 of revenue into costs, taxes and profit,
// using the company's own income statement layout. Plus a few cash-flow facts
// that show what happened to the profit (dividends, buybacks, investment).

import { bestSubset, isFullYear, REVENUE_CONCEPTS, toCents } from './breakdown.js';

const OPERATING_INCOME = 'us-gaap:OperatingIncomeLoss';
const PRETAX = /^us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxes/;
const TAX = 'us-gaap:IncomeTaxExpenseBenefit';
const NET_INCOME = ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss', 'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic'];

const COST_TOLERANCE = 0.005; // cost lines must add up to within 0.5%
const MAX_COST_ROWS = 6;

// Plain-English names for common cost lines. The filing's own label is kept alongside.
const PLAIN = [
  [/^(CostOfRevenue|CostOfGoodsAndServicesSold|CostOfGoodsSold|CostOfServices|CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization|CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization)$/, 'Making & delivering what they sell'],
  [/^ResearchAndDevelopmentExpense/, 'Research & development'],
  [/^(ResearchAndDevelopmentAsset|ResearchAndDevelopmentInProcess|InProcessResearchAndDevelopment)/, 'Buying research projects from other companies'],
  [/^SellingGeneralAndAdministrativeExpense$/, 'Sales, marketing & overhead'],
  [/^(SellingAndMarketingExpense|MarketingExpense|SellingExpense|MarketingAndAdvertisingExpense|AdvertisingExpense)$/, 'Sales & marketing'],
  [/^GeneralAndAdministrativeExpense$/, 'Running the company (overhead)'],
  [/^(LaborAndRelatedExpense|SalariesAndWages|EmployeeBenefitsAndShareBasedCompensation|LaborAndRelatedExpenseIncludingShareBasedCompensation)$/, 'Employee pay & benefits', 'employees'],
  [/^(ProvisionForLoanLeaseAndOtherLosses|ProvisionForLoanAndLeaseLosses|ProvisionForCreditLosses|CreditLossExpense|ProvisionForDoubtfulAccounts)/, 'Set aside for loans that may not be repaid'],
  [/^(DepreciationDepletionAndAmortization|DepreciationAndAmortization|CostDepreciationAmortizationAndDepletion|Depreciation)$/, 'Wear and tear on equipment'],
  [/^Restructuring/, 'Restructuring (layoffs, closures)'],
  [/^Occupancy/, 'Offices & buildings'],
  [/^(CommunicationsAndInformationTechnology|InformationTechnologyAndDataProcessing)$/, 'Technology & communications'],
  [/^ProfessionalAndContractServicesExpense$/, 'Consultants & contractors'],
  [/Impairment/, 'Write-downs (assets worth less than expected)'],
  [/^(CostsAndExpenses|OperatingExpenses|OperatingCostsAndExpenses|BenefitsLossesAndExpenses)$/, 'Costs of running the business'],
  [/^Amortization.*Intangible/, 'Cost of past acquisitions (amortization)'],
  [/^Other(NoninterestExpense|CostAndExpenseOperating|OperatingIncomeExpenseNet|Expenses|OperatingCostAndExpense|GeneralExpense)$/, 'Other costs'],
];
const PLAIN_BY_LABEL = [
  [/fulfil+ment/i, 'Warehouses & shipping'],
  [/technology (and|&) infrastructure/i, 'Technology & infrastructure'],
  [/compensation|salaries|wages|payroll/i, 'Employee pay & benefits', 'employees'],
];

// Lines tagged as income (credit) reduce costs when positive.
const isIncomeLike = (local) =>
  /IncomeExpense(Net)?$|^OtherOperatingIncome|^OtherNonoperatingIncome|Gain/.test(local) && !/^(Loss|Impairment)/.test(local);

// Subtotals that sit alongside their own components in the statement.
const SUBTOTALS = /^(CostsAndExpenses|OperatingExpenses|OperatingCostsAndExpenses|BenefitsLossesAndExpenses|NoninterestExpense)$/;
const PRODUCT_AXIS = 'srt:ProductOrServiceAxis';
const PRODUCT_SERVICE = new Set(['us-gaap:ProductMember', 'us-gaap:ServiceMember', 'us-gaap:ServiceOtherMember']);

/**
 * Full-year, undimensioned, money-valued facts as a Map of qname -> value.
 * A line reported only as products + services (GE's cost of sales) is added up.
 */
export function annualFacts(instance, periodEnd) {
  const out = new Map();
  const split = new Map();
  for (const f of instance.facts) {
    if (f.unit && /share/i.test(f.unit)) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    const q = `${f.prefix}:${f.name}`;
    if (!c.dims.length) {
      if (!out.has(q)) out.set(q, f.value);
    } else if (c.dims.length === 1 && c.dims[0].axis === PRODUCT_AXIS && PRODUCT_SERVICE.has(c.dims[0].member)) {
      const parts = split.get(q) ?? new Map();
      parts.set(c.dims[0].member, f.value);
      split.set(q, parts);
    }
  }
  for (const [q, parts] of split) {
    if (!out.has(q) && parts.size > 1) out.set(q, [...parts.values()].reduce((a, b) => a + b, 0));
  }
  return out;
}

const local = (q) => q.split(':')[1] ?? q;
const isRevenue = (q) => q.startsWith('us-gaap:') && REVENUE_CONCEPTS.includes(local(q));
const near = (a, b) => a != null && Math.abs(a - b) <= Math.abs(b) * 0.001;
const first = (facts, names) => names.map((n) => facts.get(n.includes(':') ? n : `us-gaap:${n}`)).find((v) => v != null) ?? null;

/** Pick the presentation role that is the income statement. */
export function findIncomeStatement(presentation) {
  const excluded = /(parenthetical|detail|table|polic|tax|segment|narrative|disclosure|quarterly|equity|share)/i;
  let best = null;
  let bestScore = 0;
  for (const r of presentation) {
    const name = r.role.split('/').pop();
    if (excluded.test(name)) continue;
    let score = 0;
    if (/(operations|income|earnings)/i.test(name)) score += 1;
    // Prefer the plain income statement, but some filers combine it with comprehensive income.
    if (/comprehensive/i.test(name)) score -= 0.5;
    if (r.concepts.some(isRevenue)) score += 2;
    if (r.concepts.includes(TAX)) score += 2;
    if (r.concepts.some((c) => NET_INCOME.includes(c))) score += 2;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return bestScore >= 4.5 ? best : null;
}

function plainName(qname, filingLabel) {
  for (const [re, name, tag] of PLAIN) if (re.test(local(qname))) return { name, tag };
  for (const [re, name, tag] of PLAIN_BY_LABEL) if (re.test(filingLabel)) return { name, tag };
  return { name: filingLabel, tag: null };
}

/**
 * @param instance   from parseInstance()
 * @param presentation from parsePresentation()
 * @param labels     from parseLabels()
 * @param periodEnd  fiscal year end
 * @param revenue    total revenue (from buildBreakdowns)
 */
export function buildSpending(instance, presentation, labels, periodEnd, revenue) {
  const facts = annualFacts(instance, periodEnd);
  const netIncome = first(facts, NET_INCOME);
  if (netIncome == null || !revenue) return null;
  const tax = facts.get(TAX) ?? 0;
  const label = (q) => labels[q] || local(q).replace(/([a-z])([A-Z])/g, '$1 $2');

  // 1. Costs: the lines between revenue and operating income (or pre-tax income).
  const statement = findIncomeStatement(presentation);
  const concepts = statement?.concepts ?? [];
  let start = -1;
  concepts.forEach((c, i) => isRevenue(c) && near(facts.get(c), revenue) && (start = i));
  const endKey =
    (facts.has(OPERATING_INCOME) && OPERATING_INCOME) ||
    concepts.find((c) => PRETAX.test(c) && facts.has(c)) ||
    [...facts.keys()].find((c) => PRETAX.test(c)) ||
    null;
  const end = endKey ? concepts.indexOf(endKey) : -1;
  const costTotal = endKey ? revenue - facts.get(endKey) : revenue - netIncome - tax;

  const pool = [];
  if (end > start) {
    for (const c of new Set(concepts.slice(start + 1, end))) {
      if (!facts.has(c) || !facts.get(c) || isRevenue(c) || c === 'us-gaap:GrossProfit') continue;
      pool.push({ id: c, value: isIncomeLike(local(c)) ? -facts.get(c) : facts.get(c) });
    }
  }
  // Prefer lines that add up exactly; otherwise take the most lines that fit (leaving a
  // "not itemized" remainder), and only then a lone total.
  const lines = pool.filter((p) => !SUBTOTALS.test(local(p.id)));
  const costItems =
    bestSubset(pool, costTotal, COST_TOLERANCE)?.items ??
    bestSubset(lines, costTotal, COST_TOLERANCE, 0.25)?.items ??
    pool.filter((p) => Math.abs(p.value - costTotal) <= Math.abs(costTotal) * COST_TOLERANCE).slice(0, 1);

  // Same plain name twice (e.g. two amortization lines) becomes one row.
  const byLabel = new Map();
  for (const it of costItems) {
    if (Math.abs(it.value) < Math.abs(revenue) * 0.0005) continue; // under 5 cents per $100
    const filingLabel = label(it.id).replace(/\s*\(Notes? [^)]*\)/g, '');
    let { name, tag } = plainName(it.id, filingLabel);
    // An income line inside the costs block (investment gains, other income).
    if (it.value < 0 && (name === 'Other costs' || (name === filingLabel && !/gain/i.test(name)))) name = 'Other income';
    const key = `${name}|${Math.sign(it.value)}`;
    const row = byLabel.get(key);
    if (row) {
      row.value += it.value;
      row.filingLabel = null;
    } else {
      byLabel.set(key, { kind: 'cost', label: name, filingLabel: name === filingLabel ? null : filingLabel, value: it.value, tag, concept: it.id });
    }
  }
  let costs = [...byLabel.values()].sort((a, b) => b.value - a.value);
  // Fold the smallest costs together; income lines always stay on their own.
  const positive = costs.filter((r) => r.value > 0);
  if (positive.length > MAX_COST_ROWS) {
    const rest = positive.slice(MAX_COST_ROWS - 1);
    costs = [
      ...positive.slice(0, MAX_COST_ROWS - 1),
      { kind: 'cost', label: 'Smaller costs', value: rest.reduce((s, r) => s + r.value, 0), folded: rest.length },
      ...costs.filter((r) => r.value <= 0),
    ];
  }
  const listed = costs.reduce((s, r) => s + r.value, 0);
  const gap = costTotal - listed;
  if (!costs.length) costs.push({ kind: 'cost', label: 'Costs of running the business', value: costTotal });
  else if (Math.abs(gap) > Math.abs(revenue) * 0.001) costs.push({ kind: 'cost', label: 'Costs not itemized', value: gap, residual: true });

  // 2. Below the operating line: interest, investments and anything else, then tax and profit.
  const other = revenue - costTotal - tax - netIncome;
  const rows = [...costs];
  if (Math.abs(other) > Math.abs(revenue) * 0.0005) {
    rows.push({
      kind: 'other',
      label: other > 0 ? 'Interest & other costs' : 'Extra from investments & interest',
      value: other,
    });
  }
  rows.push({ kind: 'tax', label: 'Income taxes', value: tax, tag: 'government' });
  rows.push({ kind: 'profit', label: netIncome >= 0 ? 'Kept as profit' : 'Lost money', value: netIncome });

  const cents = toCents(rows.map((r) => (r.value / revenue) * 100));
  rows.forEach((r, i) => (r.per100 = cents[i]));

  // 3. Context: what happened to the profit, and the details behind taxes and pay.
  const per100 = (v) => (v == null ? null : Math.round((v / revenue) * 10000) / 100);
  const fact = (names) => {
    const value = first(facts, names);
    return value == null ? null : { value, per100: per100(value) };
  };
  const pretax = [...facts.keys()].filter((c) => PRETAX.test(c)).map((c) => facts.get(c))[0] ?? null;

  return {
    rows,
    netIncome,
    afterProfit: {
      dividends: fact(['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'PaymentsOfOrdinaryDividends']),
      buybacks: fact(['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity']),
      investment: fact(['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsToAcquireOtherPropertyPlantAndEquipment']),
    },
    taxes: {
      expense: tax,
      pretaxIncome: pretax,
      rate: pretax > 0 ? Math.round((tax / pretax) * 1000) / 10 : null,
      cashPaid: fact(['IncomeTaxesPaidNet', 'IncomeTaxesPaid']),
    },
    employees: {
      stockPay: fact(['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense']),
      payLine: rows.find((r) => r.tag === 'employees') ?? null,
    },
  };
}
