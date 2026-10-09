import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstance, parseLabels, humanize } from '../lib/xbrl.js';
import { buildBreakdowns, bestSubset, toCents } from '../lib/breakdown.js';

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
