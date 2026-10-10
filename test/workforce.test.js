import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeadcount, extractMedianPay, findMedianPay } from '../lib/workforce.js';

test('extractHeadcount finds the total, not subsets or other years', () => {
  assert.equal(extractHeadcount('As of December 31, 2025, we employed approximately 1,576,000 full-time and part-time employees.'), 1576000);
  assert.equal(extractHeadcount('As of December 31, 2025 and 2024, our Company had approximately 65,900 and 69,700 employees, respectively.'), 65900);
  assert.equal(
    extractHeadcount('At the end of 2025, we employed approximately 12,000 people in pharmaceutical research. At the end of 2025, we employed approximately 50,000 people.'),
    50000,
  );
  assert.equal(extractHeadcount('Our business is delivered by approximately 2.1 million associates as of January 31, 2026.'), 2100000);
  assert.equal(extractHeadcount('As of December 2025, we had headcount of 47,400, offices in over 35 countries.'), 47400);
  assert.equal(extractHeadcount('In the United States, we employed approximately 51,600 full-time persons.'), null);
  assert.equal(extractHeadcount('Over 300,000 Amazon employees around the world have participated in Career Choice.'), null);
});

test('extractMedianPay reads the pay-ratio disclosure', () => {
  assert.equal(extractMedianPay('the median of the annual total compensation of all employees (other than our CEO) was $388,200; and'), 388200);
  assert.equal(extractMedianPay('The median annual total compensation of all Caterpillar employees, other than Mr. Creed, was $89,253.'), 89253);
  assert.equal(extractMedianPay('was $ 52,838,751 for our CEO, as reported, and $177,115 for our median employee, and the ratio is 298 to 1.'), 177115);
  assert.equal(extractMedianPay('Our CEO was paid $25,000,000.'), null);
});

test('findMedianPay reports the year the pay is for', () => {
  assert.deepEqual(
    findMedianPay('the median 2025 annual total compensation of all other qualifying employees was $62,786.'),
    { pay: 62786, year: 2025 },
  );
  assert.deepEqual(findMedianPay('The median annual total compensation of all employees was $89,253.'), { pay: 89253, year: null });
});
