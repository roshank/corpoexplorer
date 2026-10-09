import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineAwards, fiscalYear, legalName, matchRecipients, normalize, searchKeywords } from '../lib/usaspending.js';

test('normalize drops punctuation, "The" and legal forms', () => {
  assert.equal(normalize('The Boeing Company'), 'BOEING');
  assert.equal(normalize('AMAZON.COM, INC.'), 'AMAZON COM');
  assert.equal(normalize('Johnson & Johnson'), 'JOHNSON AND JOHNSON');
  assert.equal(normalize('JPMorgan Chase Bank, N.A.'), 'JPMORGAN CHASE BANK');
});

test('legalName keeps the legal form in one spelling', () => {
  assert.equal(legalName('The Boeing Company'), 'BOEING CO');
  assert.equal(legalName('BOEING CO'), 'BOEING CO');
  assert.equal(legalName('Lockheed Martin Corporation'), 'LOCKHEED MARTIN CORP');
  assert.equal(legalName('Apple Inc.'), 'APPLE INC');
  assert.equal(legalName('NORTHROP GRUMMAN CORP /DE/'), 'NORTHROP GRUMMAN CORP');
});

test('searchKeywords adds common legal forms', () => {
  assert.deepEqual(searchKeywords(['INTEL CORP']), ['INTEL', 'INTEL CORPORATION', 'INTEL INC', 'INTEL COMPANY']);
  assert.deepEqual(searchKeywords(['GE']), []);
  assert.deepEqual(searchKeywords(['MERCK SHARP AND DOHME']).slice(0, 2), ['MERCK SHARP AND DOHME', 'MERCK SHARP & DOHME']);
});

test('matchRecipients keeps the company and its aliases, not look-alikes or child records', () => {
  const results = [
    { id: 'a-P', name: 'APPLE INC', recipient_level: 'P' },
    { id: 'b-P', name: 'APPLE CORPORATION', recipient_level: 'P' },
    { id: 'c-C', name: 'APPLE INC', recipient_level: 'C' },
    { id: 'd-R', name: 'APPLE INC.', recipient_level: 'R' },
    { id: 'a-P', name: 'APPLE INC', recipient_level: 'P' },
    { id: 'e-P', name: 'APPLE SERVICES LLC', recipient_level: 'P' },
  ];
  assert.deepEqual(
    matchRecipients(results, 'Apple Inc.').map((r) => r.id),
    ['a-P', 'd-R'],
  );
  assert.deepEqual(
    matchRecipients(results, 'Apple Inc.', ['APPLE SERVICES']).map((r) => r.id),
    ['a-P', 'd-R', 'e-P'],
  );
});

test('combineAwards adds up agencies across recipients', () => {
  const groups = combineAwards({
    contracts: [
      [
        { name: 'Department of Defense', amount: 100 },
        { name: 'NASA', amount: 10 },
      ],
      [{ name: 'Department of Defense', amount: 50 }],
    ],
    grants: [[{ name: 'NASA', amount: 0 }]],
  });
  assert.deepEqual(groups.map((g) => [g.key, g.total]), [
    ['contracts', 160],
    ['grants', 0],
    ['loans', 0],
    ['payments', 0],
  ]);
  assert.deepEqual(groups[0].agencies, [
    { name: 'Department of Defense', amount: 150 },
    { name: 'NASA', amount: 10 },
  ]);
  assert.deepEqual(groups[1].agencies, []);
});

test('fiscalYear is the year ending on the 10-K period end', () => {
  assert.deepEqual(fiscalYear('2024-12-31'), { start_date: '2024-01-01', end_date: '2024-12-31' });
  assert.deepEqual(fiscalYear('2025-09-27'), { start_date: '2024-09-28', end_date: '2025-09-27' });
});
