import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHeadcount, extractMedianPay, findMedianPay, findMedianPayNearRatio, findPayRatio, flagOutliers } from '../lib/workforce.js';

test('extractHeadcount finds the total, not subsets or other years', () => {
  assert.equal(extractHeadcount('As of December 31, 2025, we employed approximately 1,576,000 full-time and part-time employees.'), 1576000);
  assert.equal(extractHeadcount('As of December 31, 2025 and 2024, our Company had approximately 65,900 and 69,700 employees, respectively.'), 65900);
  assert.equal(
    extractHeadcount('At the end of 2025, we employed approximately 12,000 people in pharmaceutical research. At the end of 2025, we employed approximately 50,000 people.'),
    50000,
  );
  assert.equal(extractHeadcount('Our business is delivered by approximately 2.1 million associates as of January 31, 2026.'), 2100000);
  assert.equal(extractHeadcount('As of December 2025, we had headcount of 47,400, offices in over 35 countries.'), 47400);
  assert.equal(extractHeadcount('In the United States, we employed approximately 51,600 full-time persons.'), null);
  assert.equal(extractHeadcount('Over 300,000 Amazon employees around the world have participated in Career Choice.'), null);
});

test('extractMedianPay reads the pay-ratio disclosure', () => {
  assert.equal(extractMedianPay('the median of the annual total compensation of all employees (other than our CEO) was $388,200; and'), 388200);
  assert.equal(extractMedianPay('The median annual total compensation of all Caterpillar employees, other than Mr. Creed, was $89,253.'), 89253);
  assert.equal(extractMedianPay('was $ 52,838,751 for our CEO, as reported, and $177,115 for our median employee, and the ratio is 298 to 1.'), 177115);
  assert.equal(extractMedianPay('Our CEO was paid $25,000,000.'), null);
});

test('findMedianPay reports the year the pay is for', () => {
  assert.deepEqual(
    findMedianPay('the median 2025 annual total compensation of all other qualifying employees was $62,786.'),
    { pay: 62786, year: 2025 },
  );
  assert.deepEqual(findMedianPay('The median annual total compensation of all employees was $89,253.'), { pay: 89253, year: null });
});

test('findMedianPay skips base salary in favor of total pay', () => {
  assert.equal(
    findMedianPay('ratio is based on $37,989,685 for the CEO and $49,630 for the median employee. The base salary for the median employee was $48,001.').pay,
    49630,
  );
});

test('extractHeadcount reads workforce tables', () => {
  assert.equal(extractHeadcount('Total Employees ¶ 12,438 ¶ 29 ¶ % ¶ 30,013 ¶ 70 ¶ % ¶ 588 ¶ 1 ¶ % ¶ 43,039 ¶ 100 ¶ % ¶ * Includes'), 43039);
  assert.equal(
    extractHeadcount(
      "The table below presents the company's employees and related workforce at December 31, 2025. ¶ (In thousands) ¶ For the year ended December 31: ¶ 2025 ¶ IBM/wholly owned subsidiaries ¶ 264.3 ¶ Less-than-wholly owned subsidiaries ¶ 8.7 ¶ Complementary (1) ¶ 13.8 ¶",
    ),
    264300,
  );
});

test('findMedianPay reads a pay-ratio table', () => {
  assert.deepEqual(
    findMedianPay(
      'The table below discloses the 2025 annual total compensation for our CEO and median paid employee: ¶ CEO Pay Ratio: ¶ CEO Annual Total Compensation* ¶ $36,698,337 ¶ Median Employee Annual Total Compensation ¶ $125,100 ¶ CEO to Median Employee Pay Ratio ¶ 293:1',
    ),
    { pay: 125100, year: 2025 },
  );
});

