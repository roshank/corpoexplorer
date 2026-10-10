import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, shortName, money, per100, searchTickers } from '../format.js';

test('displayName title-cases all-caps SEC names only', () => {
  assert.equal(displayName('MICROSOFT CORPORATION'), 'Microsoft Corporation');
  assert.equal(displayName('COCA COLA CO'), 'Coca Cola Co');
  assert.equal(displayName('Apple Inc.'), 'Apple Inc.');
});

test('shortName drops legal suffixes', () => {
  assert.equal(shortName('Apple Inc.'), 'Apple');
  assert.equal(shortName('AMAZON.COM, INC.'), 'Amazon.com');
  assert.equal(shortName('The Coca-Cola Company'), 'Coca-Cola');
  assert.equal(shortName('JPMorgan Chase & Co.'), 'JPMorgan Chase');
  assert.equal(shortName('Eli Lilly and Company'), 'Eli Lilly');
  assert.equal(shortName('Johnson & Johnson'), 'Johnson & Johnson');
});

test('money and per100 formatting', () => {
  assert.equal(money(416161000000, true), '$416.2 billion');
  assert.equal(money(5930000000), '$5.9B');
  assert.equal(money(-120000000), '−$120.0M');
  assert.equal(per100(50.36), '$50.36');
  assert.equal(per100(-0.4), '−$0.40');
});

test('searchTickers ranks exact ticker, then prefix, then name', () => {
  const list = [
    ['AAPL', 'Apple Inc.'],
    ['APLE', 'Apple Hospitality REIT'],
    ['A', 'Agilent Technologies'],
    ['PINE', 'Alpine Income Property'],
  ];
  assert.deepEqual(searchTickers(list, 'aapl').map((m) => m.ticker), ['AAPL']);
  assert.deepEqual(searchTickers(list, 'apple').map((m) => m.ticker), ['AAPL', 'APLE']);
  assert.equal(searchTickers(list, 'a')[0].ticker, 'A');
});

test('searchTickers shows each company once', () => {
  const list = [
    ['GOOGL', 'Alphabet Inc.', 1],
    ['GOOG', 'Alphabet Inc.', 1],
    ['GOOS', 'Canada Goose', 2],
  ];
  assert.deepEqual(searchTickers(list, 'goo').map((m) => m.ticker), ['GOOGL', 'GOOS']);
  assert.deepEqual(searchTickers(list, 'goog').map((m) => m.ticker), ['GOOG']);
});
