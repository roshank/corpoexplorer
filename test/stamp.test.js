import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fingerprints, stampHtml } from '../scripts/stamp.js';

const page = `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <script type="module" src="app.js"></script>
  </body>
</html>`;
const v = { css: 'c1', app: 'a1', modules: { 'format.js': 'f1', 'whogets.js': 'w1' }, data: 'd1' };

test('stampHtml adds version stamps, an import map and the data version', () => {
  const out = stampHtml(page, v);
  assert.match(out, /href="styles\.css\?v=c1"/);
  assert.match(out, /<script type="module" src="app\.js\?v=a1"><\/script>/);
  assert.match(out, /<meta name="data-version" content="d1" \/>/);
  const map = JSON.parse(out.match(/<script type="importmap">(.*?)<\/script>/)[1]);
  assert.deepEqual(map, { imports: { './format.js': './format.js?v=f1', './whogets.js': './whogets.js?v=w1' } });
  // The import map has to come before the module script.
  assert.ok(out.indexOf('importmap') < out.indexOf('src="app.js'));
});

test('stampHtml replaces old stamps and is stable', () => {
  const once = stampHtml(page, v);
  assert.equal(stampHtml(once, v), once);
  const next = stampHtml(once, { ...v, css: 'c2', modules: { 'format.js': 'f2' }, data: 'd2' });
  assert.match(next, /styles\.css\?v=c2/);
  assert.match(next, /content="d2"/);
  assert.equal(next.match(/importmap/g).length, 1);
  assert.doesNotMatch(next, /whogets|c1|d1|f1/);
});

test('index.html is stamped with the current files (run `npm run stamp` if this fails)', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(stampHtml(html, await fingerprints()), html);
});
