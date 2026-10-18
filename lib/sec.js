// SEC EDGAR access. EDGAR requires a descriptive User-Agent with contact info and
// asks for no more than 10 requests/second: https://www.sec.gov/os/accessing-edgar-data

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { combineSplitYear, parseInstance, parseLabels, parsePresentation } from './xbrl.js';
import { buildBreakdowns } from './breakdown.js';
import { buildSpending, findIncomeStatement } from './spending.js';
import { buildGovernmentCustomer, buildTaxBreaks, buildTaxSplit } from './government.js';
import { describeLine, htmlToText } from './describe.js';
import { extractHeadcount, findMedianPay, findMedianPayNearRatio, findPayRatio } from './workforce.js';

const MIN_GAP_MS = Number(process.env.SEC_MIN_GAP_MS) || 150;
// Optional local copy of every download (SEC_CACHE_DIR), for re-running the build while
// working on the parsers. Filings never change once filed; company listings do, so those
// are always fetched fresh. Stored gzipped: five years of filings for every company is ~30GB
// as text, ~3GB compressed.
const CACHE = process.env.SEC_CACHE_DIR;
const cacheable = (url) => CACHE && url.includes('/Archives/edgar/data/');

export class NotFound extends Error {}

let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, MIN_GAP_MS)));
  return run;
}

async function get(url, as = 'text') {
  const path = cacheable(url) && `${CACHE}/${createHash('sha1').update(url).digest('hex')}.gz`;
  if (path) {
    const hit = await readFile(path).then((b) => gunzipSync(b).toString('utf8'), () => null);
    if (hit !== null) return as === 'json' ? JSON.parse(hit) : hit;
  }
  const body = await download(url);
  if (path) await mkdir(CACHE, { recursive: true }).then(() => writeFile(path, gzipSync(body, { level: 1 })));
  return as === 'json' ? JSON.parse(body) : body;
}