test('findPayRatio reads the stated CEO pay ratio in its common forms', () => {
  assert.equal(
    findPayRatio('the 2025 annual total compensation of our median compensated employee was $139,483, and the ratio of these amounts is 533 to 1.'),
    533,
  );
  assert.equal(findPayRatio('CEO to Median Employee Pay Ratio ¶ 293:1'), 293);
  assert.equal(findPayRatio("median compensated employee was $40,206; Mr. Jassy's pay was $2,069,861, resulting in a ratio of those amounts of 1-to-51."), 51);
  assert.equal(findPayRatio('The ratio of Mr. Buffett’s pay ($389,488) to the pay of the median employee ($93,709) was 4.16 to 1.'), 4.16);
  // A "realized pay" ratio below 1 comes first in Tesla's filing; the required one follows.
  assert.equal(
    findPayRatio('Ratio of realized pay to median pay ¶ 0.00:1 ¶ The median pay was $62,786. Consequently, the applicable ratio of such amounts for 2025 was 2,522,203:1.'),
    2522203,
  );
  assert.equal(findPayRatio('We grew revenue 3 to 1 against our median peer.'), null);
});

test('findPayRatio reads "times", "-to-one" and ratios stated away from the word median', () => {
  assert.equal(findPayRatio('was $33,180,582, which was approximately 512 times the compensation of the median employee ($64,842).'), 512);
  assert.equal(findPayRatio('the median compensated employee was $66,268; our CEO’s pay was $22,892,052, and the ratio of these amounts was 345-to-one.'), 345);
  assert.equal(
    findPayRatio('Pay ratio ¶ We identified our median employee using payroll data. ' + 'x'.repeat(600) + ' For 2025, our CEO’s total compensation was $20,574,525, resulting in a ratio of 1,082:1.'),
    1082,
  );
});

test('findMedianPayNearRatio takes the median pay stated just before the ratio', () => {
  assert.deepEqual(
    findMedianPayNearRatio(
      'The fiscal year 2025 annual total compensation for our median employee, a part -time barista in the U.S., was $17,279. The ratio of our ceo’s annual total compensation to our median employee’s annual total compensation for fiscal year 2025 is 1,794 to 1.',
    ),
    { pay: 17279, year: 2025 },
  );
  assert.deepEqual(
    findMedianPayNearRatio('We estimate that the Fiscal 2025 total ¶ annual compensation for the median Team Member was ¶ $27,506 . The resulting ratio of our CEO’s pay to that of the median Team Member is 794 to 1 .'),
    { pay: 27506, year: 2025 },
  );
  assert.equal(findMedianPayNearRatio('No ratio here.'), null);
});

test('extractHeadcount reads descriptors with commas, "comprises" and "employee population"', () => {
  assert.equal(extractHeadcount('As of January 31, 2026, we employed approximately 415,000 full-time, part-time, and seasonal team members.'), 415000);
  assert.equal(extractHeadcount('As of December 31, 2025, our workforce comprises 544 professionals.'), 544);
  assert.equal(
    extractHeadcount('As of December 31, 2025, our employee population, including all full-time, part-time and temporary workers, consisted of approximately 97,100 associates.'),
    97100,
  );
});

test('findPayRatio skips ratios quoted for other companies', () => {
  assert.equal(
    findPayRatio('We consider the pay ratio specified herein to be a reasonable estimate. ¶ 61:1 ¶ CEO PAY RATIO ¶ 3x lower ¶ than the median ¶ and is 3x lower than the median ratio for S&P 500 companies (195:1)'),
    61,
  );
});

