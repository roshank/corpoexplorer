// Federal money paid to a company, from USAspending.gov (no API key needed):
// contracts (the government buying things) and financial assistance (grants, loans,
// direct payments). https://api.usaspending.gov/docs/endpoints

const API = 'https://api.usaspending.gov/api/v2/';
const DAY = 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 6;

// USAspending award type codes, grouped the way the page shows them. Assistance has
// older numeric codes and newer F-codes for the same kinds of award.
export const AWARD_GROUPS = [
  { key: 'contracts', label: 'Contracts', note: 'The government buying products and services', codes: ['A', 'B', 'C', 'D'] },
  { key: 'grants', label: 'Grants', note: 'Money for projects, such as research or factories', codes: ['02', '03', '04', '05', 'F001', 'F002'] },
  {
    key: 'loans',
    label: 'Loans & loan guarantees',
    note: 'Expected cost to taxpayers of loans the government made or backed',
    codes: ['07', '08', 'F003', 'F004'],
  },
  {
    key: 'payments',
    label: 'Direct payments & other aid',
    note: 'Subsidies, insurance and other payments',
    codes: ['06', '09', '10', '11', 'F005', 'F006', 'F007', 'F008', 'F009', 'F010'],
  },
];

// Companies that receive federal money under a different name than the one they file
// with the SEC. Names are matched after normalize().
export const ALIASES = {
  GOOGL: ['GOOGLE', 'GOOGLE PUBLIC SECTOR'],
  GOOG: ['GOOGLE', 'GOOGLE PUBLIC SECTOR'],
  AMZN: ['AMAZON WEB SERVICES', 'AMAZON COM SERVICES', 'AMAZON COM'],
  META: ['FACEBOOK', 'META PLATFORMS'],
  WMT: ['WALMART', 'WAL MART STORES'],
};

const SUFFIX = /\s+(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LTD|LIMITED|PLC|LP|L P|NV|SA|HOLDINGS?|GROUP)$/;
const LEGAL_FORMS = { INCORPORATED: 'INC', CORPORATION: 'CORP', COMPANY: 'CO', LIMITED: 'LTD', 'L L C': 'LLC', 'L P': 'LP' };

// SEC names can end in the state of incorporation: "NORTHROP GRUMMAN CORP /DE/".
const clean = (name) =>
  name
    .toUpperCase()
    .replace(/\s*\/[A-Z]{2}\/?\s*$/, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/^THE\s+/, '');

/** "The Boeing Company" -> "BOEING", "AMAZON.COM, INC." -> "AMAZON COM". */
export function normalize(name) {
  let s = clean(name);
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(SUFFIX, '').trim();
  }
  return s;
}

/** Like normalize(), but keeps the legal form: "The Boeing Company" and "BOEING CO" -> "BOEING CO". */
export function legalName(name) {
  return clean(name).replace(/\s(INCORPORATED|CORPORATION|COMPANY|LIMITED|L L C|L P)$/, (_, f) => ` ${LEGAL_FORMS[f]}`);
}

/**
 * Pick the recipients that are this company: top-level (parent or standalone) USAspending
 * recipients with the company's exact legal name ("APPLE INC", not "APPLE CORPORATION"),
 * or one of its hand-picked aliases (any legal form). `results` come from POST /recipient/.
 */
export function matchRecipients(results, companyName, aliases = []) {
  const exact = legalName(companyName);
  const loose = new Set(aliases.map(normalize));
  const out = [];
  const seen = new Set();
  for (const r of results) {
    const isCompany = legalName(r.name) === exact || loose.has(normalize(r.name));
    if (r.recipient_level === 'C' || !isCompany || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name, uei: r.uei ?? null });
  }
  return out.slice(0, MAX_RECIPIENTS);
}

/** Sum per-recipient, per-group agency rows into { key, label, note, total, agencies: [{ name, amount }] }. */
export function combineAwards(rowsByGroup) {
  return AWARD_GROUPS.map((g) => {
    const byAgency = new Map();
    for (const rows of rowsByGroup[g.key] ?? []) {
      for (const r of rows) byAgency.set(r.name, (byAgency.get(r.name) ?? 0) + r.amount);
    }
    const agencies = [...byAgency]
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .filter((a) => a.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    return { key: g.key, label: g.label, note: g.note, total: agencies.reduce((s, a) => s + a.amount, 0), agencies };
  });
}

/** The fiscal year that ends on `periodEnd`, as USAspending dates. */
export function fiscalYear(periodEnd) {
  const end = new Date(periodEnd + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(end) };
}

async function post(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`USAspending request failed (${res.status}): ${path}`);
  return res.json();
}

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Keyword search matches anywhere in a name and returns at most one page, so a short name
// ("INTEL") can be crowded out by others ("INTELSAT", "ELEGANTINTEL"). Searching the common
// legal forms of the name as well finds the company itself.
export function searchKeywords(names) {
  const out = new Set();
  for (const name of names) {
    const core = normalize(name);
    if (core.length < 3) continue;
    out.add(core);
    for (const suffix of ['CORPORATION', 'INC', 'COMPANY']) out.add(`${core} ${suffix}`);
  }
  return [...out];
}

async function findRecipients(ticker, companyName) {
  const aliases = ALIASES[ticker] ?? [];
  const keywords = searchKeywords([companyName, ...aliases]);
  const pages = await Promise.all(
    keywords.map((keyword) => post('recipient/', { keyword, award_type: 'all', limit: 50, sort: 'amount', order: 'desc' })),
  );
  return matchRecipients(pages.flatMap((p) => p.results ?? []), companyName, aliases);
}

async function awardsByAgency(recipientId, period, codes) {
  const data = await post('search/spending_by_category/awarding_agency/', {
    filters: { recipient_id: recipientId, time_period: [period], award_type_codes: codes },
    limit: 100,
  });
  return (data.results ?? []).map((r) => ({ name: r.name, amount: r.amount ?? 0 }));
}

/**
 * Federal contracts and assistance received by a company during the fiscal year ending `periodEnd`.
 * Returns { period, recipients: [{ id, name, uei, url }], groups, total }.
 */
export function getFederalAwards(ticker, companyName, periodEnd) {
  return cached(`${ticker}:${periodEnd}`, async () => {
    const period = fiscalYear(periodEnd);
    const recipients = await findRecipients(ticker, companyName);
    const rowsByGroup = {};
    await Promise.all(
      AWARD_GROUPS.flatMap((g) =>
        recipients.map(async (r) => {
          (rowsByGroup[g.key] ??= []).push(await awardsByAgency(r.id, period, g.codes));
        }),
      ),
    );
    const groups = combineAwards(rowsByGroup);
    return {
      period: { start: period.start_date, end: period.end_date },
      recipients: recipients.map((r) => ({ ...r, url: `https://www.usaspending.gov/recipient/${r.id}/latest` })),
      groups,
      total: groups.reduce((s, g) => s + g.total, 0),
    };
  });
}
