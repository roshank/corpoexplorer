// Live check against SEC EDGAR: node scripts/smoke.js AAPL MSFT ...
import { getRevenue } from '../lib/sec.js';

const tickers = process.argv.slice(2);
for (const t of tickers.length ? tickers : ['AAPL', 'AMZN', 'GOOGL', 'MSFT', 'TSLA', 'WMT', 'KO', 'JPM', 'NVDA', 'META']) {
  try {
    const r = await getRevenue(t);
    console.log(`\n${r.ticker} · ${r.name} · FY ${r.fiscalYearEnd} · $${(r.totalRevenue / 1e9).toFixed(1)}B`);
    for (const v of r.views) {
      console.log(`  ${v.title} (${v.concept})`);
      for (const i of v.items) console.log(`    $${i.per100.toFixed(2).padStart(6)}  ${i.label}`);
    }
  } catch (e) {
    console.log(`\n${t}: ERROR ${e.message}`);
  }
}