test('extractHeadcount reads other names for staff and other ways of saying it', () => {
  assert.equal(extractHeadcount('As of December 31, 2025, Amgen had approximately 31,500 staff members in over 50 countries.'), 31500);
  assert.equal(extractHeadcount('As of August 30, 2025, we employed approximately 130,000 AutoZoners, approximately 60 percent of whom were employed full-time.'), 130000);
  assert.equal(extractHeadcount('As of December 31, 2025, we employed 9,400, including part-time and temporary employees.'), 9400);
  assert.equal(extractHeadcount('As of December 31, 2025, the Company and its subsidiaries had 8,336 full time/permanent employees.'), 8336);
  assert.equal(extractHeadcount('We ended the year 2025 with 1,762 full-time employees. None of our full-time employees are represented by labor unions.'), 1762);
  assert.equal(extractHeadcount('We are a global company based in Dearborn, Michigan. With about 169,000 employees worldwide, the Company is committed to'), 169000);
  assert.equal(extractHeadcount('Our approximately 67,200 full- and part-time employees in 44 countries make an important contribution'), 67200);
  assert.equal(extractHeadcount('Medtronic has over 95,000 full-time employees, of which 43% are based in the U.S. or Puerto Rico.'), 95000);
  assert.equal(
    extractHeadcount('We are headquartered in Everett, Washington and have a workforce of more than 10,000 research and development, manufacturing, sales, distribution, service, and administrative professionals.'),
    10000,
  );
  assert.equal(extractHeadcount('Employees totaled 55,333 at December 31, 2025. This total included 53,859 full-time and 1,474 part-time employees'), 55333);
  assert.equal(extractHeadcount('• Employees ¶ Over 150,000 people are employed by the Company and in restaurants owned and operated by its subsidiaries.'), 150000);
  assert.equal(
    extractHeadcount('As of December 31, 2025 , we employed approximately ¶ 101,000 EMPLOYEES 1 ¶ across ¶ 79 COUNTRIES ¶ ~36,000 1 ¶ of whom are in the United States.'),
    101000,
  );
  assert.equal(extractHeadcount('As of December 31, 2025, we employed 28 employees, all of which are full-time.'), 28);
  assert.equal(extractHeadcount('We employ approximately 33,000 teammates.'), 33000);
});

test('extractHeadcount adds up two groups that make up the workforce', () => {
  assert.equal(extractHeadcount('At December 31, 2025, we employed approximately 88,000 (56%) hourly employees and approximately 68,000 (44%) salaried employees.'), 156000);
  assert.equal(extractHeadcount('As of December 31, 2025, we had 7,668 full-time and 70 part-time active employees (i.e., not interns, not on leave or disability).'), 7738);
});

test('extractHeadcount skips users, franchisees, last year and money', () => {
  assert.equal(
    extractHeadcount(
      'As of August 31, 2025, we had approximately 9,000 clients comprised of over 237,000 investment professionals. As of August 31, 2025, we had 35 offices in 19 countries with 12,800 employees.',
    ),
    12800,
  );
  assert.equal(extractHeadcount('Realcommercial.com.au had 2.9 million people visit each month on average. As of June 30, 2026, the Company had approximately 21,700 employees.'), 21700);
  assert.equal(
    extractHeadcount(
      'As of December 31, 2025, the Company and its subsidiaries employed approximately 49,000 persons. In addition to the persons employed by the Company and its subsidiaries, our approximately 61,000 franchise restaurants around the world are responsible for the employment of over an estimated 1 million people.',
    ),
    49000,
  );
  assert.equal(
    extractHeadcount('At November 30, 2025, we employed 12,532 individuals of whom 10,182 were involved in Homebuilding, compared to November 30, 2024, when we employed 13,265 individuals.'),
    12532,
  );
  assert.equal(
    extractHeadcount('We have letters of credit totaling $ 2.3 million supporting the reimbursement of workers’ compensation claims. As of December 31, 2025, we employed approximately 10,800 people.'),
    10800,
  );
});

test('extractHeadcount skips memberships, customers and averages over years', () => {
  assert.equal(
    extractHeadcount(
      'the Corporation employed approximately 213,000 employees. We have 11 Employee Networks with over 330,000 voluntary memberships, which provide teammates opportunities to meet new people.',
    ),
    213000,
  );
  assert.equal(
    extractHeadcount('ADP’s Workforce Management offers a range of solutions to over 160,000 employers of all sizes. As of June 30, 2026, our global team of associates consisted of approximately 67,000 persons.'),
    67000,
  );
  assert.equal(extractHeadcount('We employed an average of 29,287 employees during 2025. ¶ Total employees (average) ¶ 29,287 ¶ 30,336 ¶ 31,490 ¶ (3)'), 29287);
  assert.equal(
    extractHeadcount('As of December 31, 2025, we had approximately 44,000 full-time and 18,000 part-time employees in the U.S. and 16,000 employees internationally.'),
    78000,
  );
});

