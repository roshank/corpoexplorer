import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstance, parsePresentation } from '../lib/xbrl.js';
import { PLAIN_BY_LABEL, buildSpending, findIncomeStatement } from '../lib/spending.js';

const ctx = (id, start = '2024-01-01', end = '2024-12-31') => `
  <xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier></xbrli:entity>
    <xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>
  </xbrli:context>`;
const fact = (q, value, c = 'fy') => {
  const [p, n] = q.split(':');
  return `<${p}:${n} contextRef="${c}" unitRef="usd" decimals="-6">${value}</${p}:${n}>`;
};

// An income statement layout in the shape filers use (abstracts, subtotals, custom lines).
const presentation = (concepts, role = 'http://example.com/role/ConsolidatedStatementsOfOperations') => {
  const locs = concepts.map((c, i) => `<link:loc xlink:type="locator" xlink:label="l${i}" xlink:href="ex.xsd#${c.replace(':', '_')}"/>`);
  const arcs = concepts
    .slice(1)
    .map((_, i) => `<link:presentationArc xlink:type="arc" xlink:from="l0" xlink:to="l${i + 1}" order="${i + 1}"/>`);
  return `<link:presentationLink xlink:type="extended" xlink:role="${role}">${locs.join('')}${arcs.join('')}</link:presentationLink>`;
};

const statement = [
  'us-gaap:IncomeStatementAbstract',
  'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap:CostOfGoodsAndServicesSold',
  'us-gaap:GrossProfit',
  'ex:FulfillmentExpense',
  'us-gaap:ResearchAndDevelopmentExpense',
  'us-gaap:OtherOperatingIncomeExpenseNet',
  'us-gaap:CostsAndExpenses',
  'us-gaap:OperatingIncomeLoss',
  'us-gaap:NonoperatingIncomeExpense',
  'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'us-gaap:IncomeTaxExpenseBenefit',
  'us-gaap:NetIncomeLoss',
];

const instance = parseInstance(`<xbrli:xbrl>
  ${ctx('fy')}${ctx('prior', '2023-01-01', '2023-12-31')}
  ${fact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 1000)}
  ${fact('us-gaap:CostOfGoodsAndServicesSold', 500)}
  ${fact('us-gaap:GrossProfit', 500)}
  ${fact('ex:FulfillmentExpense', 150)}
  ${fact('us-gaap:ResearchAndDevelopmentExpense', 100)}
  ${fact('us-gaap:OtherOperatingIncomeExpenseNet', -50)}
  ${fact('us-gaap:CostsAndExpenses', 800)}
  ${fact('us-gaap:OperatingIncomeLoss', 200)}
  ${fact('us-gaap:NonoperatingIncomeExpense', 20)}
  ${fact('us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 220)}
  ${fact('us-gaap:IncomeTaxExpenseBenefit', 40)}
  ${fact('us-gaap:NetIncomeLoss', 180)}
  ${fact('us-gaap:NetIncomeLoss', 90, 'prior')}
  ${fact('us-gaap:PaymentsForRepurchaseOfCommonStock', 120)}
  ${fact('us-gaap:IncomeTaxesPaidNet', 25)}
  ${fact('us-gaap:ShareBasedCompensation', 30)}
</xbrli:xbrl>`);

const labels = { 'ex:FulfillmentExpense': 'Fulfillment', 'us-gaap:CostOfGoodsAndServicesSold': 'Cost of sales' };

test('parsePresentation keeps statement order', () => {
  const [role] = parsePresentation(`<link:linkbase>${presentation(statement)}</link:linkbase>`);
  assert.deepEqual(role.concepts, statement);
});

test('findIncomeStatement skips detail and comprehensive income roles', () => {
  const roles = parsePresentation(`<link:linkbase>
    ${presentation(statement, 'http://example.com/role/ConsolidatedStatementsOfComprehensiveIncome')}
    ${presentation(statement, 'http://example.com/role/IncomeTaxesDetails')}
    ${presentation(statement)}
  </link:linkbase>`);
  assert.match(findIncomeStatement(roles).role, /ConsolidatedStatementsOfOperations$/);
});

