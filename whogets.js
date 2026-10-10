// Who gets the $100: the company's revenue split by who ends up with it.
//
//   other businesses + workers + governments + owners + kept by the company = $100
//
// Taxes and profit come straight from the income statement. Workers is the pay line when the
// filing reports one (banks usually do), otherwise headcount x median pay from the proxy, which
// understates the total (the average is above the median). Other businesses is the rest of the
// costs. Owners is dividends plus buybacks; kept is what's left of the profit after those, and
// is negative when a company paid out more than it earned.

const cents = (v) => Math.round(v * 100) / 100;

/** The five blocks for a company, or null when its costs couldn't be read. */
export function whoGets(d) {
  const s = d.spending;
  if (!s) return null;
  const tax = s.rows.find((r) => r.kind === 'tax').per100;
  const profit = s.rows.find((r) => r.kind === 'profit').per100;
  const costs = cents(100 - tax - profit);

  // Workers: reported pay first, then the estimate. An estimate that eats nearly all the costs
  // is more likely a bad headcount or pay figure than a fact, so we leave it out.
  let workers = null;
  const w = d.workforce;
  if (s.employees?.payLine) {
    workers = { per100: s.employees.payLine.per100, value: s.employees.payLine.value, source: 'reported' };
  } else if (w?.employees && w?.medianPay) {
    const value = w.employees * w.medianPay;
    workers = { per100: cents((value / d.totalRevenue) * 100), value, source: 'estimate', employees: w.employees, medianPay: w.medianPay };
  }
  if (workers && (workers.per100 <= 0 || workers.per100 > costs * 0.9)) workers = null;

  // Governments, split between the US and abroad when the filing breaks it down.
  const split = d.government?.taxSplit;
  const governments = { per100: tax, value: s.rows.find((r) => r.kind === 'tax').value };
  if (split && tax > 0 && split.total > 0 && split.us >= 0 && split.foreign >= 0) {
    governments.us = cents((tax * split.us) / split.total);
    governments.abroad = cents(tax - governments.us);
  }
  const t = d.government?.taxBreaks;
  if (t?.pretaxIncome > 0) governments.at21 = cents((t.statutoryTax / d.totalRevenue) * 100);

  const dividends = s.afterProfit?.dividends?.per100 ?? 0;
  const buybacks = s.afterProfit?.buybacks?.per100 ?? 0;

  return {
    other: { per100: cents(costs - (workers?.per100 ?? 0)) },
    workers,
    governments,
    owners: { per100: cents(dividends + buybacks), dividends, buybacks },
    kept: { per100: cents(profit - dividends - buybacks), profit },
  };
}