test('extractHeadcount reads workforce tables by their introduction', () => {
  assert.equal(
    extractHeadcount(
      'The following table sets forth information about the Company’s employees as of December 31, 2025. ¶ Number of Employees by Contract and Region ¶ Salaried ¶ Hourly ¶ Part-Time ¶ Total ¶ North America ¶ 8,802 ¶ 9,904 ¶ 145 ¶ 18,851 ¶ Asia-Pacific (APAC) ¶ 2,021 ¶ 884 ¶ 10 ¶ 2,915 ¶ Total ¶ 20,119 ¶ 20,679 ¶ 698 ¶ 41,496 ¶ Available Information ¶',
    ),
    41496,
  );
  assert.equal(
    extractHeadcount(
      'The following table presents our employee count and their average tenure as of December 31, 2025, and the attrition rate in 2025: ¶ Employee Count ¶ Average Tenure (in years) ¶ Attrition Rate ¶ Ameren ¶ 8,913 ¶ 13 ¶ 6% ¶ Ameren Missouri ¶ 3,767 ¶ 14 ¶ 6% ¶',
    ),
    8913,
  );
  assert.equal(
    extractHeadcount(
      'Presented in the following table are the number of employees of CMS Energy and Consumers: ¶ December 31 ¶ 2025 ¶ 2024 ¶ 2023 ¶ CMS Energy, including Consumers ¶ Full-time and part-time employees ¶ 8,350 ¶ 8,324 ¶ 8,356 ¶ Consumers ¶',
    ),
    8350,
  );
  assert.equal(
    extractHeadcount('the following key team member statistics as of the end of fiscal 2026: ¶ Total team members (hourly and salaried) ¶ 209,931 ¶ Total number of hourly team members ¶ 198,111 ¶'),
    209931,
  );
});

test('findMedianPay reads more ways of stating the median', () => {
  // The CEO's pay comes first.
  assert.equal(
    findMedianPay('The annual total compensation, determined as described in the foregoing sentences, for each of Mr. Griffith and for the median employee was $7,697,503 and $104,956, respectively.').pay,
    104956,
  );
  assert.equal(findMedianPay('For fiscal 2026, the annual total compensation for Mr. Gassner and our median employee was $470,833 and $140,473, respectively.').pay, 140473);
  // Tables, with the dollar sign in its own cell, the label over two cells, dot leaders, columns.
  assert.equal(
    findMedianPay('CEO annual total compensation* ¶ $ ¶ 33,720,446 ¶ Median employee annual total compensation ¶ $ ¶ 123,990 ¶ CEO to median employee pay ratio ¶ 272:1').pay,
    123990,
  );
  assert.equal(
    findMedianPay('Total compensation for the median employee ¶ for fiscal 2025 (not including the CEO): ¶ $ ¶ 29,017 ¶ Total compensation for the CEO: ¶ $ ¶ 9,636,414').pay,
    29017,
  );
  assert.equal(findMedianPay('Median employee’s annual total compensation . . . . . . . . . . . ¶ $186,132 ¶ Ratio of CEO to median employee').pay, 186132);
  assert.equal(
    findMedianPay(
      'Name and Principal Position ¶ Year ¶ Salary ($) ¶ Total ($) ¶ James A. Rechtin ¶ 2025 ¶ 1,348,558 ¶ 18,757,075 ¶ Median Employee ¶ 2025 ¶ 79,308 ¶ — ¶ 1,378 ¶ 2,249 ¶ 82,935 ¶ Pay Ratio ¶ 226:1',
    ).pay,
    82935,
  );
  assert.equal(
    findMedianPay(
      'CEO to Median Employee Pay Ratio ¶ President and CEO ¶ Median Employee ¶ Base Salary ¶ $ ¶ 986,580 ¶ $ ¶ 69,467 ¶ TOTAL ¶ $ ¶ 9,799,678 ¶ $ ¶ 81,203 ¶ CEO Pay to Median Employee Pay Ratio ¶ 120.7 ¶ 1',
    ).pay,
    81203,
  );
  // Other wordings.
  assert.equal(
    findMedianPay('calculated by dividing Mr. Roberts’ 2025 total compensation by $92,390, which represents the annual total compensation of our median employee.').pay,
    92390,
  );
  assert.equal(findMedianPay('Based on this methodology, CEO pay is $12.6 million, median employee pay is $189.7 thousand, and the ratio is 66:1.').pay, 189700);
  assert.equal(
    findMedianPay('the median compensated employee of our adjusted employee population employed as of October 26, 2025, other than our Interim CEO, Jeffrey M. Ettinger, was $57,789.').pay,
    57789,
  );
  assert.equal(
    findMedianPay(
      'the median of the annual total compensation of all employees of our company (other than Messrs. Bae and Nuttall, ¶ who were our Co-Chief Executive Officers as of December 31, 2025) was $210,000;',
    ).pay,
    210000,
  );
});

