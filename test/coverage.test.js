import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEWED, reviewed } from '../scripts/coverage.js';

test('a review explains its flag for the fiscal year it was checked, and expires after', () => {
  const fy = REVIEWED.AXON.fy;
  assert.ok(reviewed('AXON', { fiscalYearEnd: fy }, 'tax rate -557%'));
  assert.equal(reviewed('AXON', { fiscalYearEnd: '2099-12-31' }, 'tax rate -557%'), null);
  assert.equal(reviewed('AXON', { fiscalYearEnd: fy }, 'one cost line'), null);
  assert.equal(reviewed('NOPE', { fiscalYearEnd: fy }, 'tax rate 99%'), null);
});

test('every review names a flag, a fiscal year end and a note', () => {
  for (const [ticker, r] of Object.entries(REVIEWED)) {
    assert.match(r.flag, /^(tax rate|profit|one cost line|not itemized)/, ticker);
    assert.match(r.fy, /^\d{4}-\d{2}-\d{2}$/, ticker);
    assert.ok(r.note.length > 10, ticker);
  }
});
