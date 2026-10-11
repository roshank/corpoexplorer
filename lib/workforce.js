// How many people a company employs (from the 10-K text) and what its median employee is
// paid (from the CEO pay-ratio disclosure in its proxy statement, DEF 14A). Neither is in
// the machine-readable data, so we read the text. Together they give a rough estimate of the
// company's total pay to employees, which US companies don't have to report.

const NOUN = '(?:employees|associates|team members|people|persons|workers|colleagues|professionals)';
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
    // "415,000 full-time, part-time, and seasonal team members" (Target)
    new RegExp(`${NUMBER}(?:\\s+and\\s+[\\d,.]+(?:\\s*(?:million|thousand))?)?(?:\\s\\d)?\\s+(?:[a-z-]+,?\\s+){0,5}?${NOUN}`, 'gi'),
    // "headcount of 47,400", "workforce, which was comprised of 85,100 people"
    // "our workforce comprises 544 professionals" (Realty Income), "our employee population,
    // including all full-time, part-time and temporary workers, consisted of approximately" (Elevance)
    new RegExp(`(?:headcount|workforce|employee population)[^.¶]{0,100}?\\b(?:of|was|to|comprises|comprised of|consisted of|totaled)\\s+(?:approximately\\s+)?${NUMBER}`, 'gi'),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('¶', m.index)) + 1;
      const sentence = text.slice(start, m.index + m[0].length + 60);
      const near = text.slice(Math.max(start, m.index - 60), m.index + m[0].length);
      const before = text.slice(Math.max(start, m.index - 45), m.index);
      if (!(VERB_BEFORE.test(before) || POINT_IN_TIME.test(sentence) || /headcount|workforce|employee population/i.test(m[0])) || SUBSET.test(near)) continue;
      const n = toNumber(m[1], m[2]);
      if (n >= 100 && n <= 5e6) candidates.push(n);
    }
  }
  // Tables: a "Total employees" row (Chevron), or a workforce table in thousands (IBM:
  // "IBM/wholly owned subsidiaries ¶ 264.3 ¶ Less-than-wholly owned subsidiaries ¶ 8.7").
  for (const m of text.matchAll(/total (?:number of )?employees((?:\s*¶\s*(?:[\d,.]+|%))+)/gi)) {
    for (const cell of m[1].matchAll(/\d{1,3}(?:,\d{3})+/g)) candidates.push(toNumber(cell[0]));
  }
  for (const m of text.matchAll(/employees[^¶]{0,120}¶\s*\(in thousands\)/gi)) {
    const cells = text.slice(m.index + m[0].length, m.index + m[0].length + 400).split('¶').map((c) => c.trim());
    for (let i = 1; i < cells.length; i++) {
      if (!/^\d+\.\d$/.test(cells[i])) continue;
      if (/less-than|complementary|contract|temporary/i.test(cells[i - 1])) continue;
      candidates.push(toNumber(cells[i], 'thousand'));
      break;
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
    // A table: "Median Employee Annual Total Compensation ¶ $125,100"
    /median[^.¶]{0,80}compensation\W{0,3}¶\s*\$\s?(\d{1,3}(?:,\d{3})+)/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      // CEO pay is in the millions, so the range below already rules it out.
      if (!/employee|associate|team member|compensat/i.test(m[0]) && !/median\b/i.test(m[0].slice(-10))) continue;
      // "The base salary for the median employee was $48,001": salary alone isn't total pay.
      if (/\b(?:base\s+)?(?:salary|wages?)\s+(?:for|of)\s+(?:our|the)\s+median\b/i.test(t.slice(Math.max(0, m.index - 40), m.index + 30))) continue;
      const pay = Number(m[1].replace(/,/g, ''));
      if (pay < 5_000 || pay > 2_000_000) continue;
      // "the median 2025 annual total compensation", "For 2025, the median...", or further back
      // for tables ("The table below discloses the 2025 annual total compensation...").
      const yearsIn = (back) =>
        [...t.slice(Math.max(0, m.index - back), m.index + m[0].length).matchAll(/\b(?:fiscal(?: year)?\s+)?(20[1-3]\d)\b/g)].map((y) => Number(y[1]));
      const years = yearsIn(120).length ? yearsIn(120) : yearsIn(200);
      return { pay, year: years.length ? Math.max(...years) : null };
    }
  }
  return null;
}

