import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineSplitYear, parseInstance, parseLabels, humanize } from '../lib/xbrl.js';
import { buildBreakdowns, bestSubset, isFullYear, toCents } from '../lib/breakdown.js';

// A tiny instance modeled on real filings: overlapping product tags (Apple-style),
// products nested inside a segment (Google-style), and an eliminations row to ignore.
const ctx = (id, dims = [], start = '2024-01-01', end = '2024-12-31') => `
  <xbrli:context id="${id}">
    <xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier>
      ${dims.length ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join('')}</xbrli:segment>` : ''}
    </xbrli:entity>
    <xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>
  </xbrli:context>`;
const fact = (concept, ctxId, value) =>
  `<us-gaap:${concept} contextRef="${ctxId}" decimals="-6" unitRef="usd">${value}</us-gaap:${concept}>`;

const P = 'srt:ProductOrServiceAxis';
const S = 'us-gaap:StatementBusinessSegmentsAxis';
const G = 'srt:StatementGeographicalAxis';
const C = 'srt:ConsolidationItemsAxis';
const R = 'RevenueFromContractWithCustomerExcludingAssessedTax';

const instanceXml = `<xbrli:xbrl>
  <dei:EntityRegistrantName contextRef="total">Example &amp; Co.</dei:EntityRegistrantName>
  ${ctx('total')}
  ${ctx('prior', [], '2023-01-01', '2023-12-31')}
  ${ctx('quarter', [], '2024-10-01', '2024-12-31')}
  ${ctx('products', [[P, 'us-gaap:ProductMember']])}
  ${ctx('services', [[P, 'us-gaap:ServiceMember']])}
  ${ctx('phones', [[P, 'ex:PhoneMember']])}
  ${ctx('laptops', [[P, 'ex:LaptopMember']])}
  ${ctx('segA', [[C, 'us-gaap:OperatingSegmentsMember'], [S, 'ex:AmericasSegmentMember']])}
  ${ctx('segB', [[C, 'us-gaap:OperatingSegmentsMember'], [S, 'ex:EuropeSegmentMember']])}
  ${ctx('elim', [[C, 'srt:ConsolidationEliminationsMember']])}
  ${ctx('us', [[G, 'country:US']])}
  ${ctx('nonus', [[G, 'us-gaap:NonUsMember']])}
  ${fact(R, 'total', 1000)}
  ${fact(R, 'prior', 900)}
  ${fact(R, 'quarter', 300)}
  ${fact(R, 'products', 700)}
  ${fact(R, 'services', 300)}
  ${fact(R, 'phones', 500)}
  ${fact(R, 'laptops', 200)}
  ${fact(R, 'segA', 600)}
  ${fact(R, 'segB', 400)}
  ${fact(R, 'elim', -50)}
  ${fact(R, 'us', 550)}
  ${fact(R, 'nonus', 450)}
</xbrli:xbrl>`;

const labelXml = `<link:linkbase><link:labelLink>
  <link:loc xlink:type="locator" xlink:label="loc_phone" xlink:href="ex-20241231.xsd#ex_PhoneMember"/>
  <link:labelArc xlink:type="arc" xlink:from="loc_phone" xlink:to="lab_phone"/>
  <link:label xlink:type="resource" xlink:label="lab_phone" xlink:role="http://www.xbrl.org/2003/role/label">Phone [Member]</link:label>
  <link:label xlink:type="resource" xlink:label="lab_phone" xlink:role="http://www.xbrl.org/2003/role/terseLabel">Phones</link:label>
  <link:loc xlink:type="locator" xlink:label="loc_svc" xlink:href="https://xbrl.fasb.org/us-gaap/2024/elts/us-gaap-2024.xsd#us-gaap_ServiceMember"/>
  <link:labelArc xlink:type="arc" xlink:from="loc_svc" xlink:to="lab_svc"/>
  <link:label xlink:type="resource" xlink:label="lab_svc" xlink:role="http://www.xbrl.org/2003/role/label">Service [Member]</link:label>
