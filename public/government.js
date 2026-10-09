// "Government money": what the US government pays a company as a customer, through
// federal awards (USAspending.gov, loaded separately), and through tax breaks (10-K).

import { longDate, money, per100 } from './format.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 10000) / 100 : 0);
const perHundred = (v) => (v > 0 && v < 0.01 ? 'less than 1¢ per $100' : `${per100(v)} per $100`);
const bar = (share, color) =>
  `<span class="mini"><span style="width:${Math.min(Math.max(share, 0), 1) * 100}%;background-color:${color}"></span></span>`;

/** The card's markup. Federal awards fill `#federal` afterwards via loadFederal(). */
export function renderGovernment(d, short) {
  const g = d.government;
  if (!g) return '';
  return `
    <div class="card gov">
      <h3 class="first">Government money</h3>
      <p class="hint">How the US government puts money into ${esc(short)}: by buying from it, through federal awards,
        and through tax breaks that lower its tax bill.</p>
      ${renderCustomer(g.customer, d, short)}
      <h4>Federal contracts &amp; awards</h4>
      <div id="federal">
        <div class="skeleton" style="height:20px;width:60%"></div>
        <div class="skeleton" style="height:56px;margin-top:12px"></div>
      </div>
      ${renderTaxBreaks(g.taxBreaks, short)}
    </div>`;
}

function renderCustomer(c, d, short) {
  if (!c) return '';
  const share = pct(c.value, d.totalRevenue);
  return `
    <div class="gov-stat">
      <p class="big">${per100(share)}</p>
      <p class="tile-lede">of every $100 ${esc(short)} brought in came from the government as a customer
        (${money(c.value)}, <span class="filing-label">“${esc(c.label)}” in the 10-K</span>).</p>
      ${c.fromPercent ? '<p class="tile-note">Worked out from the share of revenue the filing reports.</p>' : ''}
    </div>`;
}

function renderTaxBreaks(t, short) {
  if (!t || t.pretaxIncome <= 0) return '';
  const rows = t.items.length
    ? `<ul class="rows compact">
        ${t.items
          .map(
            (i) => `
          <li>
            <span class="label">${esc(i.label)}<span class="sub">${esc(i.note)}${i.estimated ? ' · estimated from the percentage reported' : ''}</span></span>
            ${bar(i.value / t.statutoryTax, 'var(--s7)')}
            <span class="amt"><span class="per">${money(i.value)}</span></span>
          </li>`,
          )
          .join('')}
      </ul>`
    : `<p class="status">The filing doesn't list any tax breaks we can read.</p>`;
  return `
    <h4>Tax breaks</h4>
    <p class="hint">At the 21% federal rate, ${esc(short)} would have owed <strong>${money(t.statutoryTax)}</strong>
      on ${money(t.pretaxIncome)} of pre-tax profit. It reported <strong>${money(t.actualTax)}</strong> in income tax.
      These items lowered the bill:</p>
    ${rows}
    <p class="tile-note">From the tax rate reconciliation in the 10-K. Companies group items differently and some of their
      breaks are folded into other lines, so this list isn't complete. Bars are relative to the tax owed at 21%.</p>`;
}

/** Fetch federal awards for the company and fill the `#federal` placeholder. */
export async function loadFederal(el, d, short) {
  if (!el) return;
  try {
    const res = await fetch(`/api/company/${encodeURIComponent(d.ticker)}/federal`);
    const f = await res.json();
    if (!el.isConnected) return;
    if (!res.ok) throw new Error(f.error || 'Something went wrong.');
    el.innerHTML = renderFederal(f, d, short);
  } catch (err) {
    if (el.isConnected) el.innerHTML = `<p class="status">${esc(err.message)}</p>`;
  }
}

function renderFederal(f, d, short) {
  const period = `${longDate(f.period.start)} – ${longDate(f.period.end)}`;
  // The same company often has several records under one name; link the largest of each.
  const byName = new Map();
  for (const r of f.recipients) if (!byName.has(r.name)) byName.set(r.name, r);
  const who = f.recipients.length
    ? `Matched in USAspending.gov as ${[...byName.values()]
        .map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`)
        .join(', ')}${f.recipients.length > byName.size ? ` (${f.recipients.length} records)` : ''}.`
    : `We couldn't find ${esc(short)} in USAspending.gov under its own name.`;
  const groups = f.groups.filter((g) => g.total > 0);
  const max = Math.max(...groups.map((g) => g.total), 1);
  const body = groups.length
    ? `<ul class="rows compact">
        ${groups
          .map((g) => {
            const top = g.agencies.slice(0, 3).map((a) => a.name);
            const sub = top.length ? `Mostly ${top.join(', ')}` : g.note;
            return `
          <li>
            <span class="label">${esc(g.label)}<span class="sub">${esc(g.note)}. ${esc(sub)}</span></span>
            ${bar(g.total / max, 'var(--s1)')}
            <span class="amt"><span class="per">${money(g.total)}</span><span class="abs">${perHundred(pct(g.total, d.totalRevenue))}</span></span>
          </li>`;
          })
          .join('')}
      </ul>`
    : `<p class="status">No federal contracts or awards found for this period.</p>`;
  return `
    <p class="hint">Money federal agencies committed to ${esc(short)} during its fiscal year (${period}).</p>
    ${body}
    <p class="tile-note">${who} Amounts are what agencies committed in this period, which can differ from what the company
      counted as revenue. Awards made to subsidiaries under other names may be missing.</p>`;
}
