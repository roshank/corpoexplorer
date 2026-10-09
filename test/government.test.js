import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstance } from '../lib/xbrl.js';
import { buildGovernmentCustomer, buildTaxBreaks } from '../lib/government.js';

// Contexts: `dims` is [[axis, member], ...].
const ctx = (id, dims = [], start = '2024-01-01', end = '2024-12-31') => `
  <xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${
    dims.length
      ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join('')}</xbrli:segment>`
      : ''
  }</xbrli:entity>
    <xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>
  </xbrli:context>`;
const fact = (q, value, c = 'fy', unit = 'usd') => {
  const [p, n] = q.split(':');
  return `<${p}:${n} contextRef="${c}" unitRef="${unit}" decimals="-6">${value}</${p}:${n}>`;
};
const xbrl = (body) => parseInstance(`<xbrli:xbrl>${ctx('fy')}${ctx('prior', [], '2023-01-01', '2023-12-31')}${body}</xbrli:xbrl>`);
const PRETAX = 'us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest';

test('buildTaxBreaks reads credits by size and rate differences by sign', () => {
  const t = buildTaxBreaks(
    xbrl(`
      ${fact(PRETAX, 1000)}
      ${fact('us-gaap:IncomeTaxExpenseBenefit', 150)}
      ${fact('us-gaap:IncomeTaxReconciliationIncomeTaxExpenseBenefitAtFederalStatutoryIncomeTaxRate', 210)}
      ${fact('us-gaap:IncomeTaxReconciliationTaxCreditsResearch', -30)}
      ${fact('us-gaap:EffectiveIncomeTaxRateReconciliationFdiiAmount', 20)}
      ${fact('us-gaap:IncomeTaxReconciliationForeignIncomeTaxRateDifferential', -15)}
      ${fact('us-gaap:EffectiveIncomeTaxRateReconciliationShareBasedCompensationExcessTaxBenefitAmount', 5)}
      ${fact('us-gaap:IncomeTaxReconciliationTaxCreditsResearch', 99, 'prior')}
    `),
    '2024-12-31',
  );
  assert.equal(t.statutoryTax, 210);
  assert.equal(t.actualTax, 150);
  // Stock-pay line is positive, so it raised the bill and isn't a break.
  assert.deepEqual(
    t.items.map((i) => [i.key, i.value]),
    [
      ['research', 30],
      ['fdii', 20],
      ['foreign', 15],
    ],
  );
  assert.equal(t.total, 65);
});

test('buildTaxBreaks adds up jurisdictions and ignores the ASU 2023-09 adoption member', () => {
  const geo = 'srt:StatementGeographicalAxis';
  const adopted = ['us-gaap:AdjustmentsForNewAccountingPronouncementsAxis', 'us-gaap:AccountingStandardsUpdate202309ProspectiveMember'];
  const t = buildTaxBreaks(
    parseInstance(`<xbrli:xbrl>
      ${ctx('fy')}${ctx('asu', [adopted])}${ctx('ie', [[geo, 'country:IE']])}${ctx('sg', [[geo, 'country:SG']])}
      ${fact(PRETAX, 1000)}
      ${fact('us-gaap:IncomeTaxExpenseBenefit', 150)}
      ${fact('us-gaap:IncomeTaxReconciliationTaxCreditsResearch', -40, 'asu')}
      ${fact('us-gaap:IncomeTaxReconciliationForeignIncomeTaxRateDifferential', -10, 'ie')}
      ${fact('us-gaap:IncomeTaxReconciliationForeignIncomeTaxRateDifferential', -10, 'ie')}
      ${fact('us-gaap:IncomeTaxReconciliationForeignIncomeTaxRateDifferential', -5, 'sg')}
    </xbrli:xbrl>`),
    '2024-12-31',
  );
  assert.equal(t.statutoryTax, 210); // 21% of pre-tax income when not reported
  assert.deepEqual(
    t.items.map((i) => [i.key, i.value]),
    [
      ['research', 40],
      ['foreign', 15],
    ],
  );
});

test('buildTaxBreaks falls back to percentages and the combined credits line', () => {
  const t = buildTaxBreaks(
    xbrl(`
      ${fact(PRETAX, 2000)}
      ${fact('us-gaap:IncomeTaxExpenseBenefit', 300)}
      ${fact('us-gaap:EffectiveIncomeTaxRateReconciliationFdiiPercent', 0.02, 'fy', 'pure')}
      ${fact('us-gaap:IncomeTaxReconciliationTaxCredits', 50)}
    `),
    '2024-12-31',
  );
  assert.deepEqual(
    t.items.map((i) => [i.key, i.value, i.estimated]),
    [
      ['allCredits', 50, false],
      ['fdii', 40, true],
    ],
  );
});

test('buildTaxBreaks needs pre-tax income and tax', () => {
  assert.equal(buildTaxBreaks(xbrl(fact('us-gaap:IncomeTaxExpenseBenefit', 1)), '2024-12-31'), null);
});

const CUSTOMERS = 'srt:MajorCustomersAxis';

test('buildGovernmentCustomer takes the largest US government revenue figure', () => {
  const g = buildGovernmentCustomer(
    parseInstance(`<xbrli:xbrl>
      ${ctx('usg', [[CUSTOMERS, 'ex:USGovernmentSalesExcludingForeignMilitarySalesMember']])}
      ${ctx('dod', [[CUSTOMERS, 'ex:DepartmentOfDefenseMember']])}
      ${ctx('fms', [[CUSTOMERS, 'ex:ForeignMilitarySalesThroughTheUSGovernmentMember']])}
      ${ctx('seg', [[CUSTOMERS, 'ex:USGovernmentMember'], ['us-gaap:StatementBusinessSegmentsAxis', 'ex:SpaceMember']])}
      ${fact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 600, 'usg')}
      ${fact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 400, 'dod')}
      ${fact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 900, 'fms')}
      ${fact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 950, 'seg')}
    </xbrli:xbrl>`),
    { 'ex:USGovernmentSalesExcludingForeignMilitarySalesMember': 'Sales to the U.S. government' },
    '2024-12-31',
    1000,
  );
  assert.deepEqual(g, {
    value: 600,
    label: 'Sales to the U.S. government',
    member: 'ex:USGovernmentSalesExcludingForeignMilitarySalesMember',
    fromPercent: false,
  });
});

test('buildGovernmentCustomer uses a government contracts concentration percentage', () => {
  const g = buildGovernmentCustomer(
    parseInstance(`<xbrli:xbrl>
      ${ctx('pct', [
        ['srt:StatementGeographicalAxis', 'country:US'],
        ['us-gaap:ConcentrationRiskByBenchmarkAxis', 'us-gaap:SalesRevenueNetMember'],
        ['us-gaap:ConcentrationRiskByTypeAxis', 'us-gaap:GovernmentContractsConcentrationRiskMember'],
      ])}
      ${fact('us-gaap:ConcentrationRiskPercentage1', 0.98, 'pct', 'pure')}
    </xbrli:xbrl>`),
    {},
    '2024-12-31',
    1000,
  );
  assert.equal(g.value, 980);
  assert.equal(g.fromPercent, true);
  assert.equal(g.label, 'US government contracts');
});

test('buildGovernmentCustomer returns null for companies that sell to everyone', () => {
  assert.equal(buildGovernmentCustomer(xbrl(fact('us-gaap:Revenues', 1000)), {}, '2024-12-31', 1000), null);
});
