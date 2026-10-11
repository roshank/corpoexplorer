import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeadcount, extractMedianPay, findMedianPay, findPayRatio } from '../lib/workforce.js';

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

test('findMedianPay skips base salary in favor of total pay', () => {
  assert.equal(
    findMedianPay('ratio is based on $37,989,685 for the CEO and $49,630 for the median employee. The base salary for the median employee was $48,001.').pay,
    49630,
  );
});

test('extractHeadcount reads workforce tables', () => {
  assert.equal(extractHeadcount('Total Employees ¶ 12,438 ¶ 29 ¶ % ¶ 30,013 ¶ 70 ¶ % ¶ 588 ¶ 1 ¶ % ¶ 43,039 ¶ 100 ¶ % ¶ * Includes'), 43039);
  assert.equal(
    extractHeadcount(
      "The table below presents the company's employees and related workforce at December 31, 2025. ¶ (In thousands) ¶ For the year ended December 31: ¶ 2025 ¶ IBM/wholly owned subsidiaries ¶ 264.3 ¶ Less-than-wholly owned subsidiaries ¶ 8.7 ¶ Complementary (1) ¶ 13.8 ¶",
    ),
    264300,
  );
});

test('findMedianPay reads a pay-ratio table', () => {
  assert.deepEqual(
    findMedianPay(
      'The table below discloses the 2025 annual total compensation for our CEO and median paid employee: ¶ CEO Pay Ratio: ¶ CEO Annual Total Compensation* ¶ $36,698,337 ¶ Median Employee Annual Total Compensation ¶ $125,100 ¶ CEO to Median Employee Pay Ratio ¶ 293:1',
    ),
    { pay: 125100, year: 2025 },
  );
});

test('findPayRatio reads the stated CEO pay ratio in its common forms', () => {
  assert.equal(
    findPayRatio('the 2025 annual total compensation of our median compensated employee was $139,483, and the ratio of these amounts is 533 to 1.'),
    533,
  );
  assert.equal(findPayRatio('CEO to Median Employee Pay Ratio ¶ 293:1'), 293);
  assert.equal(findPayRatio("median compensated employee was $40,206; Mr. Jassy's pay was $2,069,861, resulting in a ratio of those amounts of 1-to-51."), 51);
  assert.equal(findPayRatio('The ratio of Mr. Buffett’s pay ($389,488) to the pay of the median employee ($93,709) was 4.16 to 1.'), 4.16);
  // A "realized pay" ratio below 1 comes first in Tesla's filing; the required one follows.
  assert.equal(
    findPayRatio('Ratio of realized pay to median pay ¶ 0.00:1 ¶ The median pay was $62,786. Consequently, the applicable ratio of such amounts for 2025 was 2,522,203:1.'),
    2522203,
  );
  assert.equal(findPayRatio('We grew revenue 3 to 1 against our median peer.'), null);
});
