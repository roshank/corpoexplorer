// Where the money goes: split each $100 of revenue into costs, taxes and profit,
// using the company's own income statement layout. Plus a few cash-flow facts
// that show what happened to the profit (dividends, buybacks, investment).

import { bestSubset, isFullYear, REVENUE_CONCEPTS, toCents } from './breakdown.js';

const OPERATING_INCOME = 'us-gaap:OperatingIncomeLoss';
const TAX = 'us-gaap:IncomeTaxExpenseBenefit';
const NET_INCOME = ['us-gaap:NetIncomeLoss', 'us-gaap:ProfitLoss', 'us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic'];

// Pre-tax income goes by many names: the standard concepts, and filers' own ("Income before
// income taxes and income from operating affiliates", "Earnings before income taxes"). The
// standard domestic and foreign parts are not the total, except for a company with no
// foreign income (homebuilders tag their total as domestic).
const PRETAX_NAME = /^(IncomeLoss|Income|Earnings|Profit)\w*(Before\w*Tax|PreTax)/i;
const NOT_PRETAX = /PerShare|PerBasic|PerDiluted|Percent|Rate|Discontinued|Comprehensive|Reclassification|IncomeTax(es)?(Expense|Paid|Benefit)/i;
const PRETAX_TOTALS = [
  'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
];
const PRETAX_DOMESTIC = 'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic';
const PRETAX_FOREIGN = 'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign';
const isPretax = (q, facts) => {
  const name = q.split(':')[1] ?? q;
  if (!PRETAX_NAME.test(name) || NOT_PRETAX.test(name) || q === PRETAX_FOREIGN) return false;
  return q !== PRETAX_DOMESTIC || !facts.has(PRETAX_FOREIGN);
};

/**
 * Pre-tax income from the facts alone: { key, value }, or null. The standard totals first,
 * then domestic + foreign, then a domestic-only total, then a filer's own concept.
 */
export function pretaxFromFacts(facts) {
  for (const key of PRETAX_TOTALS) if (facts.has(key)) return { key, value: facts.get(key) };
  if (facts.has(PRETAX_DOMESTIC) && facts.has(PRETAX_FOREIGN)) return { key: null, value: facts.get(PRETAX_DOMESTIC) + facts.get(PRETAX_FOREIGN) };
  const key = [...facts.keys()].find((q) => isPretax(q, facts));
  return key ? { key, value: facts.get(key) } : null;
}

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
  [/^(ProvisionForLoanLeaseAndOtherLosses|ProvisionForLoanAndLeaseLosses|ProvisionForLoanLossesExpensed|ProvisionForCreditLosses|CreditLossExpense|ProvisionForDoubtfulAccounts)/, 'Set aside for loans that may not be repaid'],
  [/^(DepreciationDepletionAndAmortization|DepreciationAndAmortization|CostDepreciationAmortizationAndDepletion|Depreciation)$/, 'Wear and tear on equipment'],
  [/^Restructuring/, 'Restructuring (layoffs, closures)'],
  [/^Occupancy/, 'Offices & buildings'],
  [/^(CommunicationsAndInformationTechnology|InformationTechnologyAndDataProcessing)$/, 'Technology & communications'],
  [/^ProfessionalAndContractServicesExpense$/, 'Consultants & contractors'],
  [/Impairment/, 'Write-downs (assets worth less than expected)'],
  // Insurers.
  [/^(PolicyholderBenefitsAndClaimsIncurred|IncurredClaimsPropertyCasualtyAndLiability|BenefitsLossesAndExpensesIncurred|LiabilityForClaimsAndClaimsAdjustmentExpenseIncurredClaims|PolicyholderBenefits$)/, 'Claims paid to policyholders'],
  [/^InterestCreditedToPolicyholdersAccountBalances$/, 'Interest paid to policyholders'],
  [/^PolicyholderDividends/, 'Dividends paid to policyholders'],
  [/PolicyAcquisitionCost/, 'Commissions & costs of selling policies'],
  [/(Remeasurement|ChangeInFairValue)\w*GainLoss/, 'Accounting revaluations'],
  [/^(CostsAndExpenses|OperatingExpenses|OperatingCostsAndExpenses|BenefitsLossesAndExpenses)$/, 'Costs of running the business'],
  [/^Amortization.*Intangible/, 'Cost of past acquisitions (amortization)'],
  [/^Other(NoninterestExpense|CostAndExpenseOperating|OperatingIncomeExpenseNet|Expenses|OperatingCostAndExpense|GeneralExpense)$/, 'Other costs'],
];
const PLAIN_BY_LABEL = [
  [/^(net )?(losses and loss|policy benefits|benefit expense|health care costs|policyholder benefits)/i, 'Claims paid to policyholders'],
  [/acquisition costs/i, 'Commissions & costs of selling policies'],
  [/fulfil+ment/i, 'Warehouses & shipping'],
  [/technology (and|&) infrastructure/i, 'Technology & infrastructure'],
  [/compensation|salaries|wages|payroll/i, 'Employee pay & benefits', 'employees'],
];

