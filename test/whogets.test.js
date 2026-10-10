import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whoGets } from '../whogets.js';

const company = (over = {}) => ({
  totalRevenue: 1000,
  spending: {
    rows: [
      { kind: 'cost', per100: 60 },
      { kind: 'other', per100: 5 },
      { kind: 'tax', per100: 5, value: 50 },
      { kind: 'profit', per100: 30, value: 300 },
    ],
    afterProfit: { dividends: { per100: 10 }, buybacks: { per100: 15 } },
    employees: { payLine: null },
  },
  workforce: { employees: 10, medianPay: 15 },
  government: { taxSplit: { us: 30, foreign: 20, total: 50 }, taxBreaks: { pretaxIncome: 350, statutoryTax: 73.5 } },
  ...over,
});
const total = (w) => w.other.per100 + (w.workers?.per100 ?? 0) + w.governments.per100 + w.owners.per100 + w.kept.per100;

test('whoGets splits $100 five ways that add up to exactly $100', () => {
  const w = whoGets(company());
  assert.deepEqual(
    [w.other.per100, w.workers.per100, w.governments.per100, w.owners.per100, w.kept.per100],
    [50, 15, 5, 25, 5],
  );
  assert.equal(total(w), 100);
  assert.equal(w.workers.source, 'estimate');
  assert.deepEqual([w.governments.us, w.governments.abroad, w.governments.at21], [3, 2, 7.35]);
});

test('whoGets prefers reported pay and handles paying out more than it earned', () => {
  const c = company();
  c.spending.employees.payLine = { per100: 20, value: 200 };
  c.spending.afterProfit.buybacks.per100 = 40;
  const w = whoGets(c);
  assert.equal(w.workers.source, 'reported');
  assert.equal(w.kept.per100, -20);
  assert.equal(total(w), 100);
});

test('whoGets leaves out a worker estimate that is implausibly large', () => {
  const w = whoGets(company({ workforce: { employees: 1000, medianPay: 1000 } }));
  assert.equal(w.workers, null);
  assert.equal(w.workersMissing, 'implausible');
  assert.equal(w.other.per100, 65);
  assert.equal(total(w), 100);
});

test('whoGets says why workers is missing', () => {
  assert.equal(whoGets(company({ workforce: { employees: null, medianPay: 50 } })).workersMissing, 'headcount');
  assert.equal(whoGets(company({ workforce: { employees: 10, medianPay: null } })).workersMissing, 'medianPay');
  assert.equal(whoGets(company()).workersMissing, null);
});

test('whoGets splits US taxes into federal and state when the filing does', () => {
  const g = whoGets(company({ government: { taxSplit: { us: 30, federal: 24, state: 6, foreign: 20, total: 50 } } })).governments;
  assert.deepEqual([g.federal, g.state, g.abroad], [2.4, 0.6, 2]);
  // A net state benefit, or state not reported separately: only US vs abroad.
  const neg = whoGets(company({ government: { taxSplit: { us: 30, federal: 32, state: -2, foreign: 20, total: 50 } } })).governments;
  assert.equal(neg.state, undefined);
  assert.equal(neg.us, 3);
  assert.equal(whoGets(company()).governments.state, undefined);
});
