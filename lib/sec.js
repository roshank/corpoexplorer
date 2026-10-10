// SEC EDGAR access. EDGAR requires a descriptive User-Agent with contact info and
// asks for no more than 10 requests/second: https://www.sec.gov/os/accessing-edgar-data

import { parseInstance, parseLabels, parsePresentation } from './xbrl.js';
import { buildBreakdowns } from './breakdown.js';
import { buildSpending } from './spending.js';
import { buildGovernmentCustomer, buildTaxBreaks, buildTaxSplit } from './government.js';
import { describeLine, htmlToText } from './describe.js';
import { extractHeadcount, findMedianPay } from './workforce.js';

const MIN_GAP_MS = 150;

export class NotFound extends Error {}

let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, MIN_GAP_MS)));
  return run;
}

async function get(url, as = 'text') {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error('SEC_USER_AGENT is not set');
  for (let attempt = 1; ; attempt++) {
    const res = await throttled(() => fetch(url, { headers: { 'User-Agent': userAgent } }));
    if (res.status === 404) throw new NotFound(url);
    if (res.ok) return as === 'json' ? res.json() : res.text();
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`SEC request failed (${res.status}): ${url}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Every SEC-registered ticker: [{ ticker, name, cik }], roughly largest companies first. */
export async function getTickers() {
  const data = await get('https://www.sec.gov/files/company_tickers.json', 'json');
  return Object.values(data).map((c) => ({ ticker: c.ticker, name: c.title, cik: c.cik_str }));
}

/** The company's most recent 10-K, or null if it doesn't file one. */
export async function latestAnnualReport(cik) {
  const sub = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, 'json');
  const r = sub.filings.recent;
  const i = r.form.indexOf('10-K');
  if (i < 0) return null;
  // The median employee's pay (CEO pay-ratio disclosure) is in the proxy statement, or in a
  // 10-K amendment for companies whose annual meeting comes late (Tesla). Newest first.
  const payFilings = [];
  r.form.forEach((form, j) => {
    const amendsThisReport = form === '10-K/A' && r.reportDate[j] === r.reportDate[i] && r.filingDate[j] >= r.filingDate[i];
    if (amendsThisReport || (form === 'DEF 14A' && !payFilings.some((f) => f.form === 'DEF 14A'))) {
      payFilings.push({ form, accession: r.accessionNumber[j], primaryDocument: r.primaryDocument[j], filingDate: r.filingDate[j] });
    }
  });
  payFilings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  return {
    accession: r.accessionNumber[i],
    primaryDocument: r.primaryDocument[i],
    reportDate: r.reportDate[i],
    filingDate: r.filingDate[i],
    payFilings,
  };
}

async function filingFiles(cik, accession) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/`;
  const index = await get(dir + 'index.json', 'json');
  const names = index.directory.item.map((i) => i.name);
  const instance =
    names.find((n) => n.endsWith('_htm.xml')) ||
    names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/.test(n));
  // Labels and statement layouts usually live in *_lab.xml / *_pre.xml; some filers
  // embed them in the schema instead.
  const xsd = names.find((n) => n.endsWith('.xsd'));
  const lab = names.find((n) => n.endsWith('_lab.xml')) || xsd;
  const pre = names.find((n) => n.endsWith('_pre.xml')) || xsd;
  const url = (n) => n && dir + n;
  return { dir, instance: url(instance), lab: url(lab), pre: url(pre) };
}

/**
 * Where the money comes from and where it goes, from one 10-K.
 * @param {{ ticker, name, cik }} co
 * @param filing from latestAnnualReport()
 */
export async function companyFromFiling(co, filing) {
  const files = await filingFiles(co.cik, filing.accession);
  if (!files.instance) throw new NotFound(`No machine-readable data in ${co.name}'s latest 10-K`);

  const fetched = new Map();
  const fetchFile = (u) => {
    if (!u) return '';
    if (!fetched.has(u)) fetched.set(u, get(u));
    return fetched.get(u);
  };
  const [instanceXml, labXml, preXml] = await Promise.all([fetchFile(files.instance), fetchFile(files.lab), fetchFile(files.pre)]);

  const instance = parseInstance(instanceXml);
  const labels = labXml ? parseLabels(labXml) : {};
  const result = buildBreakdowns(instance, labels, filing.reportDate);
  if (!result.total) throw new NotFound(`No total revenue in ${co.name}'s latest 10-K`);
  const spending = buildSpending(instance, preXml ? parsePresentation(preXml) : [], labels, result.periodEnd, result.total.value);

  // The 10-K text: the company's own words for each cost line, and how many people it employs.
  const text = await get(`${files.dir}${filing.primaryDocument}`).then(htmlToText, () => '');
  if (spending) {
    for (const r of spending.rows) {
      if (r.kind !== 'cost' || r.residual || r.folded || !text) continue;
      // Only the filing's own wording: our plain-English names ("Other costs") match unrelated text.
      const names = [r.filingLabel ?? r.label, labels[r.concept]].map((n) => n?.replace(/^total\s+/i, '').trim());
      const description = describeLine(text, [...new Set(names)]);
      if (description) r.description = description;
    }
  }

  return {
    ticker: co.ticker,
    name: instance.entityName || co.name,
    cik: co.cik,
    accession: filing.accession,
    fiscalYearEnd: result.periodEnd,
    filingDate: filing.filingDate,
    filingUrl: `${files.dir}${filing.primaryDocument}`,
    totalRevenue: result.total.value,
    views: result.views,
    spending,
    government: {
      customer: buildGovernmentCustomer(instance, labels, result.periodEnd, result.total.value),
      taxBreaks: buildTaxBreaks(instance, result.periodEnd),
      taxSplit: buildTaxSplit(instance, result.periodEnd),
    },
    workforce: await workforce(co, filing, text),
  };
}

/**
 * Headcount from the 10-K, and median pay from the newest filing that states it (a 10-K
 * amendment or the latest proxy). Any of these may be null.
 */
async function workforce(co, filing, text) {
  const employees = text ? extractHeadcount(text) : null;
  for (const f of filing.payFilings ?? []) {
    const url = `https://www.sec.gov/Archives/edgar/data/${co.cik}/${f.accession.replace(/-/g, '')}/${f.primaryDocument}`;
    const found = await get(url).then((html) => findMedianPay(htmlToText(html)), () => null);
    if (found) return { employees, medianPay: found.pay, payYear: found.year, payFiling: { form: f.form, url, date: f.filingDate } };
  }
  return { employees, medianPay: null, payYear: null, payFiling: null };
}

/** One-off lookup by ticker (used by the smoke script). */
export async function getCompany(ticker) {
  const co = (await getTickers()).find((t) => t.ticker === ticker.toUpperCase());
  if (!co) throw new NotFound(`Unknown ticker "${ticker}"`);
  const filing = await latestAnnualReport(co.cik);
  if (!filing) throw new NotFound(`${co.name} has no 10-K annual report`);
  return companyFromFiling(co, filing);
}
