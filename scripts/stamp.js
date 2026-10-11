// Stamp index.html with a short fingerprint of each file the site loads, so a browser fetches
// the new copy as soon as something changes instead of reusing its cached one (GitHub Pages
// tells browsers to reuse files for 10 minutes).
//
//   node scripts/stamp.js           rewrite index.html
//   node scripts/stamp.js --check   exit 1 if index.html is out of date
//
// - styles.css and app.js get ?v=<hash> on their tags.
// - The modules app.js imports (format.js, whogets.js, ...) are pointed at their stamped URLs
//   with an import map, since imports inside app.js can't carry the stamp themselves.
// - data/ gets one fingerprint for all its files, in <meta name="data-version">; app.js adds
//   it to every data request.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const hash = (...buffers) => {
  const h = createHash('sha256');
  for (const b of buffers) h.update(b);
  return h.digest('hex').slice(0, 10);
};

/** Fingerprints of the site's files: { css, app, modules: { 'format.js': hash, ... }, data }. */
export async function fingerprints(root = ROOT) {
  const names = (await readdir(root)).filter((n) => n.endsWith('.js')).sort();
  const modules = {};
  for (const n of names) if (n !== 'app.js') modules[n] = hash(await readFile(root + n));
  const dataFiles = [root + 'data/companies.json', ...(await readdir(root + 'data/c')).sort().map((n) => `${root}data/c/${n}`)];
  const data = hash(...(await Promise.all(dataFiles.map((f) => readFile(f)))));
  return { css: hash(await readFile(root + 'styles.css')), app: hash(await readFile(root + 'app.js')), modules, data };
}

/** index.html with the given fingerprints written in. Running it twice gives the same result. */
export function stampHtml(html, v) {
  const map = JSON.stringify({ imports: Object.fromEntries(Object.entries(v.modules).map(([n, h]) => [`./${n}`, `./${n}?v=${h}`])) });
  let out = html
    .replace(/href="styles\.css(\?v=\w+)?"/, `href="styles.css?v=${v.css}"`)
    .replace(/<script type="module" src="app\.js(\?v=\w+)?"><\/script>/, `<script type="module" src="app.js?v=${v.app}"></script>`)
    .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
    .replace(/\s*<meta name="data-version" content="\w*" \/>/, '');
  out = out.replace(/(\n(\s*)<script type="module" src="app\.js)/, `\n$2<script type="importmap">${map}</script>$1`);
  out = out.replace(/(\n(\s*)<link rel="stylesheet")/, `\n$2<meta name="data-version" content="${v.data}" />$1`);
  return out;
}

/** Bring index.html up to date. Returns true if it changed. */
export async function stamp(root = ROOT) {
  const file = root + 'index.html';
  const html = await readFile(file, 'utf8');
  const next = stampHtml(html, await fingerprints(root));
  if (next === html) return false;
  await writeFile(file, next);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const html = await readFile(ROOT + 'index.html', 'utf8');
    if (stampHtml(html, await fingerprints()) !== html) {
      console.error('index.html is out of date: run `npm run stamp`.');
      process.exit(1);
    }
    console.log('index.html is up to date.');
  } else {
    console.log((await stamp()) ? 'Stamped index.html.' : 'index.html was already up to date.');
  }
}
