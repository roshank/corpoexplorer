import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompany, getTickers, NotFound } from './lib/sec.js';
import { getFederalAwards } from './lib/usaspending.js';

if (!process.env.SEC_USER_AGENT) {
  console.error(
    'SEC_USER_AGENT is required. SEC EDGAR asks for a name and contact email, e.g.\n' +
      '  SEC_USER_AGENT="CorpoExplorer you@example.com" npm start',
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/tickers') {
      const tickers = await getTickers();
      return json(res, 200, tickers.map(({ ticker, name }) => [ticker, name]));
    }
    const m = url.pathname.match(/^\/api\/company\/([A-Za-z0-9.\-]{1,10})$/);
    if (m) return json(res, 200, await getCompany(m[1]));
    const fed = url.pathname.match(/^\/api\/company\/([A-Za-z0-9.\-]{1,10})\/federal$/);
    if (fed) {
      const co = await getCompany(fed[1]);
      const awards = await getFederalAwards(co.ticker, co.name, co.fiscalYearEnd).catch((err) => (console.error(err), null));
      return awards ? json(res, 200, awards) : json(res, 502, { error: "Couldn't reach USAspending.gov. Try again in a moment." });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

    const file = normalize(join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
    const body = await readFile(file).catch(() => null);
    if (!body) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err instanceof NotFound) return json(res, 404, { error: err.message });
    console.error(err);
    json(res, 502, { error: "Couldn't reach SEC EDGAR. Try again in a moment." });
  }
}).listen(PORT, () => console.log(`CorpoExplorer running at http://localhost:${PORT}`));