</link:labelLink></link:linkbase>`;

test('parseInstance reads contexts, numeric facts and the company name', () => {
  const inst = parseInstance(instanceXml);
  assert.equal(inst.entityName, 'Example & Co.');
  assert.equal(inst.facts.length, 12);
  assert.deepEqual(inst.contexts.segA.dims[1], { axis: S, member: 'ex:AmericasSegmentMember' });
  assert.equal(inst.contexts.total.end, '2024-12-31');
});

test('parseLabels prefers terse labels and strips [Member]', () => {
  const labels = parseLabels(labelXml);
  assert.equal(labels['ex:PhoneMember'], 'Phones');
  assert.equal(labels['us-gaap:ServiceMember'], 'Service');
});

test('humanize falls back to readable names', () => {
  assert.equal(humanize('ex:WearablesHomeAndAccessoriesMember'), 'Wearables Home And Accessories');
  assert.equal(humanize('ex:AmericasSegmentMember'), 'Americas');
  assert.equal(humanize('country:US'), 'United States');
});

test('buildBreakdowns picks the most detailed set that adds up to the total', () => {
  const res = buildBreakdowns(parseInstance(instanceXml), parseLabels(labelXml), '2024-12-31');
  assert.equal(res.total.value, 1000);

  const product = res.views.find((v) => v.key === 'product');
  assert.deepEqual(
    product.items.map((i) => [i.label, i.per100]),
    [
      ['Phones', 50],
      ['Service', 30],
      ['Laptop', 20],
    ],
  );

  const segment = res.views.find((v) => v.key === 'segment');
  assert.deepEqual(segment.items.map((i) => i.label), ['Americas', 'Europe']);

  const geo = res.views.find((v) => v.key === 'geography');
  assert.deepEqual(geo.items.map((i) => i.per100), [55, 45]);
});

test('buildBreakdowns infers the latest fiscal year when no period is given', () => {
  const res = buildBreakdowns(parseInstance(instanceXml));
  assert.equal(res.periodEnd, '2024-12-31');
});

test('products nested in segments are combined with whole segments', () => {
  const xml = `<x>
    ${ctx('t')}
    ${ctx('search', [[P, 'ex:SearchMember'], [S, 'ex:ServicesMember']])}
    ${ctx('video', [[P, 'ex:VideoMember'], [S, 'ex:ServicesMember']])}
    ${ctx('services', [[S, 'ex:ServicesMember']])}
    ${ctx('cloud', [[S, 'ex:CloudMember']])}
    ${fact('Revenues', 't', 100)}
    ${fact(R, 'search', 60)}
    ${fact(R, 'video', 20)}
    ${fact(R, 'services', 80)}
    ${fact(R, 'cloud', 20)}
  </x>`;
  const res = buildBreakdowns(parseInstance(xml), {}, '2024-12-31');
  const product = res.views.find((v) => v.key === 'product');
  assert.deepEqual(product.items.map((i) => i.label), ['Search', 'Video', 'Cloud']);
});

test('a gap between the pieces and the total gets its own row', () => {
  const pick = bestSubset(
    [
      { id: 'a', value: 600 },
      { id: 'b', value: 392 },
    ],
    1000,
  );
  assert.equal(pick.items.length, 2);

  const xml = `<x>${ctx('t')}${ctx('a', [[G, 'country:US']])}${ctx('b', [[G, 'us-gaap:NonUsMember']])}
    ${fact('Revenues', 't', 1000)}${fact('Revenues', 'a', 600)}${fact('Revenues', 'b', 392)}</x>`;
  const geo = buildBreakdowns(parseInstance(xml), {}, '2024-12-31').views[0];
  assert.equal(geo.items.at(-1).residual, true);
  assert.equal(geo.items.at(-1).per100, 0.8);
});

test('breakdowns that do not add up are dropped', () => {
  assert.equal(bestSubset([{ value: 300 }, { value: 300 }], 1000), null);
});

test('toCents always sums to exactly $100', () => {
  for (const shares of [
    [33.333, 33.333, 33.334],
    [50.004, 49.996],
    [60.5, 40.2, -0.7],
    [12.345, 23.456, 34.567, 29.632],
  ]) {
    const cents = toCents(shares);
    assert.equal(Math.round(cents.reduce((a, b) => a + b, 0) * 100), 10000, shares.join());
  }
});

const C2 = 'srt:MajorCustomersAxis';
const E = 'dei:LegalEntityAxis';
const xml = (body) => `<x>${body}</x>`;

test('a bank without a revenue total earns net interest income plus noninterest income', () => {
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}${ctx('card', [[P, 'us-gaap:CreditCardMember']])}${ctx('trust', [[P, 'us-gaap:FiduciaryAndTrustMember']])}
      ${ctx('a', [[S, 'ex:ConsumerMember']])}${ctx('b', [[S, 'ex:WholesaleMember']])}
      ${fact('InterestIncomeExpenseNet', 't', 700)}${fact('NoninterestIncome', 't', 300)}
      ${fact('NoninterestIncome', 'card', 180)}${fact('NoninterestIncome', 'trust', 120)}
      ${fact('InterestIncomeExpenseNet', 'a', 400)}${fact('InterestIncomeExpenseNet', 'b', 300)}
      ${fact('NoninterestIncome', 'a', 100)}${fact('NoninterestIncome', 'b', 200)}`),
    ),
    {},
    '2024-12-31',
  );
  assert.equal(res.total.value, 1000);
  assert.deepEqual(res.total.parts, ['us-gaap:InterestIncomeExpenseNet', 'us-gaap:NoninterestIncome']);
  const product = res.views.find((v) => v.key === 'product');
  assert.deepEqual(
    product.items.map((i) => [i.label, i.per100]),
    [
      ['Net interest income', 70],
      ['Credit Card', 18],
      ['Fiduciary And Trust', 12],
    ],
  );
  const segment = res.views.find((v) => v.key === 'segment');
  assert.deepEqual(
    segment.items.map((i) => [i.label, i.per100]),
    [
      ['Consumer', 50],
      ['Wholesale', 50],
    ],
  );
});

