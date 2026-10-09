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
  [/^Other(NoninterestExpense|CostAndExpenseOperating|OperatingIncomeExpenseNet|Expenses|OperatingCostAndExpense|GeneralExpense)$/, 'Other costs'],
];
const PLAIN_BY_LABEL = [
  [/fulfil+ment/i, 'Warehouses & shipping'],
  [/technology (and|&) infrastructure/i, 'Technology & infrastructure'],
  [/compensation|salaries|wages|payroll/i, 'Employee pay & benefits', 'employees'],
];

// Lines tagged as income (credit) reduce costs when positive.
const isIncomeLike = (local) => /IncomeExpenseNet$|^OtherOperatingIncome|Gain/.test(local) && !/^(Loss|Impairment)/.test(local);

/** Full-year, undimensioned, money-valued facts as a Map of qname -> value. */
export function annualFacts(instance, periodEnd) {
  const out = new Map();
  for (const f of instance.facts) {
    if (f.unit && /share/i.test(f.unit)) continue;
    const c = instance.contexts[f.contextRef];
    if (!c || c.dims.length || c.end !== periodEnd || !isFullYear(c)) continue;
    const q = `${f.prefix}:${f.name}`;
    if (!out.has(q)) out.set(q, f.value);
  }
  return out;
}

const local = (q) => q.split(':')[1] ?? q;
const isRevenue = (q) => q.startsWith('us-gaap:') && REVENUE_CONCEPTS.includes(local(q));
const near = (a, b) => a != null && Math.abs(a - b) <= Math.abs(b) * 0.001;
const first = (facts, names) => names.map((n) => facts.get(n.includes(':') ? n : `us-gaap:${n}`)).find((v) => v != null) ?? null;

/** Pick the presentation role that is the income statement. */
export function findIncomeStatement(presentation) {
  const excluded = /(comprehensive|parenthetical|detail|table|polic|tax|segment|narrative|disclosure|quarterly|equity|share)/i;
  let best = null;
  let bestScore = 0;
  for (const r of presentation) {
    const name = r.role.split('/').pop();
    if (excluded.test(name)) continue;
    let score = 0;
    if (/(operations|income|earnings)/i.test(name)) score += 1;
    if (r.concepts.some(isRevenue)) score += 2;
    if (r.concepts.includes(TAX)) score += 2;
    if (r.concepts.some((c) => NET_INCOME.includes(c))) score += 2;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return bestScore >= 5 ? best : null;
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
      if (!facts.has(c) || isRevenue(c) || c === 'us-gaap:GrossProfit') continue;
      pool.push({ id: c, value: isIncomeLike(local(c)) ? -facts.get(c) : facts.get(c) });
    }
  }
  const costItems =
    bestSubset(pool, costTotal, COST_TOLERANCE)?.items ??
    pool.filter((p) => Math.abs(p.value - costTotal) <= Math.abs(costTotal) * COST_TOLERANCE).slice(0, 1);

  let costs = costItems.map((it) => {
    const filingLabel = label(it.id);
    const { name, tag } = plainName(it.id, filingLabel);
    return { kind: 'cost', label: name, filingLabel: name === filingLabel ? null : filingLabel, value: it.value, tag, concept: it.id };
  });
  costs.sort((a, b) => b.value - a.value);
  if (costs.length > MAX_COST_ROWS) {
    const rest = costs.slice(MAX_COST_ROWS - 1);
    costs = [...costs.slice(0, MAX_COST_ROWS - 1), { kind: 'cost', label: 'Smaller costs', value: rest.reduce((s, r) => s + r.value, 0), folded: rest.length }];
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
