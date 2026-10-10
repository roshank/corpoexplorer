import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLine, htmlToText } from '../lib/describe.js';

const filing = htmlToText(`
  <ix:header><ix:hidden>Cost of revenue consists of hidden facts.</ix:hidden></ix:header>
  <p>We allocate our research and development budget among product categories, which consist of Networking and Security.</p>
  <p>The growth in cost of revenue was primarily driven by infrastructure.</p>
  <p><b>Cost of revenue.</b> Our cost of revenue consists of expenses associated with the delivery of our products.
  These mainly include data center costs, such as depreciation of servers, and energy and bandwidth costs.</p>
  <p>Research and development.</p>
  <p>Research and development ("R&amp;D") expense consists primarily of personnel costs for our engineering teams.</p>
  <p>Acme Inc. | 2025 Form 10-K | 24</p>
  <p>Other activities include research and lots of other things that are not a cost line at all.</p>
`);

test('describeLine finds the sentence that defines a line and keeps what follows', () => {
  assert.equal(
    describeLine(filing, ['Cost of revenue']),
    'Our cost of revenue consists of expenses associated with the delivery of our products. ' +
      'These mainly include data center costs, such as depreciation of servers, and energy and bandwidth costs.',
  );
});

test('describeLine skips sentences that mention the line without defining it', () => {
  assert.equal(
    describeLine(filing, ['Research and development']),
    'Research and development ("R&D") expense consists primarily of personnel costs for our engineering teams.',
  );
});

test('describeLine ignores generic names and missing lines', () => {
  assert.equal(describeLine(filing, ['Other']), null);
  assert.equal(describeLine(filing, ['Fulfillment']), null);
});

test('htmlToText drops hidden XBRL facts and page footers', () => {
  assert.doesNotMatch(filing, /hidden facts|Form 10-K \| 24/);
});
