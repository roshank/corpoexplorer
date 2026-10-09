import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstance, parsePresentation } from '../lib/xbrl.js';
import { buildSpending, findIncomeStatement } from '../lib/spending.js';

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
