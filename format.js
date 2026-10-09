// Pure display helpers (shared by the page and the tests).

const SMALL = new Set(['and', 'of', 'the', 'or', '&']);

/** "MICROSOFT CORPORATION" -> "Microsoft Corporation". Mixed-case names are left alone. */
export function displayName(name) {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join('');
}

/** "Apple Inc." -> "Apple", "The Coca-Cola Company" -> "Coca-Cola". */
export function shortName(name) {
  let s = displayName(name).trim();
  const suffix = /,?\s+(&\s+)?(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|plc|llc|l\.p\.|n\.v\.|s\.a\.|holdings?|group)$/i;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(suffix, '').trim();
  }
  s = s.replace(/^the\s+/i, '');
  return s || name;
}

/** 416161000000 -> "$416.2 billion" (long) or "$416.2B" (short). */
export function money(value, long = false) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const units = [
    [1e12, 'T', 'trillion'],
    [1e9, 'B', 'billion'],
    [1e6, 'M', 'million'],
  ];
  for (const [n, short, word] of units) {
    if (abs >= n) {
      const v = (abs / n).toFixed(1);
      return long ? `${sign}$${v} ${word}` : `${sign}$${v}${short}`;
    }
  }
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

/** 50.36 -> "$50.36", -0.4 -> "−$0.40" */
export function per100(v) {
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
}

export function longDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Rank tickers for a query: exact ticker, ticker prefix, name word prefix, name contains.
 * Rows are [ticker, name, id?]; when an id is present, each company appears once.
 */
export function searchTickers(list, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const [ticker, name, id] of list) {
    const t = ticker.toLowerCase();
    const n = name.toLowerCase();
    let score = 0;
    if (t === q) score = 4;
    else if (t.startsWith(q)) score = 3;
    else if (n.startsWith(q) || n.includes(' ' + q)) score = 2;
    else if (n.includes(q)) score = 1;
    if (score) scored.push([score, ticker, name, id]);
  }
  // Stable sort keeps the list's order (roughly by size) within a score.
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set();
  const out = [];
  for (const [, ticker, name, id] of scored) {
    if (id != null && seen.has(id)) continue;
    seen.add(id);
    out.push({ ticker, name });
    if (out.length === limit) break;
  }
  return out;
}