test('findMedianPay skips wages and reads past "U.S."', () => {
  assert.equal(
    findMedianPay(
      'we determined the "median employee" was a full-time employee located in Macao, with wages and overtime pay for the year ended December 31, 2025 in the amount of $37,948. ¶ Median Employee Annual Total Compensation ¶ $ 40,215',
    ).pay,
    40215,
  );
  assert.equal(
    findMedianPay('For 2025, we identified the median employee to be a full-time employee in the U.S. paid in U.S. Dollars whose total earnings were $98,317.').pay,
    98317,
  );
});

test('findMedianPay leaves out the proxy statement’s own year', () => {
  assert.deepEqual(
    findMedianPay(
      'HALLIBURTON ¶ 2026 Proxy Statement ¶ 87 ¶ CEO Pay Ratio ¶ For 2025, the annual total compensation of our CEO was 186 times the median of the annual total compensation of all employees, based on annual total compensation of $16,539,020 for the CEO and $88,698 for the median employee.',
    ),
    { pay: 88698, year: 2025 },
  );
});

test('findMedianPayNearRatio reads columns, "that employee" and "that associate"', () => {
  assert.equal(
    findMedianPayNearRatio('Year ¶ CEO Annual Total Compensation ¶ Median Employee Annual Total Compensation ¶ Pay Ratio ¶ 2025 ¶ $16,864,557 ¶ $149,323 ¶ 113:1').pay,
    149323,
  );
  assert.equal(
    findMedianPayNearRatio(
      'We then produced a sample of employees who were paid within a 0.5% range of that median. We determined that employee’s (Summary Compensation Table) total compensation was $55,766 for 2025. Mr. Tobin’s total compensation was $18,757,706 resulting in an estimated ratio of 336:1.',
    ).pay,
    55766,
  );
  assert.equal(
    findMedianPayNearRatio(
      'That associate received total compensation of $103,701 for the year. Accordingly, for 2025, the ratio of Mr. Miller’s compensation to the compensation of the median associate was 284 to 1.',
    ).pay,
    103701,
  );
});