async function download(url) {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error('SEC_USER_AGENT is not set');
  for (let attempt = 1; ; attempt++) {
    const res = await throttled(() => fetch(url, { headers: { 'User-Agent': userAgent } }));
    if (res.status === 404) throw new NotFound(url);
    if (res.ok) return res.text();
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

/**
 * The company's most recent 10-K, or null if it doesn't file one. A new holding company that
 * has yet to file a 10-K (ExxonMobil Holdings in 2026) files its quarterly reports jointly with
 * the company it now owns; that company's 10-K is used then. `cik` says whose 10-K it is.
 */
export async function latestAnnualReport(cik, lookForPredecessor = true) {
  const r = await filings(cik);
  const i = r.form.indexOf('10-K');
  if (i < 0) return lookForPredecessor ? predecessorAnnualReport(cik, r) : null;
  // The median employee's pay (CEO pay-ratio disclosure) is in the proxy statement, or in a
  // 10-K amendment for companies whose annual meeting comes late (Tesla). Every proxy since the
  // year ended, since the newest can be for a special meeting without one (Flex), and the one
  // before, for companies whose proxy for the year hasn't come out or leaves it out (PACCAR
  // reports it later). Information statements (DEF 14C) count: controlled companies (Erie
  // Indemnity) file those instead. Newest first.
  // Not one from years back (KKR's last proxy before 2026 was from 2018).
  const oldest = new Date(Date.parse(r.reportDate[i]) - 456 * 864e5).toISOString().slice(0, 10);
  const payFilings = [];
  let earlier = null;
  r.form.forEach((form, j) => {
    const filed = { form, accession: r.accessionNumber[j], primaryDocument: r.primaryDocument[j], filingDate: r.filingDate[j] };
    const amendsThisReport = form === '10-K/A' && r.reportDate[j] === r.reportDate[i] && r.filingDate[j] >= r.filingDate[i];
    if (amendsThisReport || (PROXY.includes(form) && r.filingDate[j] >= r.reportDate[i])) payFilings.push(filed);
    else if (PROXY.includes(form) && r.filingDate[j] >= oldest && (!earlier || r.filingDate[j] > earlier.filingDate)) earlier = filed;
  });
  if (earlier) payFilings.push(earlier);
  payFilings.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  return {
    cik: Number(cik),
    accession: r.accessionNumber[i],
    primaryDocument: r.primaryDocument[i],
    reportDate: r.reportDate[i],
    filingDate: r.filingDate[i],
    payFilings,
  };
}

// Proxy statements, and information statements (DEF 14C) from controlled companies.
const PROXY = ['DEF 14A', 'DEFR14A', 'DEF 14C'];

/**
 * The company's filings, newest first, as parallel arrays (form, accessionNumber, reportDate, …).
 * SEC lists about the last thousand; with `since` (YYYY-MM-DD), older pages are added until the
 * list reaches back that far (banks file many prospectuses, so a thousand can be under a year).
 */
async function filings(cik, since) {
  const sub = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, 'json');
  const r = { ...sub.filings.recent };
  for (const page of since ? sub.filings.files ?? [] : []) {
    if (r.filingDate.at(-1) <= since) break;
    if (page.filingTo < since) continue;
    const more = await get(`https://data.sec.gov/submissions/${page.name}`, 'json');
    for (const k of Object.keys(r)) r[k] = r[k].concat(more[k] ?? []);
  }
  return r;
}

/**
 * The company's last `years` 10-Ks, one per fiscal year, newest first, in the shape of
 * latestAnnualReport(). The pay filings for each are the proxies filed after its year ended and
 * before the next year's 10-K came out (plus a little, for late proxies), oldest first: the first
 * proxy after a year ends is the one that reports that year's pay.
 */
export async function annualReportHistory(cik, years) {
  const since = new Date(Date.now() - (years + 1) * 366 * 864e5).toISOString().slice(0, 10);
  const r = await filings(cik, since);
  const reports = [];
  r.form.forEach((form, i) => {
    if (form === '10-K' && reports.length < years && !reports.some((j) => r.reportDate[j] === r.reportDate[i])) reports.push(i);
  });
  return reports.map((i, k) => {
    const next = k > 0 ? r.filingDate[reports[k - 1]] : null;
    const until = next && new Date(Date.parse(next) + 90 * 864e5).toISOString().slice(0, 10);
    const payFilings = [];
    r.form.forEach((form, j) => {
      const amends = form === '10-K/A' && r.reportDate[j] === r.reportDate[i];
      const proxy = PROXY.includes(form) && r.filingDate[j] >= r.reportDate[i] && (!until || r.filingDate[j] <= until);
      if (amends || proxy) payFilings.push({ form, accession: r.accessionNumber[j], primaryDocument: r.primaryDocument[j], filingDate: r.filingDate[j] });
    });
    payFilings.sort((a, b) => a.filingDate.localeCompare(b.filingDate));
    return {
      cik: Number(cik),
      accession: r.accessionNumber[i],
      primaryDocument: r.primaryDocument[i],
      reportDate: r.reportDate[i],
      filingDate: r.filingDate[i],
      payFilings,
    };
  });
}

/** The 10-K of a company that filed this one's latest quarterly report with it. */
async function predecessorAnnualReport(cik, recent) {
  const q = recent.form.indexOf('10-Q');
  if (q < 0) return null;
  const accession = recent.accessionNumber[q];
  const header = await get(`https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${accession}.hdr.sgml`).catch(() => '');
  const coFilers = [...header.matchAll(/<CIK>\s*(\d+)/g)].map((m) => Number(m[1])).filter((c) => c !== Number(cik));
  for (const other of new Set(coFilers)) {
    const filing = await latestAnnualReport(other, false);
    if (filing) return filing;
  }
  return null;
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
  // The annual-report exhibit some companies file alongside a short 10-K (IBM): the largest
  // other document in the filing.
  const exhibits = index.directory.item
    .filter((i) => /\.htm$/.test(i.name) && !/^R\d+\.htm$/.test(i.name))
    .sort((a, b) => Number(b.size) - Number(a.size));
  return { dir, instance: url(instance), lab: url(lab), pre: url(pre), largestDocs: exhibits.slice(0, 2).map((i) => i.name) };
}

/**
 * Where the money comes from and where it goes, from one 10-K.
 * @param {{ ticker, name, cik }} co
 * @param filing from latestAnnualReport()
 */
export async function companyFromFiling(co, filing) {
  const { files, instance, labels, result, spending, text } = await readFiling(co, filing);
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
    workforce: await workforce(co, filing, text, files),
  };
}

/**
 * An earlier year, for the workers vs owners history: just what whoGets() needs to split the
 * $100 between workers and owners, read the same way as the latest year.
 */
export async function yearFromFiling(co, filing) {
  const { files, result, spending, text } = await readFiling(co, filing);
  const fy = Number(result.periodEnd.slice(0, 4));
  const w = await workforce(co, filing, text, files, fy);
  const row = (kind) => {
    const r = spending.rows.find((x) => x.kind === kind);
    return { kind, value: r.value, per100: r.per100 };
  };
  return {
    fiscalYearEnd: result.periodEnd,
    accession: filing.accession,
    filingUrl: `${files.dir}${filing.primaryDocument}`,
    totalRevenue: result.total.value,
    spending: spending && {
      rows: [row('tax'), row('profit')],
      afterProfit: { dividends: spending.afterProfit?.dividends ?? null, buybacks: spending.afterProfit?.buybacks ?? null },
      employees: { payLine: spending.employees?.payLine ? { value: spending.employees.payLine.value, per100: spending.employees.payLine.per100 } : null },
    },
    workforce: { employees: w.employees, medianPay: w.medianPay, payYear: w.payYear },
  };
}

