// How many people a company employs (from the 10-K text) and what its median employee is
// paid (from the CEO pay-ratio disclosure in its proxy statement, DEF 14A). Neither is in
// the machine-readable data, so we read the text. Together they give a rough estimate of the
// company's total pay to employees, which US companies don't have to report.

const NOUN =
  '(?:employees|associates|team members|people|persons|workers|colleagues|professionals|staff members|personnel|individuals|teammates|coworkers|employee-[a-z]+s)';
const NUMBER = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(million|thousand)?';
const ABOUT = '(?:(?:approximately|about|over|more than|nearly|roughly|almost|~)\\s*)?';
// The number has to be stated as the company's workforce: a verb right before it ("we employed
// approximately", "JPMorganChase had", "With about 169,000 employees", "We ended the year 2025
// with"), "our approximately 67,200 employees", or a point in time in the sentence ("as of
// January 31")...
const VERB_BEFORE =
  /\b(employ(?!ment)\w*|had|has|have|there were|includes|total of|workforce|headcount|grew)\b[^.¶]{0,30}$|^\s*with\b[^.¶]{0,20}$|\bended the year\b[^.¶]{0,10}\bwith\b[^.¶]{0,15}$/i;
const OWN_BEFORE = new RegExp(`\\b(?:our|the company[’']s)\\s+${ABOUT}$`, 'i');
const POINT_IN_TIME = /\bas of\b|\bat (?:the end of|december|june|september|march|year[- ]end)\b/i;
// ...and not a subset of it, a program or someone else's people.
const SUBSET =
  /\b(in the united states|in the u\.s\.|internationally|outside the|in research|in pharmaceutical|in (?:our )?(?:manufacturing|sales|engineering)|covered by|certified|participa|partnering|launching|terminated|reduction|hourly|affecting|hours of|unionized|represented by|of whom|volunteer|shares|stock|units|options|withheld|granted|additional|clients|customers|users|subscribers|patients|students|screened|served|train\w*|reached|helped|treated|eligible|recruit)/i;
// "237,324 professionals using FactSet", "2.9 million people visit each month",
// "solutions to over 160,000 employers" (ADP).
const NOT_STAFF_AFTER = /^\s*(?:using|who use|visit|employers|clients|customers|companies|businesses|organizations|users)\b/i;

const toNumber = (digits, scale) => parseFloat(digits.replace(/,/g, '')) * (scale === 'million' ? 1e6 : scale === 'thousand' ? 1e3 : 1);
const isYear = (cell) => /^(?:19|20)\d\d$/.test(cell);