// Lines tagged as income (credit) reduce costs when positive: "income (expense)" lines, gains,
// and income of any kind (interest income, equity in affiliates' earnings, other income).
export const isIncomeLike = (local) =>
  (/IncomeExpense|RevenueExpense|^OtherOperatingIncome|^OtherNonoperatingIncome|Gain/.test(local) ||
    (/Income/.test(local) && !/Expense|Cost|Tax|IncomeStatement/.test(local))) &&
  !/^(Loss|Impairment)/.test(local);

// Not cost lines, wherever they sit in the statement.
const NOT_A_LINE = /(Abstract|Axis|Member|Domain|Table|LineItems)$|^(Current|Deferred)?\w{0,20}IncomeTax(es)?(Expense|Benefit)|Comprehensive|PerShare|PerBasic|PerDiluted/;

// Subtotals that sit alongside their own components in the statement.
const SUBTOTALS = /^(CostsAndExpenses|OperatingExpenses|OperatingCostsAndExpenses|BenefitsLossesAndExpenses|NoninterestExpense)$/;
const PRODUCT_AXIS = 'srt:ProductOrServiceAxis';
const PRODUCT_SERVICE = new Set(['us-gaap:ProductMember', 'us-gaap:ServiceMember', 'us-gaap:ServiceOtherMember']);
const CONSOLIDATION_AXIS = 'srt:ConsolidationItemsAxis';
const OPERATING_SEGMENTS = 'us-gaap:OperatingSegmentsMember';

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

/**
 * Lines of a statement laid out as a table (General Motors: Automotive and GM Financial
 * columns; homebuilders: homebuilding and financial services) are often tagged only per
 * column. Adds those up, for lines with no total of their own: the columns are the members the
 * statement itself lists, on one axis.
 */