test("a bank's fee-only contract revenue gives way to its whole revenue", () => {
  const res = buildBreakdowns(
    parseInstance(xml(`${ctx('t')}${fact(R, 't', 150)}${fact('InterestIncomeExpenseNet', 't', 700)}${fact('NoninterestIncome', 't', 300)}`)),
    {},
    '2024-12-31',
  );
  assert.equal(res.total.value, 1000);
  assert.deepEqual(res.views[0].items.map((i) => i.label), ['Net interest income', 'Fees & other income']);
});

test('with no total, revenue is products plus services, or a member that sums the others', () => {
  const goods = buildBreakdowns(
    parseInstance(xml(`${ctx('p', [[P, 'us-gaap:ProductMember']])}${ctx('s', [[P, 'us-gaap:ServiceMember']])}${fact(R, 'p', 700)}${fact(R, 's', 300)}`)),
    {},
    '2024-12-31',
  );
  assert.equal(goods.total.value, 1000);
  const oil = buildBreakdowns(
    parseInstance(
      xml(`${ctx('all', [[P, 'ex:OilAndGasMember']])}${ctx('own', [[P, 'ex:ProducedMember']])}${ctx('bought', [[P, 'ex:PurchasedMember']])}
      ${fact('Revenues', 'all', 900)}${fact('Revenues', 'own', 700)}${fact('Revenues', 'bought', 200)}`),
    ),
    {},
    '2024-12-31',
  );
  assert.equal(oil.total.value, 900);
  assert.deepEqual(oil.views[0].items.map((i) => i.label), ['Produced', 'Purchased']);
});

test("a utility's operating revenue outranks its contract revenue; a REIT's rent counts", () => {
  const utility = buildBreakdowns(
    parseInstance(xml(`${ctx('t')}${fact(R, 't', 900)}${fact('RegulatedAndUnregulatedOperatingRevenue', 't', 1000)}`)),
    {},
    '2024-12-31',
  );
  assert.equal(utility.total.value, 1000);
  const rentOnly = buildBreakdowns(parseInstance(xml(`${ctx('t')}${fact('OperatingLeaseLeaseIncome', 't', 500)}`)), {}, '2024-12-31');
  assert.equal(rentOnly.total.value, 500);
});

