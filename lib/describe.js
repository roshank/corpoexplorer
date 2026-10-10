// The company's own description of a cost line, from the text of its 10-K. Most filings
// explain each income statement line in the MD&A or the accounting policies, e.g.
// "Our cost of revenue consists of expenses associated with the delivery and distribution...".

const MAX_CHARS = 900;
const MAX_SENTENCES = 4;
// Verbs that define a line ("consists of"), not ones that explain a change ("driven by").
const VERB = '(?:consists?|includes?|comprises?|(?:is|are)\\s+comprised|represents?)\\b';
const CHANGE = /\b(increase[sd]?|decrease[sd]?|growth|grew|declined?|compared to|driven by|year-over-year|offset by)\b/i;

const PARA = '¶'; // marks the end of a paragraph, table cell or list item in the text

/** Filing HTML -> plain text (drops the hidden inline-XBRL header, scripts and styles). */
export function htmlToText(html) {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|td|tr|li|h\d)>/gi, ` ${PARA} `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#x2019;/gi, '’')
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    // Page footers in their own paragraph: "Apple Inc. | 2025 Form 10-K | 24".
    .replace(new RegExp(`${PARA}[^${PARA}|]{0,60}\\|\\s*(?:\\d{4}\\s+)?Form 10-K\\s*\\|\\s*\\d+\\s*(?=${PARA})`, 'gi'), '')
    .replace(new RegExp(`(\\s*${PARA})+`, 'g'), ` ${PARA}`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Sentence boundaries: a period followed by a space and a capital or digit, but not after
// common abbreviations ("Inc.", "U.S.", "e.g.").
function sentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]\s+(?=[A-Z0-9(“"])/g;
  for (let m; (m = re.exec(text)); ) {
    const before = text.slice(Math.max(0, m.index - 5), m.index + 1);
    if (/\b(Inc|Corp|Co|Ltd|No|vs|e\.g|i\.e|U\.S|etc)\.$/i.test(before)) continue;
    out.push(text.slice(start, m.index + 1).trim());
    start = m.index + m[0].length;
  }
  out.push(text.slice(start).trim());
  return out;
}

/**
 * Find the filing's description of a line item. `names` are the ways the filing names it
 * ("Cost of revenue", "Cost of sales"). Returns a few sentences, or null.
 */
export function describeLine(text, names) {
  // Generic names ("Other") would match unrelated sentences.
  for (const name of names.filter((n) => n && n.length >= 6 && !/^other\b/i.test(n))) {
    // A sentence that starts with the line's name and defines it right away:
    // "Our cost of revenue consists of...", "Research and development ("R&D") expense consists primarily of...".
    const re = new RegExp(
      `(?:^|[.:•${PARA}]\\s)((?:(?:Our|The|Total)\\s+)?${escapeRe(name)}(?:\\s+\\([^)]{1,20}\\))?` +
        `(?:\\s+(?:expenses?|costs?|charges))?(?:\\s+(?:primarily|mainly|mostly|generally|also|largely))?` +
        `\\s+${VERB}[^]{0,${MAX_CHARS * 2}})`,
      'gi',
    );
    for (const m of text.matchAll(re)) {
      const picked = [];
      let length = 0;
      // A description ends with its paragraph.
      for (const s of sentences(m[1].split(PARA)[0].trim())) {
        // Stop at the next heading ("Research and development.") or once we have enough.
        if (picked.length && (s.split(' ').length <= 5 || length + s.length > MAX_CHARS)) break;
        picked.push(s);
        length += s.length;
        if (picked.length >= MAX_SENTENCES) break;
      }
      const result = picked.join(' ');
      // Skip table fragments and risk-factor boilerplate.
      if (result.length < 60 || CHANGE.test(picked[0]) || /\$\s?\d|\d{4}\s+\d{4}|could|may adversely/i.test(picked[0])) continue;
      return result.length > MAX_CHARS ? result.slice(0, MAX_CHARS).replace(/\s\S*$/, '') + '…' : result;
    }
  }
  return null;
}