export function withStatementColumns(instance, statement, periodEnd, facts) {
  const listed = new Set(statement.concepts);
  const parts = new Map(); // qname -> axis -> member -> value
  for (const f of instance.facts) {
    const q = `${f.prefix}:${f.name}`;
    if (facts.has(q) || !listed.has(q) || (f.unit && /share/i.test(f.unit))) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.end !== periodEnd || !isFullYear(c)) continue;
    const dims = c.dims.filter((d) => !(d.axis === CONSOLIDATION_AXIS && d.member === OPERATING_SEGMENTS));
    if (dims.length !== 1 || !listed.has(dims[0].axis) || !listed.has(dims[0].member)) continue;
    const byAxis = parts.get(q) ?? new Map();
    const members = byAxis.get(dims[0].axis) ?? new Map();
    if (!members.has(dims[0].member)) members.set(dims[0].member, f.value);
    byAxis.set(dims[0].axis, members);
    parts.set(q, byAxis);
  }
  if (!parts.size) return facts;
  const out = new Map(facts);
  for (const [q, byAxis] of parts) {
    // Columns on two axes at once would be counted twice.
    if (byAxis.size !== 1) continue;
    const [members] = byAxis.values();
    out.set(q, [...members.values()].reduce((a, b) => a + b, 0));
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
  const lineFacts = statement ? withStatementColumns(instance, statement, periodEnd, facts) : facts;

  // Pre-tax income as the statement shows it: a line named that way above the tax line, or one
  // that equals net income plus tax (Casey's tags it "income attributable to parent").
  const taxAt = concepts.indexOf(TAX);
  const head = taxAt >= 0 ? concepts.slice(0, taxAt) : concepts;
  const nets = NET_INCOME.map((q) => facts.get(q)).filter((v) => v != null);
  const statementPretax =
    head.filter((c) => facts.has(c) && isPretax(c, facts)).at(-1) ??
    (taxAt >= 0 ? head.filter((c) => facts.has(c) && !NET_INCOME.includes(c) && nets.some((n) => near(facts.get(c), n + tax))).at(-1) : null) ??
    null;
  const factsPretax = pretaxFromFacts(facts);

  // Operating income ends the costs only when it's on the statement itself: some insurers
  // report it in a note but not on the income statement (MetLife, Elevance).
  let endKey = null;
  let endValue = null;
  if (facts.has(OPERATING_INCOME) && (concepts.includes(OPERATING_INCOME) || !concepts.length)) endKey = OPERATING_INCOME;
  else if (statementPretax) endKey = statementPretax;
  if (endKey) endValue = facts.get(endKey);
  // No pre-tax line at all (REITs, which pay little tax): the costs run down to net income.
  if (!endKey && concepts.length) {
    endKey = concepts.find((c) => (c === 'us-gaap:ProfitLoss' || c === 'us-gaap:NetIncomeLoss') && facts.has(c)) ?? null;
    if (endKey) endValue = facts.get(endKey) + tax;
  }
  if (!endKey && factsPretax) [endKey, endValue] = [factsPretax.key, factsPretax.value];
  const costTotal = endValue != null ? revenue - endValue : revenue - netIncome - tax;

  // Revenue is the last revenue line matching the total, or failing that any line within 0.5%
  // of it (Bank of New York's total revenue includes its funds' revenue).
  const firstEnd = endKey ? concepts.indexOf(endKey) : -1;
  let start = -1;
  concepts.forEach((c, i) => isRevenue(c) && near(facts.get(c), revenue) && (start = i));
  if (start < 0) {
    concepts.forEach(
      (c, i) => (firstEnd < 0 || i < firstEnd) && facts.has(c) && Math.abs(facts.get(c) - revenue) <= Math.abs(revenue) * 0.005 && (start = i),
    );
  }
  // A bank whose revenue is net interest income plus non-interest income (two lines, apart):
  // the costs follow the second, plus the provision for credit losses between them.
  let provisions = [];
  const [nii, nonInterest] = ['us-gaap:InterestIncomeExpenseNet', 'us-gaap:NoninterestIncome'];
  if (start < 0 && concepts.includes(nii) && concepts.includes(nonInterest) && near(facts.get(nii) + facts.get(nonInterest), revenue)) {
    start = Math.max(concepts.lastIndexOf(nii), concepts.lastIndexOf(nonInterest));
    provisions = concepts.slice(0, start).filter((c) => /^Provision|CreditLoss/.test(local(c)));
  }
  const ends = concepts.flatMap((c, i) => (c === endKey ? [i] : []));
  const end = ends.find((i) => i > start) ?? ends.at(-1) ?? -1;

  // A filer's own subtotal ("Total expenses") counts as one too.
  const isSubtotal = (c) => SUBTOTALS.test(local(c)) || /^Total/.test(local(c)) || /^total\b/i.test(labels[c] ?? '');
  const block = (from, to) => {
    const pool = [];
    const missing = [];
    for (const c of new Set([...(from > 0 ? provisions : []), ...concepts.slice(from, to)])) {
      if (c === endKey || NOT_A_LINE.test(local(c)) || c === 'us-gaap:GrossProfit' || NET_INCOME.includes(c) || isPretax(c, facts)) continue;
      const v = lineFacts.get(c);
      if (v == null) {
        if (!isRevenue(c) && !isSubtotal(c)) missing.push(c);
        continue;
      }
      if (!v || near(v, revenue)) continue;
      // Revenue below the revenue line is income that offsets costs (Camden's fees). Without a
      // revenue line to go by, revenue lines are left out.
      if (isRevenue(c) && (start < 0 || from <= start)) continue;
      pool.push({ id: c, value: isRevenue(c) || isIncomeLike(local(c)) ? -v : v });
    }
    return { pool, missing };
  };
  const choose = ({ pool, missing }) => {
    // Prefer lines that add up exactly; otherwise take the most lines that fit (leaving a
    // "not itemized" remainder), and only then a lone total.
    const lines = pool.filter((p) => !isSubtotal(p.id));
    // A cost line on the statement with no total in the data, only a breakdown (Southern Co.'s
    // and Duke's cost of fuel and power, Deere's cost of sales). When it's the only one, the gap
    // left by the other lines is that line.
    let exactLines = bestSubset(lines, costTotal, COST_TOLERANCE)?.items;
    // A line named like a subtotal can be a line of its own (Berkshire's railroad "operating
    // expenses"): it counts when that adds up better, with more lines.
    const off = (items) => Math.abs(costTotal - items.reduce((s, p) => s + p.value, 0));
    const exactPool = exactLines && bestSubset(pool, costTotal, COST_TOLERANCE)?.items;
    if (exactPool && exactPool.length > exactLines.length && off(exactPool) < off(exactLines)) exactLines = exactPool;
    const withMissing = !exactLines && missing.length === 1 ? bestSubset(lines, costTotal, COST_TOLERANCE, 0.9)?.items : null;
    // In order: real lines that add up; real lines plus the one missing line; anything that adds
    // up (a subtotal standing in for its lines); the most lines that fit; a lone total.
    const items =
      exactLines ??
      withMissing ??
      bestSubset(pool, costTotal, COST_TOLERANCE)?.items ??
      bestSubset(lines, costTotal, COST_TOLERANCE, 0.25)?.items ??
      pool.filter((p) => Math.abs(p.value - costTotal) <= Math.abs(costTotal) * COST_TOLERANCE).slice(0, 1);
    return { items, missingLine: withMissing ? missing[0] : null, exact: !!(exactLines || withMissing), gap: off(items) };
  };
  let picked = choose(end > start ? block(start + 1, end) : { pool: [], missing: [] });
  // Layouts out of the usual order. NVR lists its mortgage banking lines after pre-tax income:
  // when the costs end at pre-tax income, the lines down to the tax line are used if they add
  // up better. Northrop lists cost lines above revenue: when the usual block gives one line at
  // most, every line above the end will do, if they add up exactly.
  if (picked.gap > Math.abs(revenue) * 0.0005 && endKey === statementPretax && taxAt > end && end > start) {
    const longer = choose(block(start + 1, taxAt));
    if (longer.exact && longer.gap < picked.gap && longer.items.length > picked.items.length) picked = longer;
  }
  if (picked.items.length <= 1 && ends.length) {
    const wide = choose(block(0, ends.at(-1)));
    if (wide.exact && wide.items.length > 1) picked = wide;
  }
  const { items: costItems, missingLine } = picked;

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
  // "Costs of running the business" fits a lone total; as one line among several (MetLife's
  // "Operating expenses"), the filing's own name says more.
  if (costs.length > 1) {
    for (const r of costs) if (r.label === 'Costs of running the business' && r.filingLabel) [r.label, r.filingLabel] = [r.filingLabel, null];
  }
  const listed = costs.reduce((s, r) => s + r.value, 0);
  const gap = costTotal - listed;
  if (!costs.length) costs.push({ kind: 'cost', label: 'Costs of running the business', value: costTotal });
  else if (Math.abs(gap) > Math.abs(revenue) * 0.001) {
    if (missingLine && gap > 0) {
      const filingLabel = label(missingLine);
      const { name, tag } = plainName(missingLine, filingLabel);
      costs.push({ kind: 'cost', label: name, filingLabel: name === filingLabel ? null : filingLabel, value: gap, tag, concept: missingLine, derived: true });
      costs.sort((a, b) => b.value - a.value);
    } else {
      costs.push({ kind: 'cost', label: 'Costs not itemized', value: gap, residual: true });
    }
  }

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
  // The tax rate is on the standard pre-tax total when there is one (it includes earnings of
  // affiliates, as Sempra's own rate does), else on the statement's own pre-tax line.
  const pretax = facts.get(PRETAX_TOTALS[0]) ?? (statementPretax ? facts.get(statementPretax) : (factsPretax?.value ?? null));

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
