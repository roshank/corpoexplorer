// SEC EDGAR access. EDGAR requires a descriptive User-Agent with contact info and
// asks for no more than 10 requests/second: https://www.sec.gov/os/accessing-edgar-data

import { parseInstance, parseLabels, parsePresentation } from './xbrl.js';
import { buildBreakdowns } from './breakdown.js';
import { buildSpending } from './spending.js';

const USER_AGENT = process.env.SEC_USER_AGENT;
const MIN_GAP_MS = 150;
const DAY = 24 * 60 * 60 * 1000;

export class NotFound extends Error {}

let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, MIN_GAP_MS)));
  return run;
}

async function get(url, as = 'text') {
  if (!USER_AGENT) throw new Error('SEC_USER_AGENT is not set');
  const res = await throttled(() => fetch(url, { headers: { 'User-Agent': USER_AGENT } }));
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw new Error(`SEC request failed (${res.status}): ${url}`);
  return as === 'json' ? res.json() : res.text();
}

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function getTickers() {
  return cached('tickers', DAY, async () => {
    const data = await get('https://www.sec.gov/files/company_tickers.json', 'json');
    return Object.values(data).map((c) => ({ ticker: c.ticker, name: c.title, cik: c.cik_str }));
  });
}

async function latestAnnualReport(cik) {
  const sub = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, 'json');
  const r = sub.filings.recent;
  const i = r.form.indexOf('10-K');
  if (i < 0) return null;
  return {
    accession: r.accessionNumber[i],
    primaryDocument: r.primaryDocument[i],
    reportDate: r.reportDate[i],
    filingDate: r.filingDate[i],
  };
}

async function filingFiles(cik, accession) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/`;
  const index = await get(dir + 'index.json', 'json');
  const names = index.directory.item.map((i) => i.name);
  const instance =
    names.find((n) => n.endsWith('_htm.xml')) ||
    names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/.test(n));
  // Labels usually live in *_lab.xml; some filers embed them in the schema instead.
  // Labels and statement layouts usually live in *_lab.xml / *_pre.xml; some filers
  // embed them in the schema instead.
  const xsd = names.find((n) => n.endsWith('.xsd'));
  const lab = names.find((n) => n.endsWith('_lab.xml')) || xsd;
  const pre = names.find((n) => n.endsWith('_pre.xml')) || xsd;
  const url = (n) => n && dir + n;
  return { dir, instance: url(instance), lab: url(lab), pre: url(pre) };
}

/** Where the money comes from and where it goes, from a ticker's most recent 10-K. */
export async function getCompany(ticker) {
  const tickers = await getTickers();
  const co = tickers.find((t) => t.ticker === ticker.toUpperCase());
  if (!co) throw new NotFound(`Unknown ticker "${ticker}"`);

  return cached(`company:${co.cik}`, DAY, async () => {
    const filing = await latestAnnualReport(co.cik);
    if (!filing) throw new NotFound(`${co.name} has no 10-K annual report on EDGAR (foreign companies file 20-F, which isn't supported yet)`);

    const files = await filingFiles(co.cik, filing.accession);
    if (!files.instance) throw new NotFound(`Couldn't find machine-readable data in ${co.name}'s latest 10-K`);
    const fetchOnce = new Map();
    const fetchFile = (u) => (u ? (fetchOnce.has(u) ? fetchOnce.get(u) : fetchOnce.set(u, get(u)).get(u)) : '');
    const [instanceXml, labXml, preXml] = await Promise.all([fetchFile(files.instance), fetchFile(files.lab), fetchFile(files.pre)]);

    const instance = parseInstance(instanceXml);
    const labels = labXml ? parseLabels(labXml) : {};
    const result = buildBreakdowns(instance, labels, filing.reportDate);
    if (!result.total) throw new NotFound(`Couldn't find total revenue in ${co.name}'s latest 10-K`);
    const spending = buildSpending(instance, preXml ? parsePresentation(preXml) : [], labels, result.periodEnd, result.total.value);

    return {
      ticker: co.ticker,
      name: instance.entityName || co.name,
      fiscalYearEnd: result.periodEnd,
      filingDate: filing.filingDate,
      filingUrl: `${files.dir}${filing.primaryDocument}`,
      totalRevenue: result.total.value,
      views: result.views,
      spending,
    };
  });
}