/** Total employees stated in the 10-K, or null. `text` comes from htmlToText(). */
export function extractHeadcount(text) {
  const candidates = [];
  // [pattern, whether the match itself says it's the workforce]
  const patterns = [
    // "approximately 166,000 full-time equivalent employees", "65,900 and 69,700 employees, respectively"
    // "415,000 full-time, part-time, and seasonal team members" (Target), "8,336 full time/permanent employees" (AES);
    // not "over 330,000 voluntary memberships, which provide teammates" (Bank of America)
    [new RegExp(`${NUMBER}(?:\\s+and\\s+[\\d,.]+(?:\\s*(?:million|thousand))?)?(?:\\s\\d)?\\s+(?:(?!(?:which|who|whom|that|to|for|of|in|with|by|from)\\b)[a-z/-]+,?\\s+){0,4}?${NOUN}`, 'gi'), false],
    // "headcount of 47,400", "workforce, which was comprised of 85,100 people", "a workforce of more than 10,000"
    // "our workforce comprises 544 professionals" (Realty Income), "our employee population,
    // including all full-time, part-time and temporary workers, consisted of approximately" (Elevance)
    // "our full-time count for our and our subsidiaries’ employees worldwide was 99,290" (Tesla, 2021)
    [new RegExp(`(?:headcount|full-time count|workforce|employee population)[^.¶]{0,100}?\\b(?:of|was|to|comprises|comprised of|consisted of|totaled)\\s+${ABOUT}${NUMBER}`, 'gi'), true],
    // "Employees totaled 55,333 at December 31, 2025" (PNC), "Company employees, including those
    // in Company-operated restaurants, totaled over 150,000" (McDonald's)
    [new RegExp(`\\b(?:employees|team members|associates|colleagues)\\b[^.¶$]{0,80}?\\btotal(?:l?ed)\\s+${ABOUT}${NUMBER}`, 'gi'), true],
    // "we employed approximately 130,000 AutoZoners", "we employed 9,400, including part-time and temporary employees"
    [new RegExp(`\\bemploy(?:s|ed)\\s+(?:a total of\\s+)?${ABOUT}${NUMBER}(?=,\\s+including\\b|\\s+[A-Z][A-Za-z]+s\\b)`, 'g'), true],
  ];
  for (const [re, stated] of patterns) {
    for (const m of text.matchAll(re)) {
      const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('¶', m.index)) + 1;
      const sentence = text.slice(start, m.index + m[0].length + 60);
      const near = text.slice(Math.max(start, m.index - 60), m.index + m[0].length);
      const before = text.slice(Math.max(start, m.index - 45), m.index);
      // The verb can sit in the paragraph before: "we employed approximately ¶ 101,000 EMPLOYEES" (Honeywell).
      const lead = text.slice(Math.max(0, m.index - 45), m.index).replace(/¶/g, ' ');
      const employed = new RegExp(`\\bemploy(?:s|ed)\\s*(?:a total of\\s+)?${ABOUT}:?\\s*$`, 'i').test(lead);
      // "Over 150,000 people are employed by the Company" (McDonald's).
      const employedBy = /^\s*(?:are|were)\s+employed\b/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 20));
      const workforce = stated || VERB_BEFORE.test(before) || OWN_BEFORE.test(before) || employed || employedBy || POINT_IN_TIME.test(sentence);
      if (!workforce || SUBSET.test(near) || NOT_STAFF_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 20))) continue;
      // Franchisees' staff ("our approximately 61,000 franchise restaurants ... employment of over an
      // estimated 1 million people"), last year's count ("compared to November 30, 2024, when we
      // employed 13,265 individuals"), or money ("$3 million in grants to employees").
      if (/franchis|compared (?:to|with)/i.test(text.slice(start, m.index)) || /\$\s*$/.test(before)) continue;
      const n = toNumber(m[1], m[2]);
      // "as of 2025" isn't a headcount.
      if (!m[1].includes(',') && !m[2] && n >= 1900 && n <= 2100) continue;
      // Small companies say so plainly: "we employed 28 employees" (VICI).
      if ((n >= 100 || (employed && n >= 10)) && n <= 5e6) candidates.push(n);
    }
  }
  // Two groups that make up the whole: "approximately 88,000 (56%) hourly employees and approximately
  // 68,000 (44%) salaried employees" (GM), "7,668 full-time and 70 part-time active employees" (NiSource).
  const PART = '\\s*(?:\\(\\d+%\\)\\s*)?';
  const both = new RegExp(
    `(\\d{1,3}(?:,\\d{3})+|\\d+)${PART}(?:full-time|hourly|salaried)(?:\\s+employees)?\\s+and\\s+${ABOUT}(\\d{1,3}(?:,\\d{3})+|\\d+)${PART}(?:part-time|salaried|hourly)\\b[^.¶]{0,20}?${NOUN}` +
      // "... part-time employees in the U.S. and 16,000 employees internationally" (MGM Resorts)
      `(?:\\s+in the U\\.S\\.,?\\s+and\\s+${ABOUT}(\\d{1,3}(?:,\\d{3})+|\\d+)\\s+(?:employees\\s+)?(?:internationally|outside the U\\.S\\.))?`,
    'gi',
  );
  for (const m of text.matchAll(both)) {
    const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('¶', m.index)) + 1;
    const before = text.slice(Math.max(start, m.index - 45), m.index);
    if (VERB_BEFORE.test(before) || POINT_IN_TIME.test(text.slice(start, m.index + m[0].length))) candidates.push(toNumber(m[1]) + toNumber(m[2]) + (m[3] ? toNumber(m[3]) : 0));
  }
  // Tables: a "Total employees" row (Chevron, "Total team members (hourly and salaried)" at Darden),
  // or a workforce table in thousands (IBM: "IBM/wholly owned subsidiaries ¶ 264.3 ¶ Less-than-wholly
  // owned subsidiaries ¶ 8.7").
  for (const m of text.matchAll(/total (?:number of )?(?:employees|team members|associates|colleagues)(?:\s*\((?!average)[^)]*\))?((?:\s*¶\s*(?:[\d,.]+|%))+)/gi)) {
    const cells = [...m[1].matchAll(/\d{1,3}(?:,\d{3})+/g)].map((c) => toNumber(c[0]));
    // Columns for years ("2025 ¶ 2024 ¶ 2023"): the first is the latest.
    const byYear = /¶\s*20\d\d\s*¶\s*20\d\d\s*¶/.test(text.slice(Math.max(0, m.index - 300), m.index));
    candidates.push(...(byYear ? cells.slice(0, 1) : cells));
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
  // A table introduced as the workforce ("The following table presents our employee count as of
  // December 31, 2025:"): its first figure, which is the whole company when the table lists the
  // parent and its subsidiaries (Ameren, PPL), and its "Total" row when it splits the workforce
  // (ADM: "Total ¶ 20,119 ¶ 20,679 ¶ 698 ¶ 41,496").
  const INTRO =
    /\b(?:number of (?:our )?(?:employees|associates|colleagues)|employee count|headcount|our (?:total )?(?:employees|associates|workforce|colleagues|employee population)|company[’']s employees|(?:full|part)-time[^.¶]{0,30}employees|employee population|associates we employed)\b/i;
  for (const m of text.matchAll(/[^.¶]{0,250}\b(?:tables?|following|as follows)\b[^.¶]{0,250}[:.]\s*¶/gi)) {
    if (!INTRO.test(m[0]) || /\$|million|benefit|plan\b|cost|expense|compensation|pension/i.test(m[0])) continue;
    // The last cell may be cut off.
    const table = text.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const cells = table.split('¶').slice(0, -1).map((c) => c.trim());
    const isCount = (c) => /^\d{1,3}(?:,\d{3})+$/.test(c);
    const first = table.slice(0, 600).split('¶').slice(0, -1).map((c) => c.trim()).find(isCount);
    if (first) candidates.push(toNumber(first));
    for (let i = 0; i < cells.length; i++) {
      if (!/^total(?:\s*\([a-z0-9]\))?$/i.test(cells[i]) || !isCount(cells[i + 1] ?? '')) continue;
      let j = i + 1;
      while (j < cells.length && /^\d{1,3}(?:,\d{3})*$/.test(cells[j])) j++;
      const row = cells.slice(i + 1, j).map((c) => toNumber(c));
      const byYear = cells.slice(0, i).some((c, k) => isYear(c) && isYear(cells[k + 1] ?? ''));
      candidates.push(byYear ? row[0] : Math.max(...row));
      break;
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
}

// A dollar amount in a pay-ratio disclosure: "$388,200", "$ 124,131", "$189.7 thousand" (Devon).
const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d+)?\s*thousand)(?![\d,]*\s*(?:million|billion))/gi;
const dollars = (s) => (/thousand/i.test(s) ? Math.round(parseFloat(s) * 1000) : Number(s.replace(/,/g, '')));
const inRange = (pay) => pay >= 5_000 && pay <= 2_000_000;

/** Text clean-up shared by the pay-ratio readers, so positions line up between them. */
function clean(text) {
  return (
    text
      // "a full-time employee in the U.S. paid in U.S. Dollars whose total earnings were $98,317" (Bloom Energy)
      .replace(/\bU\.S\./g, 'US')
      // "other than Mr. Creed, was $89,253", "our Interim CEO, Jeffrey M. Ettinger, was $57,789",
      // "(other than Messrs. Bae and Nuttall, who were our Co-Chief Executive Officers ...) was $210,000":
      // titles and initials don't end the sentence.
      .replace(/\b(Mr|Ms|Mrs|Dr|Messrs)\./g, '$1')
      .replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, '$1')
      // A page break inside a sentence: "the median 2023 annual total compensation of all other qualifying
      // ¶ 2024 Proxy Statement 135 ¶ TABLE OF CONTENTS ¶ employees ... was $45,811" (Tesla).
      .replace(/\s*¶\s*(?:(?:20\d\d\s+)?Proxy Statement\s+\d+\s*¶\s*)?TABLE OF CONTENTS\s*¶\s*(?=[a-z])/g, ' ')
      // Dot leaders: "Median employee’s annual total compensation . . . . . ¶ $186,132" (Marathon).
      .replace(/(?:\s?\.){4,}/g, ' ')
      // A line break inside a sentence: "our median employee, ¶ other than our Chief Executive Officer, was $58,919" (CRH).
      .replace(/\s¶(?=\s+[a-z])/g, '')
  );
}

// Years stated near an amount, but not the proxy's own ("2026 Proxy Statement") or the date the
// median employee was picked ("employed as of August 1, 2024"), unless nothing else is stated before it.
const yearsNear = (t, from, to, dates = false) => {
  const part = t.slice(Math.max(0, from), to);
  return [...part.matchAll(/\b(?:fiscal(?: year)?\s+)?(20[1-3]\d)\b(?!\s+(?:proxy|annual meeting|notice))/gi)]
    .filter((y) => dates || !/\bas of [a-z]+ \d{1,2},?\s*$/i.test(part.slice(Math.max(0, y.index - 25), y.index)))
    .map((y) => Number(y[1]));
};

/**
 * The median employee's annual total pay from a pay-ratio disclosure (proxy statement or
 * 10-K amendment): { pay, year }, or null. `year` is the year the pay is for, when stated.
 */
export function findMedianPay(text) {
  const t = clean(text);
  // Each reading gives { index, match, amount }: where the statement starts, its text up to the amount.
  const readings = [
    // "...median employee (other than our CEO) was $388,200"; "for each of Mr Griffith and for the
    // median employee was $7,697,503 and $104,956, respectively": the first amount that can be an
    // employee's pay.
    function* () {
      for (const m of t.matchAll(/median(?:[^.¶]|\.\d){0,260}/gi)) {
        // "The base salary for the median employee was $48,001": salary alone isn't total pay.
        if (/\b(?:base\s+)?(?:salary|wages?)\s+(?:for|of)\s+(?:our|the)\s+median\b/i.test(t.slice(Math.max(0, m.index - 40), m.index + 30))) continue;
        // "for Mr Gassner and our median employee was $470,833 and $140,473, respectively" (Veeva): the
        // median's is the second amount, unless the median is named first ("median employee and the CEO").
        const pair = /(\$[^$]*?)\band\s+(\$\s?\d{1,3}(?:,\d{3})+),?\s+respectively/i.exec(m[0]);
        if (pair && !/\band\b/i.test(m[0].slice(0, pair.index))) {
          const second = /\$\s?(\d{1,3}(?:,\d{3})+)/.exec(pair[2]);
          if (inRange(dollars(second[1]))) {
            yield { index: m.index, match: m[0].slice(0, pair.index + pair[0].length), amount: second[1] };
            continue;
          }
        }
        for (const a of m[0].matchAll(AMOUNT)) {
          const match = m[0].slice(0, a.index + a[0].length);
          if (!/employee|associate|team member|compensat/i.test(match)) continue;
          // "the median employee was ... with wages and overtime pay ... of $37,948" (Las Vegas Sands): not total pay.
          if (/\b(?:wages|salary|salaries|base pay)\b/i.test(match) && !/total (?:annual )?compensation|annual total/i.test(match)) continue;
          if (inRange(dollars(a[1]))) {
            yield { index: m.index, match, amount: a[1] };
            break;
          }
        }
      }
    },
    // "...and $177,115 for our median employee", "by $92,390, which represents the annual total
    // compensation of our median employee" (Comcast)
    function* () {
      const re =
        /\$\s?(\d{1,3}(?:,\d{3})+),?\s+(?:which\s+(?:represents|is|was)\s+)?(?:the\s+)?(?:annual\s+)?(?:total\s+)?(?:compensation\s+)?(?:for|of|to)\s+(?:our|the)\s+median\b/gi;
      for (const m of t.matchAll(re)) yield { index: m.index, match: m[0], amount: m[1] };
    },
    // A table row: "Median Employee Annual Total Compensation ¶ $125,100", "Annual total compensation
    // of the median employee for 2025 ¶ $ ¶ 124,131", "Median-Paid Employee ¶ $99,631"
    function* () {
      for (const m of t.matchAll(/median[^¶$]{0,150}¶\s*\$\s*(?:¶\s*)?(\d{1,3}(?:,\d{3})+)/gi)) {
        if (/employee|associate|team member|compensat/i.test(m[0])) yield { index: m.index, match: m[0], amount: m[1] };
      }
    },
    // A row of the summary compensation table, ending in the total: "Median Employee ¶ 2025 ¶ 79,308 ¶
    // — ¶ ... ¶ 82,935" under "Total ($)" (Humana), "Our median employee ¶ 63,053" (Kraft Heinz).
    function* () {
      const re = /¶\s*(?:our\s+)?median[- ](?:paid\s+|compensated\s+)?(?:employee|associate|team member)s?(?:\s*\([^)]{0,20}\))?\s*((?:¶\s*(?:20\d\d|\d{1,3}(?:,\d{3})+|\d{1,3}|—|–|-|\$)\s*)+)¶/gi;
      for (const m of t.matchAll(re)) {
        if (!/\(\$\)/.test(t.slice(Math.max(0, m.index - 1500), m.index))) continue;
        const amounts = [...m[1].matchAll(/\d{1,3}(?:,\d{3})+/g)];
        if (amounts.length) yield { index: m.index, match: m[0], amount: amounts.at(-1)[0] };
      }
    },
    // Columns for the CEO and the median employee: "President and CEO ¶ Median Employee ¶ ... TOTAL ¶
    // $ ¶ 9,799,678 ¶ $ ¶ 81,203" (Church & Dwight), "Annual Total Compensation ¶ $ ¶ 11,530,116 ¶ $ ¶ 73,280" (STERIS).
    function* () {
      for (const h of t.matchAll(/\b(?:CEO|Chief Executive Officer)\s*¶\s*Median (?:Employee|Associate)\s*¶/g)) {
        const after = t.slice(h.index, h.index + 1500);
        const row = /¶\s*(?:total|annual total compensation)\s*¶\s*\$?\s*(?:¶\s*)?\d{1,3}(?:,\d{3})+\s*¶\s*\$?\s*(?:¶\s*)?(\d{1,3}(?:,\d{3})+)/i.exec(after);
        if (row) yield { index: h.index, match: after.slice(0, row.index + row[0].length), amount: row[1] };
      }
    },
  ];
  for (const read of readings) {
    for (const { index, match, amount } of read()) {
      const pay = dollars(amount);
      // CEO pay is in the millions, so the range already rules it out.
      if (!inRange(pay)) continue;
      // "the median 2025 annual total compensation", "For 2025, the median...", or further back
      // for tables ("The table below discloses the 2025 annual total compensation...").
      const end = index + match.length;
      // ...or just after: "was $86,683. Based on the above, for fiscal 2026, the ratio" (Take-Two).
      const years =
        [yearsNear(t, index - 120, end), yearsNear(t, index - 200, end), yearsNear(t, end, end + 150), yearsNear(t, index - 200, end, true)].find((y) => y.length) ?? [];
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
 * "approximately 512 times the compensation of the median employee", "for 2025 is 330."), or
 * null. Zero is skipped: Tesla adds a "realized pay" ratio of "0.00:1" next to the required one.
 * "1 to 0.97" (Airbnb, whose CEO is paid about what its median employee is) is 1.03.
 */
export function findPayRatio(text) {
  return findRatioStatement(text)?.ratio ?? null;
}

// Ratios written out: "approximately four hundred and fifty-seven times" (Blackstone).
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_WORD = `(?:${[...UNITS.slice(1), ...TENS.slice(2), 'hundred', 'thousand'].join('|')})`;
function wordsToNumber(words) {
  let total = 0;
  let part = 0;
  for (const w of words.toLowerCase().split(/[\s-]+/)) {
    if (UNITS.includes(w)) part += UNITS.indexOf(w);
    else if (TENS.includes(w)) part += TENS.indexOf(w) * 10;
    else if (w === 'hundred') part *= 100;
    else if (w === 'thousand') (total += part * 1000), (part = 0);
  }
  return total + part;
}
const toRatio = (s) => (/^\d/.test(s) ? Number(s.replace(/,/g, '')) : wordsToNumber(s));

/** The stated ratio and where it is in the text: { ratio, index }, or null. */
function findRatioStatement(text) {
  const t = clean(text);
  const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const SEP = '\\s*(?:-\\s*to\\s*-|to|:)\\s*';
  // [pattern, says it's a ratio by itself, the number is the median's side ("1 to 51")]
  const patterns = [
    // "approximately 296-1" (Salesforce), "592(1) to 1" (MSCI, with a footnote)
    [new RegExp(`(?<![\\d.,])${NUM}(?:\\s?\\(\\d\\))?(?:${SEP}|-)(?:1|one)(?![\\d.,]*\\d)`, 'gi'), false, false],
    [new RegExp(`(?<![\\d.,])(?:1|one)${SEP}${NUM}(?![\\d.,]*\\d)`, 'gi'), false, true],
    // "approximately 512 times the compensation of the median employee", "166 times that of our median
    // employee" (Boeing), "312 times the similarly calculated compensation of our median employee" (Cummins)
    [new RegExp(`(?<![\\d.,:])${NUM}\\s+times\\s+(?:that\\s+of|the|our)\\b[^.¶]{0,80}?\\bmedian`, 'gi'), true, false],
    [new RegExp(`\\b(${NUMBER_WORD}(?:(?:\\s+and\\s+|[\\s-]+)${NUMBER_WORD})*)\\s+times\\s+(?:that\\s+of|the|our)\\b[^.¶]{0,80}?\\bmedian`, 'gi'), true, false],
    // "The ratio of the annual total compensation for our CEO ... compared to the median ... for 2025 is 330." (Marsh)
    [new RegExp(`\\bratio\\b[^.¶]{0,250}?\\b(?:is|was)\\s+(?:approximately\\s+)?${NUM}(?=\\s*\\.(?:\\s|$))`, 'gi'), true, false],
    // A table: "Ratio of CEO to Median Employee Total Annual Compensation ¶ 81.7" (Charter),
    // "CEO Pay to Median Employee Pay Ratio ¶ 120.7 ¶ 1" (Church & Dwight)
    [new RegExp(`\\bratio\\b[^.¶$]{0,120}¶\\s*${NUM}\\s*(?:¶\\s*1\\s*)?¶`, 'gi'), true, false],
  ];
  const found = [];
  for (const [re, self, inverse] of patterns) {
    for (const m of t.matchAll(re)) {
      const before = t.slice(Math.max(0, m.index - 1500), m.index);
      // "...that of our median": compensation compared, not "met 5 times".
      if (/times/i.test(m[0]) && !/that of|compensation|pay/i.test(t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 60))) continue;
      // A table's ratio comes after the amounts it divides (not a page number in the contents).
      if (/¶\s*$/.test(m[0]) && (!/median/i.test(m[0]) || !/\$\s*(?:¶\s*)?\d/.test(t.slice(Math.max(0, m.index - 400), m.index)))) continue;
      // A ratio, in the pay-ratio disclosure: "ratio" just before (or "times ... median" itself).
      // ("CEO pay to median employee pay is 203:1" at WTW).
      if (!self && !/ratio|pay to (?:the |our )?median/i.test(t.slice(Math.max(0, m.index - 400), m.index))) continue;
      if (!/median|pay ratio/i.test(before + m[0])) continue;
      // A comparison with other companies ("the median ratio for S&P 500 companies (195:1)").
      if (/S&P|peer|companies|industry|median ratio/i.test(t.slice(Math.max(0, m.index - 60), m.index))) continue;
      // "... for 2025 is 2025." isn't a ratio.
      if (!m[1].includes(',') && /^(?:19|20)\d\d$/.test(m[1])) continue;
      let ratio = toRatio(m[1]);
      if (inverse && ratio > 0 && ratio < 1) ratio = Math.round(100 / ratio) / 100;
      // "Close" when "median" is near too, as in a real disclosure; far-off matches are a fallback.
      const close = self || /median/i.test(t.slice(Math.max(0, m.index - 700), m.index + m[0].length + 150));
      // Tesla's "realized pay" ratio is "0.00:1"; a CEO can be paid less than the median employee
      // (Axon: "0.3:1").
      if (ratio > 0) found.push({ index: m.index, ratio, close });
    }
  }
  if (!found.length) return null;
  return found.sort((a, b) => b.close - a.close || a.index - b.index)[0];
}

/**
 * Median pay stated just before the pay ratio, for disclosures findMedianPay can't read on its
 * own (Starbucks: "our median employee, a part-time barista in the U.S., was $17,279"; Target:
 * a line break before the amount; Lennar: "That associate received total compensation of
 * $103,701"). { pay, year } or null.
 */
export function findMedianPayNearRatio(text) {
  const r = findRatioStatement(text);
  if (!r) return null;
  // Same text the ratio was found in, so its position lines up.
  const t = clean(text);
  const window = t.slice(Math.max(0, r.index - 900), r.index);
  let pick = null;
  for (const m of window.matchAll(/(?:median|\b(?:this|that|such)\s+(?:employee|associate|individual|person|team member))(?:[^.]|\.\d){0,400}/gi)) {
    for (const a of m[0].matchAll(AMOUNT)) {
      const pay = dollars(a[1]);
      if (!inRange(pay) || /percentile/i.test(m[0].slice(0, a.index))) continue;
      pick = { pay, at: m.index };
      break;
    }
  }
  if (!pick) return null;
  const years = yearsNear(window, pick.at - 200, pick.at + 200);
  return { pay: pick.pay, year: years.length ? Math.max(...years) : null };
}