test('buildSpending splits $100 into costs, taxes and profit', () => {
  const pres = parsePresentation(`<link:linkbase>${presentation(statement)}</link:linkbase>`);
  const s = buildSpending(instance, pres, labels, '2024-12-31', 1000);

  assert.deepEqual(
    s.rows.map((r) => [r.label, r.per100]),
    [
      ['Making & delivering what they sell', 50],
      ['Warehouses & shipping', 15],
      ['Research & development', 10],
      ['Other costs', 5],
      ['Extra from investments & interest', -2],
      ['Income taxes', 4],
      ['Kept as profit', 18],
    ],
  );
  assert.equal(s.rows[0].filingLabel, 'Cost of sales');
  assert.equal(s.rows.find((r) => r.kind === 'tax').tag, 'government');
  assert.equal(Math.round(s.rows.reduce((a, r) => a + r.per100, 0) * 100), 10000);

  assert.equal(s.taxes.rate, 18.2);
  assert.equal(s.taxes.cashPaid.per100, 2.5);
  assert.equal(s.afterProfit.buybacks.per100, 12);
  assert.equal(s.afterProfit.dividends, null);
  assert.equal(s.employees.stockPay.per100, 3);
});

test('without a usable layout, costs fall back to a single line that still adds up', () => {
  const s = buildSpending(instance, [], labels, '2024-12-31', 1000);
  assert.deepEqual(
    s.rows.map((r) => [r.label, r.per100]),
    [
      ['Costs of running the business', 80],
      ['Extra from investments & interest', -2],
      ['Income taxes', 4],
      ['Kept as profit', 18],
    ],
  );
});

test('losses are shown as money that came from elsewhere', () => {
  const loss = parseInstance(`<x>${ctx('fy')}
    ${fact('us-gaap:Revenues', 100)}${fact('us-gaap:OperatingIncomeLoss', -20)}
    ${fact('us-gaap:IncomeTaxExpenseBenefit', 0)}${fact('us-gaap:NetIncomeLoss', -20)}</x>`);
  const s = buildSpending(loss, [], {}, '2024-12-31', 100);
  const profit = s.rows.find((r) => r.kind === 'profit');
  assert.equal(profit.label, 'Lost money');
  assert.equal(profit.per100, -20);
  assert.equal(s.taxes.rate, null);
});

test('costs reported only as products + services are added up, and gaps get their own row', () => {
  const ps = (id, member) => `
    <xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>
      <xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">${member}</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
      <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
    </xbrli:context>`;
  const inst = parseInstance(`<x>${ctx('fy')}${ps('p', 'us-gaap:ProductMember')}${ps('s', 'us-gaap:ServiceMember')}
    ${fact('us-gaap:Revenues', 1000)}
    ${fact('us-gaap:CostOfGoodsAndServicesSold', 400, 'p')}${fact('us-gaap:CostOfGoodsAndServicesSold', 100, 's')}
    ${fact('us-gaap:SellingGeneralAndAdministrativeExpense', 150)}
    ${fact('us-gaap:CostsAndExpenses', 700)}
    ${fact('us-gaap:OperatingIncomeLoss', 300)}${fact('us-gaap:IncomeTaxExpenseBenefit', 60)}${fact('us-gaap:NetIncomeLoss', 240)}</x>`);
  const pres = parsePresentation(`<l>${presentation([
    'us-gaap:IncomeStatementAbstract',
    'us-gaap:Revenues',
    'us-gaap:CostOfGoodsAndServicesSold',
    'us-gaap:SellingGeneralAndAdministrativeExpense',
    'us-gaap:CostsAndExpenses',
    'us-gaap:OperatingIncomeLoss',
    'us-gaap:IncomeTaxExpenseBenefit',
    'us-gaap:NetIncomeLoss',
  ])}</l>`);
  const s = buildSpending(inst, pres, {}, '2024-12-31', 1000);
  assert.deepEqual(
    s.rows.map((r) => [r.label, r.per100]),
    [
      ['Making & delivering what they sell', 50],
      ['Sales, marketing & overhead', 15],
      ['Costs not itemized', 5],
      ['Income taxes', 6],
      ['Kept as profit', 24],
    ],
  );
});

