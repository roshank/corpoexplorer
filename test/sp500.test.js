import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyName, parseSp500 } from '../lib/sp500.js';
import { flags } from '../scripts/coverage.js';

// A constituents table in Wikipedia's shape, with `n` filler rows after the real ones.
const page = (n) => `<table class="wikitable" id="constituents"><tbody>
  <tr><th><a href="x">Symbol</a></th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th><th>Headquarters</th><th>Date added</th><th>CIK</th><th>Founded</th></tr>
  <tr><td><a href="nyse">MMM</a></td><td><a>3M</a></td><td>Industrials</td><td>Conglomerates</td><td>Saint Paul</td><td>1957-03-04</td><td>0000066740</td><td>1902</td></tr>
  <tr><td>BRK.B</td><td>Berkshire Hathaway</td><td>Financials</td><td>x</td><td>Omaha</td><td>2010-02-16</td><td>0001067983</td><td>1839</td></tr>
  <tr><td>AT&amp;T</td><td>AT&amp;T Inc.</td><td>Communication Services</td><td>x</td><td>Dallas</td><td>1983-11-30</td><td>0000732717</td><td>1983</td></tr>
  ${Array.from({ length: n }, (_, i) => `<tr><td>T${i}</td><td>Co ${i}</td><td>Energy</td><td>x</td><td>x</td><td>x</td><td>${1000 + i}</td><td>x</td></tr>`).join('')}
</tbody></table>`;

test('parseSp500 reads ticker, name, sector and CIK, in SEC ticker style', () => {
  const list = parseSp500(page(500));
  assert.equal(list.length, 503);
  assert.deepEqual(list[0], { ticker: 'MMM', name: '3M', sector: 'Industrials', cik: 66740 });
  assert.equal(list[1].ticker, 'BRK-B');
  assert.equal(list[2].name, 'AT&T Inc.');
});

test('parseSp500 refuses a table that looks wrong', () => {
  assert.throws(() => parseSp500(page(10)), /13 rows/);
  assert.throws(() => parseSp500('<html></html>'), /not found/);
});

test('coverage flags results that usually mean a misread filing', () => {
  const d = (rows, rate = 20) => ({ spending: { rows, taxes: { rate } } });
  const tax = { kind: 'tax', per100: 5 };
  assert.deepEqual(flags(d([{ kind: 'cost', per100: 60 }, { kind: 'cost', per100: 15 }, tax, { kind: 'profit', per100: 20 }])), []);
  assert.deepEqual(flags(d([{ kind: 'cost', per100: 75 }, tax, { kind: 'profit', per100: 20 }])), ['one cost line']);
  assert.deepEqual(
    flags(d([{ kind: 'cost', per100: 10 }, { kind: 'cost', per100: 8, residual: true }, tax, { kind: 'profit', per100: 77 }], -5)),
    ['not itemized $8.00', 'profit $77.00 per $100', 'tax rate -5%'],
  );
  assert.deepEqual(flags({}), ['no costs read']);
});

test('companyName uses the index name when SEC\'s is in capitals or has a state code', () => {
  assert.equal(companyName('PROGRESSIVE CORP/OH/', 'Progressive Corporation'), 'Progressive Corporation');
  assert.equal(companyName('CVS HEALTH Corp', 'CVS Health'), 'CVS Health');
  assert.equal(companyName('Apple Inc.', 'Apple Inc.'), 'Apple Inc.');
  assert.equal(companyName('JPMorgan Chase & Co', 'JPMorgan Chase'), 'JPMorgan Chase & Co');
  assert.equal(companyName('ALPHABET INC.', 'Alphabet Inc. (Class A)'), 'Alphabet Inc.');
  assert.equal(companyName('IBM', 'IBM'), 'IBM');
});
