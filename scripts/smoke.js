// Live check against SEC EDGAR: node scripts/smoke.js AAPL MSFT ...
import { getCompany } from '../lib/sec.js';

const tickers = process.argv.slice(2);
for (const t of tickers.length ? tickers : ['AAPL', 'AMZN', 'GOOGL', 'MSFT', 'TSLA', 'WMT', 'KO', 'JPM', 'NVDA', 'META']) {
  try {
    const r = await getCompany(t);
    console.log(`\n${r.ticker} · ${r.name} · FY ${r.fiscalYearEnd} · $${(r.totalRevenue / 1e9).toFixed(1)}B`);
    for (const v of r.views) {
      console.log(`  ${v.title} (${v.concept})`);
      for (const i of v.items) console.log(`    $${i.per100.toFixed(2).padStart(6)}  ${i.label}`);
    }
    const s = r.spending;
    if (!s) {
      console.log('  Where it goes: (none)');
      continue;
    }
    console.log('  Where it goes');
    for (const row of s.rows) console.log(`    $${row.per100.toFixed(2).padStart(6)}  ${row.label}${row.filingLabel ? ` [${row.filingLabel}]` : ''}${row.tag ? ` <${row.tag}>` : ''}`);
    const ap = s.afterProfit;
    const f = (x) => (x ? `$${x.per100.toFixed(2)}` : '—');
    console.log(`  dividends ${f(ap.dividends)} · buybacks ${f(ap.buybacks)} · investment ${f(ap.investment)}`);
    console.log(`  tax rate ${s.taxes.rate ?? '—'}% · cash taxes ${f(s.taxes.cashPaid)} · stock pay ${f(s.employees.stockPay)}`);
    const g = r.government;
    const B = (v) => `$${(v / 1e9).toFixed(2)}B`;
    if (g.customer) console.log(`  government customer ${B(g.customer.value)} (${g.customer.label})`);
    if (g.taxBreaks) console.log(`  tax breaks ${B(g.taxBreaks.total)}: ${g.taxBreaks.items.map((i) => `${i.label} ${B(i.value)}`).join(', ')}`);
  } catch (e) {
    console.log(`\n${t}: ERROR ${e.stack}`);
  }
}