test("slices split by a second axis are added up (each segment's US and foreign sales)", () => {
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}
      ${ctx('up-us', [[S, 'ex:UpstreamMember'], [G, 'country:US']])}${ctx('up-intl', [[S, 'ex:UpstreamMember'], [G, 'us-gaap:NonUsMember']])}
      ${ctx('down-us', [[S, 'ex:DownstreamMember'], [G, 'country:US']])}${ctx('down-intl', [[S, 'ex:DownstreamMember'], [G, 'us-gaap:NonUsMember']])}
      ${fact('Revenues', 't', 1000)}${fact('Revenues', 'up-us', 100)}${fact('Revenues', 'up-intl', 200)}${fact('Revenues', 'down-us', 300)}${fact('Revenues', 'down-intl', 400)}`),
    ),
    {},
    '2024-12-31',
  );
  const items = (key) => res.views.find((v) => v.key === key).items.map((i) => [i.label, i.per100]);
  assert.deepEqual(items('segment'), [
    ['Downstream', 70],
    ['Upstream', 30],
  ]);
  assert.deepEqual(items('geography'), [
    ['Non Us', 60],
    ['United States', 40],
  ]);
});

test("one subsidiary's breakdown stands for the company's; two subsidiaries' clashing figures don't", () => {
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}
      ${ctx('res', [[C2, 'ex:ResidentialMember'], [E, 'ex:UtilityMember']])}${ctx('com', [[C2, 'ex:CommercialMember'], [E, 'ex:UtilityMember']])}
      ${ctx('gas1', [[P, 'ex:GasMember'], [E, 'ex:UtilityMember']])}${ctx('gas2', [[P, 'ex:GasMember'], [E, 'ex:OtherUtilityMember']])}
      ${ctx('el', [[P, 'ex:ElectricMember']])}
      ${fact('Revenues', 't', 1000)}${fact(R, 'res', 600)}${fact(R, 'com', 400)}${fact(R, 'gas1', 400)}${fact(R, 'gas2', 300)}${fact(R, 'el', 600)}`),
    ),
    {},
    '2024-12-31',
  );
  assert.deepEqual(res.views.map((v) => v.key), ['customers']);
  assert.deepEqual(
    res.views[0].items.map((i) => [i.label, i.per100]),
    [
      ['Residential', 60],
      ['Commercial', 40],
    ],
  );
});

test('customer classes that sum other classes are not counted next to them', () => {
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}${ctx('all', [[C2, 'ex:TotalRetailMember']])}${ctx('home', [[C2, 'ex:ResidentialMember']])}
      ${ctx('biz', [[C2, 'ex:IndustrialMember']])}${ctx('grid', [[C2, 'ex:TransmissionMember']])}
      ${fact('Revenues', 't', 1000)}${fact(R, 'all', 800)}${fact(R, 'home', 500)}${fact(R, 'biz', 300)}${fact(R, 'grid', 195)}`),
    ),
    {},
    '2024-12-31',
  );
  assert.deepEqual(res.views[0].items.map((i) => i.label), ['Residential', 'Industrial', 'Transmission']);
});

test('shares of sales given as percentages become amounts', () => {
  const B = 'us-gaap:ConcentrationRiskByBenchmarkAxis';
  const T = 'us-gaap:ConcentrationRiskByTypeAxis';
  const pct = (id, member) => ctx(id, [[P, member], [B, 'us-gaap:SalesRevenueNetMember'], [T, 'us-gaap:ProductConcentrationRiskMember']]);
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}${pct('a', 'ex:LadiesMember')}${pct('b', 'ex:HomeMember')}${pct('c', 'ex:ShoesMember')}${fact('Revenues', 't', 2000)}
      ${fact('ConcentrationRiskPercentage1', 'a', 0.5)}${fact('ConcentrationRiskPercentage1', 'b', 0.3)}${fact('ConcentrationRiskPercentage1', 'c', 0.2)}`),
    ),
    {},
    '2024-12-31',
  );
  assert.deepEqual(
    res.views[0].items.map((i) => [i.label, i.value, i.per100]),
    [
      ['Ladies', 1000, 50],
      ['Home', 600, 30],
      ['Shoes', 400, 20],
    ],
  );
});