const dctx = (id, axis, member) => `
  <xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>
    <xbrli:segment><xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember></xbrli:segment></xbrli:entity>
    <xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate></xbrli:period>
  </xbrli:context>`;
const layout = (concepts) => parsePresentation(`<l>${presentation(concepts)}</l>`);
const rowsOf = (s) => s.rows.map((r) => [r.label, r.per100]);

test('the tax rate uses total pre-tax income, not its domestic part', () => {
  const inst = parseInstance(`<x>${ctx('fy')}
    ${fact('us-gaap:Revenues', 1000)}${fact('us-gaap:OperatingIncomeLoss', 300)}
    ${fact('us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic', 50)}
    ${fact('us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign', 250)}
    ${fact('us-gaap:IncomeTaxExpenseBenefit', 60)}${fact('us-gaap:NetIncomeLoss', 240)}</x>`);
  assert.equal(buildSpending(inst, [], {}, '2024-12-31', 1000).taxes.rate, 20);
  // With no foreign income, the domestic figure is the total (homebuilders).
  const home = parseInstance(`<x>${ctx('fy')}
    ${fact('us-gaap:Revenues', 1000)}${fact('us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic', 300)}
    ${fact('us-gaap:IncomeTaxExpenseBenefit', 60)}${fact('us-gaap:NetIncomeLoss', 240)}</x>`);
  assert.equal(buildSpending(home, [], {}, '2024-12-31', 1000).taxes.rate, 20);
});

test("a filer's own pre-tax line ends the costs, and lines tagged only per column are added up", () => {
  const inst = parseInstance(`<x>${ctx('fy')}${dctx('a', 'ex:GroupAxis', 'ex:AutoMember')}${dctx('f', 'ex:GroupAxis', 'ex:FinanceMember')}
    ${fact('us-gaap:Revenues', 1000)}
    ${fact('us-gaap:CostOfGoodsAndServicesSold', 600, 'a')}
    ${fact('us-gaap:OperatingCostsAndExpenses', 150, 'f')}
    ${fact('us-gaap:InterestIncomeExpenseNonoperatingNet', -50)}
    ${fact('us-gaap:IncomeLossFromEquityMethodInvestments', 30)}
    ${fact('ex:EarningsBeforeIncomeTaxes', 230)}
    ${fact('us-gaap:IncomeTaxExpenseBenefit', 30)}${fact('us-gaap:NetIncomeLoss', 200)}</x>`);
  const pres = layout([
    'us-gaap:IncomeStatementAbstract', 'ex:GroupAxis', 'ex:AutoMember', 'ex:FinanceMember',
    'us-gaap:Revenues', 'us-gaap:CostOfGoodsAndServicesSold', 'us-gaap:OperatingCostsAndExpenses',
    'us-gaap:InterestIncomeExpenseNonoperatingNet', 'us-gaap:IncomeLossFromEquityMethodInvestments',
    'ex:EarningsBeforeIncomeTaxes', 'us-gaap:IncomeTaxExpenseBenefit', 'us-gaap:NetIncomeLoss',
  ]);
  const s = buildSpending(inst, pres, { 'us-gaap:OperatingCostsAndExpenses': 'Finance expenses', 'us-gaap:InterestIncomeExpenseNonoperatingNet': 'Interest, net' }, '2024-12-31', 1000);
  assert.deepEqual(rowsOf(s), [
    ['Making & delivering what they sell', 60],
    ['Finance expenses', 15],
    ['Interest, net', 5],
    ['Other income', -3],
    ['Income taxes', 3],
    ['Kept as profit', 20],
  ]);
  assert.equal(s.taxes.rate, 13);
});

test('without a pre-tax line (REITs), the costs run down to net income', () => {
  const inst = parseInstance(`<x>${ctx('fy')}
    ${fact('us-gaap:Revenues', 1000)}${fact('us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment', 400)}
    ${fact('us-gaap:DepreciationAndAmortization', 300)}${fact('us-gaap:GainLossOnSaleOfProperties', 100)}
    ${fact('us-gaap:ProfitLoss', 400)}${fact('us-gaap:NetIncomeLoss', 400)}</x>`);
  const pres = layout([
    'us-gaap:IncomeStatementAbstract', 'us-gaap:Revenues', 'us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment',
    'us-gaap:DepreciationAndAmortization', 'us-gaap:GainLossOnSaleOfProperties', 'us-gaap:ProfitLoss', 'us-gaap:NetIncomeLoss',
  ]);
  const s = buildSpending(inst, pres, { 'us-gaap:GainLossOnSaleOfProperties': 'Gain on sale', 'us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment': 'Rental' }, '2024-12-31', 1000);
  assert.deepEqual(rowsOf(s), [
    ['Rental', 40],
    ['Wear and tear on equipment', 30],
    ['Gain on sale', -10],
    ['Income taxes', 0],
    ['Kept as profit', 40],
  ]);
});

