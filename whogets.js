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
  } else if (w?.employees && w?.medianPay && !w.outlier?.length) {
    const value = w.employees * w.medianPay;
    workers = { per100: cents((value / d.totalRevenue) * 100), value, source: 'estimate', employees: w.employees, medianPay: w.medianPay, payYear: w.payYear };
  }
  // Why there's no figure, for the page to say: no headcount, no median pay, or a bad estimate.
  let workersMissing = null;
  if (workers && (workers.per100 <= 0 || workers.per100 > costs * 0.9)) {
    workers = null;
    workersMissing = 'implausible';
  } else if (!workers) {
    // A headcount or median pay out of line with the company's other years (flagOutliers).
    workersMissing = w?.outlier?.length && !s.employees?.payLine ? 'implausible' : !w?.employees ? 'headcount' : 'medianPay';
  }

  // Governments, split between US federal, US state and local, and abroad when the filing breaks it down.
  const split = d.government?.taxSplit;
  const governments = { per100: tax, value: s.rows.find((r) => r.kind === 'tax').value };
  if (split && tax > 0 && split.total > 0 && split.us >= 0 && split.foreign >= 0) {
    governments.us = cents((tax * split.us) / split.total);
    governments.abroad = cents(tax - governments.us);
    // US federal vs state and local, when the filing breaks it out and neither is a net benefit.
    if (split.state != null && split.state >= 0 && split.federal >= 0) {
      governments.state = cents((tax * split.state) / split.total);
      governments.federal = cents(governments.us - governments.state);
    }
  }
  const t = d.government?.taxBreaks;
  if (t?.pretaxIncome > 0) governments.at21 = cents((t.statutoryTax / d.totalRevenue) * 100);

  const dividends = s.afterProfit?.dividends?.per100 ?? 0;
  const buybacks = s.afterProfit?.buybacks?.per100 ?? 0;

  return {
    other: { per100: cents(costs - (workers?.per100 ?? 0)) },
    workers,
    workersMissing,
    governments,
    owners: { per100: cents(dividends + buybacks), dividends, buybacks },
    kept: { per100: cents(profit - dividends - buybacks), profit },
  };
}

/**
 * The CEO's pay as a percentage of everything paid to workers, or null when either is unknown.
 * Uses the same workers figure as the $100 view (reported, or headcount x median pay).
 */
export function ceoShareOfWorkerPay(d, workers) {
  const ceo = d.workforce?.ceoPay;
  if (!ceo || !workers?.value || workers.value <= 0) return null;
  return (ceo / workers.value) * 100;
}

/**
 * Workers vs owners: how many times what workers were paid went out to owners (dividends +
 * buybacks). 4.6 means owners got 4.6x what workers did; 0.24 means workers got about 4x more.
 * Uses payouts rather than all profit: what's kept is reinvested, often in the business.
 * { ratio, workers, owners, estimate } in $ per 100, or null when there's no workers figure.
 */
export function ownersToWorkers(w) {
  if (!w?.workers || !(w.workers.per100 > 0)) return null;
  const owners = Math.max(w.owners.per100, 0);
  return { ratio: owners / w.workers.per100, workers: w.workers.per100, owners, estimate: w.workers.source === 'estimate' };
}