/** The median employee's annual total pay from a proxy statement, or null. */
export function extractMedianPay(text) {
  return findMedianPay(text)?.pay ?? null;
}

/**
 * The CEO pay ratio a company states in its pay-ratio disclosure: how many times the median
 * employee's pay the CEO got ("533 to 1", "293:1", "1-to-51", "345-to-one", "4.16 to 1",
 * "approximately 512 times the compensation of the median employee"), or null. Ratios below 1
 * are skipped: Tesla adds a "realized pay" ratio of "0.00:1" next to the required one.
 */
export function findPayRatio(text) {
  return findRatioStatement(text)?.ratio ?? null;
}

/** The stated ratio and where it is in the text: { ratio, index }, or null. */
function findRatioStatement(text) {
  const t = text.replace(/\b(Mr|Ms|Mrs|Dr)\./g, '$1');
  const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const SEP = '\\s*(?:-\\s*to\\s*-|to|:)\\s*';
  const patterns = [
    new RegExp(`(?<![\\d.,])${NUM}${SEP}(?:1|one)(?![\\d.,]*\\d)`, 'gi'),
    new RegExp(`(?<![\\d.,])(?:1|one)${SEP}${NUM}(?![\\d.,]*\\d)`, 'gi'),
    new RegExp(`(?<![\\d.,])${NUM}\\s+times\\s+(?:the\\s+|that\\s+of\\s+(?:the|our)\\s+)?(?:annual\\s+)?(?:total\\s+)?(?:compensation|pay)\\s+(?:of|for)\\s+(?:the|our)\\s+median`, 'gi'),
  ];
  const found = [];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const before = t.slice(Math.max(0, m.index - 1500), m.index);
      // A ratio, in the pay-ratio disclosure: "ratio" just before (or "times ... median" itself).
      if (!/times/i.test(m[0]) && !/ratio/i.test(t.slice(Math.max(0, m.index - 400), m.index))) continue;
      if (!/median|pay ratio/i.test(before + m[0])) continue;
      const ratio = Number(m[1].replace(/,/g, ''));
      if (ratio >= 1) found.push({ index: m.index, ratio });
    }
  }
  if (!found.length) return null;
  return found.sort((a, b) => a.index - b.index)[0];
}

/**
 * Median pay stated just before the pay ratio, for disclosures findMedianPay can't read on its
 * own (Starbucks: "our median employee, a part-time barista in the U.S., was $17,279"; Target:
 * a line break before the amount). { pay, year } or null.
 */
export function findMedianPayNearRatio(text) {
  const r = findRatioStatement(text);
  if (!r) return null;
  // Same text the ratio was found in, so its position lines up.
  const t = text.replace(/\b(Mr|Ms|Mrs|Dr)\./g, '$1');
  const window = t.slice(Math.max(0, r.index - 900), r.index).replace(/\bU\.S\./g, 'US');
  let pick = null;
  for (const m of window.matchAll(/median[^.]{0,200}?\$\s?(\d{1,3}(?:,\d{3})+)(?![\d,]*\s*(?:million|billion))/gi)) {
    const pay = Number(m[1].replace(/,/g, ''));
    if (pay >= 5_000 && pay <= 2_000_000 && !/percentile/i.test(m[0])) pick = { pay, at: m.index };
  }
  if (!pick) return null;
  const years = [...window.slice(Math.max(0, pick.at - 200), pick.at + 200).matchAll(/\b(?:fiscal(?: year)?\s+)?(20[1-3]\d)\b/g)].map((y) => Number(y[1]));
  return { pay: pick.pay, year: years.length ? Math.max(...years) : null };
}
