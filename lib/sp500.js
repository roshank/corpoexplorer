// S&P 500 membership. The SEC doesn't publish index membership, so we read Wikipedia's list,
// which carries each company's SEC ID (CIK) and sector.

const URL_SP500 = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';

const text = (cell) =>
  cell
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parse the "constituents" table: [{ ticker, name, sector, cik }]. Tickers use the SEC's
 * style ("BRK-B", not "BRK.B"). Throws if the table isn't there or looks wrong.
 */
export function parseSp500(html) {
  const start = html.indexOf('id="constituents"');
  if (start < 0) throw new Error('S&P 500 table not found');
  const table = html.slice(start, html.indexOf('</table>', start));
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1])));
  const head = rows.shift().map((h) => h.toLowerCase());
  const col = (name) => {
    const i = head.findIndex((h) => h.includes(name));
    if (i < 0) throw new Error(`S&P 500 table has no "${name}" column`);
    return i;
  };
  const [sym, name, sector, cik] = [col('symbol'), col('security'), col('sector'), col('cik')];
  const out = rows
    .filter((r) => r.length > cik)
    .map((r) => ({ ticker: r[sym].replace(/\./g, '-'), name: r[name], sector: r[sector], cik: Number(r[cik]) }))
    .filter((c) => c.ticker && c.cik > 0);
  // The index has ~503 share classes; anything far off means the page changed under us.
  if (out.length < 480 || out.length > 530) throw new Error(`S&P 500 table has ${out.length} rows, expected about 503`);
  return out;
}

/** Fetch the current list from Wikipedia. */
export async function fetchSp500() {
  const res = await fetch(URL_SP500, { headers: { 'User-Agent': 'CorpoExplorer (https://github.com/roshank/corpoexplorer)' } });
  if (!res.ok) throw new Error(`Wikipedia request failed (${res.status})`);
  return parseSp500(await res.text());
}
