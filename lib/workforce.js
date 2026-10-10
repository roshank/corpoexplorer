// How many people a company employs (from the 10-K text) and what its median employee is
// paid (from the CEO pay-ratio disclosure in its proxy statement, DEF 14A). Neither is in
// the machine-readable data, so we read the text. Together they give a rough estimate of the
// company's total pay to employees, which US companies don't have to report.

const NOUN = '(?:employees|associates|team members|people|persons|workers|colleagues)';
const NUMBER = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(million|thousand)?';
// The number has to be stated as the company's workforce: a verb right before it ("we employed
// approximately", "JPMorganChase had") or a point in time in the sentence ("as of January 31")...
const VERB_BEFORE = /\b(employ\w*|had|have|there were|includes|total of|workforce|headcount|grew)\b[^.¶]{0,30}$/i;
const POINT_IN_TIME = /\bas of\b|\bat (?:the end of|december|june|september|march)\b/i;
// ...and not a subset of it, a program or someone else's people.
const SUBSET =
  /\b(in the united states|in the u\.s\.|internationally|outside the|in research|in pharmaceutical|in (?:our )?(?:manufacturing|sales|engineering)|covered by|certified|participa|partnering|launching|terminated|reduction|hourly|affecting|hours of|unionized|represented by|of whom|volunteer)/i;

const toNumber = (digits, scale) => parseFloat(digits.replace(/,/g, '')) * (scale === 'million' ? 1e6 : scale === 'thousand' ? 1e3 : 1);

/** Total employees stated in the 10-K, or null. `text` comes from htmlToText(). */
export function extractHeadcount(text) {
  const candidates = [];
  const patterns = [
    // "approximately 166,000 full-time equivalent employees", "65,900 and 69,700 employees, respectively"
    new RegExp(`${NUMBER}(?:\\s+and\\s+[\\d,.]+(?:\\s*(?:million|thousand))?)?(?:\\s\\d)?\\s+(?:[a-z-]+\\s+){0,4}?${NOUN}`, 'gi'),
    // "headcount of 47,400", "workforce, which was comprised of 85,100 people"
    new RegExp(`(?:headcount|workforce)[^.¶]{0,40}?\\b(?:of|was|to)\\s+(?:approximately\\s+)?${NUMBER}`, 'gi'),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('¶', m.index)) + 1;
      const sentence = text.slice(start, m.index + m[0].length + 60);
      const near = text.slice(Math.max(start, m.index - 60), m.index + m[0].length);
      const before = text.slice(Math.max(start, m.index - 45), m.index);
      if (!(VERB_BEFORE.test(before) || POINT_IN_TIME.test(sentence) || /headcount|workforce/i.test(m[0])) || SUBSET.test(near)) continue;
      const n = toNumber(m[1], m[2]);
      if (n >= 100 && n <= 5e6) candidates.push(n);
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * The median employee's annual total pay from a pay-ratio disclosure (proxy statement or
 * 10-K amendment): { pay, year }, or null. `year` is the year the pay is for, when stated.
 */
export function findMedianPay(text) {
  // "other than Mr. Creed, was $89,253": titles shouldn't end the sentence.
  const t = text.replace(/\b(Mr|Ms|Mrs|Dr)\./g, '$1');
  const patterns = [
    // "...median employee (other than our CEO) was $388,200"
    /median[^.¶]{0,260}?\$\s?(\d{1,3}(?:,\d{3})+)(?![\d,]*\s*(?:million|billion))/gi,
    // "...and $177,115 for our median employee"
    /\$\s?(\d{1,3}(?:,\d{3})+)\s+(?:for|of|to)\s+(?:our|the)\s+median\b/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      // CEO pay is in the millions, so the range below already rules it out.
      if (!/employee|associate|team member|compensat/i.test(m[0]) && !/median\b/i.test(m[0].slice(-10))) continue;
      const pay = Number(m[1].replace(/,/g, ''));
      if (pay < 5_000 || pay > 2_000_000) continue;
      // "the median 2025 annual total compensation", "For 2025, the median..."
      const around = t.slice(Math.max(0, m.index - 120), m.index + m[0].length);
      const years = [...around.matchAll(/\b(?:fiscal(?: year)?\s+)?(20[1-3]\d)\b/g)].map((y) => Number(y[1]));
      return { pay, year: years.length ? Math.max(...years) : null };
    }
  }
  return null;
}

/** The median employee's annual total pay from a proxy statement, or null. */
export function extractMedianPay(text) {
  return findMedianPay(text)?.pay ?? null;
}