test('failing a products view, the revenue lines on the income statement are used', () => {
  const statement = ['us-gaap:RevenuesAbstract', 'ex:SiteRentalRevenues', `us-gaap:${R}`, 'us-gaap:Revenues', 'us-gaap:CostsAndExpenses'];
  const res = buildBreakdowns(
    parseInstance(
      xml(`${ctx('t')}${fact('Revenues', 't', 1000)}${fact(R, 't', 50)}${fact('CostsAndExpenses', 't', 600)}
      <ex:SiteRentalRevenues contextRef="t" unitRef="usd">950</ex:SiteRentalRevenues>`),
    ),
    { 'ex:SiteRentalRevenues': 'Site rental revenues', [`us-gaap:${R}`]: 'Revenue from Contract with Customer' },
    '2024-12-31',
    statement,
  );
  assert.deepEqual(
    res.views[0].items.map((i) => [i.label, i.per100]),
    [
      ['Site rental revenues', 95],
      ['Other revenue', 5],
    ],
  );
});

test('a year reported in two pieces around a merger is added up', () => {
  const inst = combineSplitYear(
    parseInstance(
      xml(`${ctx('before', [], '2025-01-01', '2025-08-06')}${ctx('after', [], '2025-08-08', '2025-12-31')}${ctx('q4', [], '2025-10-01', '2025-12-31')}
      ${ctx('before-ads', [[P, 'ex:AdsMember']], '2025-01-01', '2025-08-06')}${ctx('after-ads', [[P, 'ex:AdsMember']], '2025-08-08', '2025-12-31')}
      ${fact(R, 'before', 600)}${fact(R, 'after', 500)}${fact(R, 'q4', 300)}${fact('NetIncomeLoss', 'before', -10)}${fact('NetIncomeLoss', 'after', -20)}
      ${fact(R, 'before-ads', 200)}${fact(R, 'after-ads', 150)}`),
    ),
    '2025-12-31',
  );
  assert.equal(buildBreakdowns(inst, {}, '2025-12-31').total.value, 1100);
  const year = inst.facts.filter((f) => isFullYear(inst.contexts[f.contextRef]));
  assert.deepEqual(
    year.map((f) => [f.name, f.value]),
    [
      [R, 1100],
      ['NetIncomeLoss', -30],
      [R, 350],
    ],
  );
  // A filing with full-year figures is left alone.
  const normal = parseInstance(instanceXml);
  assert.equal(combineSplitYear(normal, '2024-12-31'), normal);
});

const totalOf = (body, statement) => buildBreakdowns(parseInstance(`<x>${ctx('total')}${body}</x>`), {}, '2024-12-31', statement).total;

test('the top line when revenue tags cover only part of it', () => {
  // A landlord tagging only a fee line as revenue: the rent is the top line.
  assert.deepEqual(totalOf(`${fact(R, 'total', 13)}${fact('OperatingLeaseLeaseIncome', 'total', 1500)}`), { concept: 'OperatingLeaseLeaseIncome', value: 1500 });
  // A bank tagging only its fees: net interest income plus non-interest income.
  assert.equal(totalOf(`${fact(R, 'total', 150)}${fact('InterestIncomeExpenseNet', 'total', 600)}${fact('NoninterestIncome', 'total', 200)}`).value, 800);
  // A "Revenues" fact the income statement doesn't show, when it shows one other revenue line.
  const body = `${fact('Revenues', 'total', 1200)}${fact(R, 'total', 1000)}`;
  assert.equal(totalOf(body).value, 1200);
  assert.equal(totalOf(body, [`us-gaap:${R}`, 'us-gaap:CostOfRevenue']).value, 1000);
  assert.equal(totalOf(body, ['us-gaap:Revenues', `us-gaap:${R}`]).value, 1200);
});