/** One 10-K's numbers and text. */
async function readFiling(co, filing) {
  const files = await filingFiles(filing.cik ?? co.cik, filing.accession);
  if (!files.instance) throw new NotFound(`No machine-readable data in ${co.name}'s latest 10-K`);

  const fetched = new Map();
  const fetchFile = (u) => {
    if (!u) return '';
    if (!fetched.has(u)) fetched.set(u, get(u));
    return fetched.get(u);
  };
  const [instanceXml, labXml, preXml] = await Promise.all([fetchFile(files.instance), fetchFile(files.lab), fetchFile(files.pre)]);

  const instance = combineSplitYear(parseInstance(instanceXml), filing.reportDate);
  const labels = labXml ? parseLabels(labXml) : {};
  const presentation = preXml ? parsePresentation(preXml) : [];
  const result = buildBreakdowns(instance, labels, filing.reportDate, findIncomeStatement(presentation)?.concepts);
  if (!result.total) throw new NotFound(`No total revenue in ${co.name}'s latest 10-K`);
  const spending = buildSpending(instance, presentation, labels, result.periodEnd, result.total.value);

  const text = await get(`${files.dir}${filing.primaryDocument}`).then(htmlToText, () => '');
  return { files, instance, labels, result, spending, text };
}

/**
 * Headcount from the 10-K (or the proxy), and median pay and the CEO pay ratio from the newest
 * filing that states them (a 10-K amendment, a proxy, or the 10-K itself). Any of these may be null.
 * With `fy`, pay stated for a year more than one away from it is ignored.
 */
async function workforce(co, filing, text, files, fy) {
  let employees = text ? extractHeadcount(text) : null;
  // Not in the 10-K itself: try the annual-report exhibit.
  const exhibit = files.largestDocs.find((n) => n !== filing.primaryDocument);
  if (!employees && exhibit) employees = await get(files.dir + exhibit).then((html) => extractHeadcount(htmlToText(html)), () => null);
  let pay = null;
  for (const f of (filing.payFilings ?? []).slice(0, 4)) {
    const url = `https://www.sec.gov/Archives/edgar/data/${filing.cik ?? co.cik}/${f.accession.replace(/-/g, '')}/${f.primaryDocument}`;
    const payText = await get(url).then(htmlToText, () => '');
    // Some companies state their headcount only in the proxy (PSEG's 10-K shows it in a chart).
    if (!employees && payText && f.form !== '10-K/A') employees = extractHeadcount(payText);
    pay = payText && readPay(payText, { form: f.form, url, date: f.filingDate });
    // For an earlier year (`fy`), pay stated for some other year belongs to a different 10-K.
    if (pay && fy && pay.payYear && Math.abs(pay.payYear - fy) > 1) pay = null;
    if (pay) break;
  }
  // Companies that don't hold annual meetings disclose it in the 10-K itself (Blackstone, KKR).
  if (!pay && text) {
    const section = [...text.matchAll(/pay ratio/gi)].find((m) => /median/i.test(text.slice(m.index, m.index + 3000)));
    if (section) {
      const part = text.slice(Math.max(0, section.index - 200), section.index + 8000);
      pay = readPay(part, { form: '10-K', url: `${files.dir}${filing.primaryDocument}`, date: filing.filingDate });
    }
  }
  return { employees, ...(pay || { medianPay: null, payYear: null, ceoRatio: null, ceoPay: null, payFiling: null }) };
}

/** Median pay and the CEO pay ratio from a pay-ratio disclosure, or null without a median. */
function readPay(text, payFiling) {
  const found = findMedianPay(text) ?? findMedianPayNearRatio(text);
  if (!found) return null;
  // The CEO pay ratio is stated in the same disclosure; the CEO's pay follows from it.
  const ceoRatio = findPayRatio(text);
  return {
    medianPay: found.pay,
    payYear: found.year,
    ceoRatio,
    ceoPay: ceoRatio ? Math.round(ceoRatio * found.pay) : null,
    payFiling,
  };
}

/** One-off lookup by ticker (used by the smoke script). */
export async function getCompany(ticker) {
  const co = (await getTickers()).find((t) => t.ticker === ticker.toUpperCase());
  if (!co) throw new NotFound(`Unknown ticker "${ticker}"`);
  const filing = await latestAnnualReport(co.cik);
  if (!filing) throw new NotFound(`${co.name} has no 10-K annual report`);
  return companyFromFiling(co, filing);
}