test("a bank's costs are its provision plus the lines after non-interest income", () => {
  const inst = parseInstance(`<x>${ctx('fy')}
    ${fact('us-gaap:InterestAndDividendIncomeOperating', 900)}${fact('us-gaap:InterestExpenseOperating', 300)}
    ${fact('us-gaap:InterestIncomeExpenseNet', 600)}${fact('us-gaap:ProvisionForLoanLossesExpensed', 50)}
    ${fact('us-gaap:NoninterestIncome', 400)}${fact('us-gaap:LaborAndRelatedExpense', 350)}${fact('us-gaap:OccupancyNet', 100)}
    ${fact('us-gaap:NoninterestExpense', 450)}
    ${fact('us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 500)}
    ${fact('us-gaap:IncomeTaxExpenseBenefit', 100)}${fact('us-gaap:NetIncomeLoss', 400)}</x>`);
  const pres = layout([
    'us-gaap:IncomeStatementAbstract', 'us-gaap:InterestAndDividendIncomeOperating', 'us-gaap:InterestExpenseOperating',
    'us-gaap:InterestIncomeExpenseNet', 'us-gaap:ProvisionForLoanLossesExpensed', 'us-gaap:NoninterestIncome',
    'us-gaap:LaborAndRelatedExpense', 'us-gaap:OccupancyNet', 'us-gaap:NoninterestExpense',
    'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'us-gaap:IncomeTaxExpenseBenefit', 'us-gaap:NetIncomeLoss',
  ]);
  assert.deepEqual(rowsOf(buildSpending(inst, pres, {}, '2024-12-31', 1000)), [
    ['Employee pay & benefits', 35],
    ['Offices & buildings', 10],
    ['Set aside for loans that may not be repaid', 5],
    ['Income taxes', 10],
    ['Kept as profit', 40],
  ]);
});

test('a gain or loss on deferred compensation plans is not employee pay', () => {
  const pay = (label) => PLAIN_BY_LABEL.some(([re, , tag]) => tag === 'employees' && re.test(label));
  assert.equal(pay('Income (Loss) On Deferred Compensation Plans'), false);
  assert.equal(pay('Salaries, wages and benefits'), true);
  assert.equal(pay('Compensation and benefits'), true);
});

test('payouts: company dividend tags, declared dividends, equity-statement buybacks, no negative payments', async () => {
  const { companyDividendTags, companyBuybackTags } = await import('../lib/spending.js');
  const facts = new Map([
    ['spg:PaymentsOfOrdinaryDividendsCommonStockAndPreferredStock', 2793],
    ['us-gaap:PaymentsOfDividendsMinorityInterest', 439],
    ['trgp:PaymentsOfDividendsToNoncontrollingInterests', 34],
    ['pgr:PaymentsforRepurchaseofCommonStockintheOpenMarket', 74],
    ['pgr:PaymentsforRepurchaseofCommonStockforRestrictedStockTaxLiabilities', 92],
  ]);
  assert.deepEqual(companyDividendTags(facts), ['spg:PaymentsOfOrdinaryDividendsCommonStockAndPreferredStock']);
  assert.deepEqual(companyBuybackTags(facts), ['pgr:PaymentsforRepurchaseofCommonStockintheOpenMarket']);
  // Not pay: one-off compensation around an acquisition (Cardinal Health).
  const rule = PLAIN_BY_LABEL.find(([, , tag]) => tag === 'employees')[0];
  assert.equal(rule.test('Acquisition-related cash and share-based compensation costs'), false);
  assert.equal(rule.test('Salaries and employee benefits'), true);
});