test('findPayRatio reads more ways of stating the ratio', () => {
  assert.equal(findPayRatio('our CEO’s 2025 total compensation was approximately 166 times that of our median employee.'), 166);
  assert.equal(findPayRatio('Ms. Rumsey’s compensation for 2025 was 312 times the similarly calculated compensation of our median employee.'), 312);
  assert.equal(findPayRatio('the annual total compensation of our CEO was approximately 89.2 times the median of the annual total compensation of all of our employees'), 89.2);
  assert.equal(findPayRatio('The ratio of our CEO’s fiscal 2026 pay to that of our median employee (our "Pay Ratio") was approximately 296-1.'), 296);
  assert.equal(findPayRatio('the ratio of the annual total compensation of our CEO to the median employee was 592(1) to 1, or 325(2) to 1 excluding the special award.'), 592);
  assert.equal(findPayRatio('the median employee was $56,294; and the ratio of these two amounts was 592 (1) to 1, or 325 (2) to 1 excluding the award.'), 592);
  assert.equal(findPayRatio('Therefore, our estimate of CEO pay to median employee pay is 203:1.'), 203);
  assert.equal(
    findPayRatio('The ratio of the annual total compensation for our CEO compared to the median of the annual total compensation of all of our employees for 2025 is 330. We believe'),
    330,
  );
  assert.equal(
    findPayRatio('Accordingly, annual total compensation of our principal executive officer was approximately four hundred and fifty-seven times the annual total compensation of our median employee.'),
    457,
  );
  assert.equal(
    findPayRatio(
      'CEO Total Annual Compensation ¶ $6,466,193 ¶ Median Employee Total Annual Compensation ¶ $ 79,159 ¶ Ratio of CEO to Median Employee Total Annual Compensation ¶ 81.7 ¶ Charter Communications',
    ),
    81.7,
  );
  assert.equal(
    findPayRatio('CEO Pay Ratio ¶ The compensation for our CEO in 2025 was approximately 120.7:1 times the 2025 pay for our median employee.'),
    120.7,
  );
  // CEOs paid about what, or less than, the median employee is.
  assert.equal(findPayRatio('Median Employee total annual compensation ¶ $ ¶ 235,416 ¶ Ratio of Chief Executive Officer to Median Employee total annual compensation ¶ 1 to 0.97 ¶'), 1.03);
  assert.equal(findPayRatio('the median 2025 annual total compensation of all other employees was $135,696. Consequently, the applicable ratio of such amounts for 2025 was 0.3:1.'), 0.3);
  // A page number in the contents isn't the ratio.
  assert.equal(findPayRatio('Pay Versus Performance ¶ 77 ¶ CEO to Median Employee Pay Ratio ¶ 84 ¶ Code of Ethics ¶ 85'), null);
});

test('extractHeadcount reads older phrasings, not hiring goals', () => {
  assert.equal(
    extractHeadcount('As of December 31, 2021, our full-time count for our and our subsidiaries’ employees worldwide was 99,290. To date, we have not experienced any work stoppages.'),
    99290,
  );
  assert.equal(
    extractHeadcount(
      'We launched a campaign to help skill and recruit into the cybersecurity workforce 250,000 people by 2025. ¶ As of June 30, 2022, we employed approximately 221,000 people on a full-time basis.',
    ),
    221000,
  );
});

test('findMedianPay reads across a page break', () => {
  const text =
    'Mr. Musk’s 2023 annual total compensation was $0, and the median 2023 annual total compensation of all other qualifying ¶ 2024 Proxy Statement 135 ¶ TABLE OF CONTENTS ¶ employees, as determined pursuant to the methodology set forth below, was $45,811.';
  assert.equal(findMedianPay(text)?.pay, 45811);
});

test('flagOutliers leaves out a headcount or median pay far from the other years', () => {
  const ys = (key, values, totalRevenue = 1e10) => values.map((v) => ({ totalRevenue, workforce: { [key]: v } }));
  const flagged = (years) => flagOutliers(years).map((y) => (y.workforce.outlier ? y.workforce.outlier.join() : ''));
  // A misread past year (Medtronic 2024: "1,500").
  assert.deepEqual(flagged(ys('employees', [95000, 95000, 1500, 101867, 101876])), ['', '', 'employees', '', '']);
  // The latest year agrees with one other: it wins over three wrong ones (Ecolab's $180,000).
  assert.deepEqual(flagged(ys('medianPay', [53462, 50143, 180000, 180000, 170000])), ['', '', 'medianPay', 'medianPay', 'medianPay']);
  // A misread latest year, alone and far off: the other years win (ON Semiconductor: 2,400).
  assert.deepEqual(flagged(ys('employees', [2400, 26400, 30000, 31000, 30000])), ['employees', '', '', '', '']);
  // Growth by acquisition (TKO: 1,250 to 4,000) isn't a misread.
  assert.deepEqual(flagged(ys('employees', [4000, 1300, 1250])), ['', '', '']);
  // A headcount the revenue can't pay for (Principal Financial's "3 million").
  assert.deepEqual(flagged(ys('employees', [19700, 3000000, 2900000, 2700000], 1.6e10)), ['', 'employees', 'employees', 'employees']);
  // Too few years to judge.
  assert.deepEqual(flagged(ys('employees', [2400, 26400])), ['', '']);
});
