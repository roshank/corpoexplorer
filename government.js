// "Government money": what the US government pays a company as a customer, through
// federal awards (USAspending.gov, gathered when the data is built), and through tax breaks (10-K).

import { longDate, money, per100 } from './format.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const share = (part, whole) => (whole ? (part / whole) * 100 : 0);
/** $ per $100 of revenue, with "<1¢" for amounts too small to show in cents. */
const cents = (v) => (v > 0 && v < 0.005 ? '<1¢' : per100(v));
const bar = (fraction, color) =>
  `<span class="mini"><span style="width:${Math.min(Math.max(fraction, 0), 1) * 100}%;background-color:${color}"></span></span>`;
const row = (label, sub, fraction, color, per, abs) => `
  <li>
    <span class="label">${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>
    ${bar(fraction, color)}
    <span class="amt"><span class="per">${per}</span>${abs ? `<span class="abs">${abs}</span>` : ''}</span>
  </li>`;

/** The card's markup. Everything is also shown per $100 of revenue, like the rest of the page. */
export function renderGovernment(d, short) {
  const g = d.government;
  if (!g) return '';
  return `
    <div class="card gov">
      <h3 class="first">Government money</h3>
      <p class="hint">How the US government puts money into ${esc(short)}: by buying from it, through federal awards,
        and through tax breaks that lower its tax bill. Per $100 of revenue, so it compares with the rest of the page.</p>
      ${renderSummary(d)}
      ${d.federal ? renderFederal(d.federal, d, short) : ''}
      ${renderTaxBreaks(g.taxBreaks, d, short)}
    </div>`;
}

/** Up to three headline numbers, each per $100 of revenue. */
function renderSummary(d) {
  const { customer, taxBreaks } = d.government;
  const groups = d.federal?.groups ?? [];
  const contracts = groups.find((g) => g.key === 'contracts')?.total ?? 0;
  const aid = groups.filter((g) => g.key !== 'contracts').reduce((s, g) => s + Math.max(g.total, 0), 0);
  const breaks = taxBreaks && taxBreaks.pretaxIncome > 0 ? taxBreaks.total : 0;

  const tiles = [];
  if (customer) {
    tiles.push([share(customer.value, d.totalRevenue), 'came from the government as a customer',
      `${money(customer.value)}, “${esc(customer.label)}” in the 10-K${customer.fromPercent ? ' (from the share of revenue reported)' : ''}`]);
  } else if (contracts > 0) {
    tiles.push([share(contracts, d.totalRevenue), 'in federal contracts', `${money(contracts)} committed by agencies (USAspending.gov)`]);
  }
  if (aid > 0) tiles.push([share(aid, d.totalRevenue), 'in federal grants, loans & other aid', money(aid)]);
  if (breaks > 0) tiles.push([share(breaks, d.totalRevenue), 'saved through tax breaks', `${money(breaks)} less in income tax`]);
  // Amounts under a cent per $100 stay in the details below rather than the headline.
  const shown = tiles.filter(([v]) => v >= 0.005);
  if (!shown.length) return '';

  return `
    <div class="gov-sum">
      ${shown
        .map(
          ([v, lede, note]) => `
        <div>
          <p class="big">${cents(v)}</p>
          <p class="tile-lede">of every $100 ${lede}</p>
          <p class="tile-note">${note}</p>
        </div>`,
        )
        .join('')}
    </div>`;
}

function renderTaxBreaks(t, d, short) {
  if (!t || t.pretaxIncome <= 0) return '';
  const rev = d.totalRevenue;
  const at21 = share(t.statutoryTax, rev);
  const actual = share(t.actualTax, rev);
  const scale = Math.max(at21, actual, 0.01);

  const comparison = `
    <ul class="rows compact">
      ${row('Tax at the 21% federal rate', 'What it would owe on its pre-tax profit with no breaks', at21 / scale, 'var(--neutral-fill)', cents(at21), money(t.statutoryTax))}
      ${row('Income tax it reported', 'Federal, state and foreign, after breaks', actual / scale, 'var(--s7)', cents(actual), money(t.actualTax))}
    </ul>`;

  const items = t.items.length
    ? `<p class="plus-head">These breaks lowered the bill, per $100 of revenue:</p>
       <ul class="rows compact">
        ${t.items
          .map((i) =>
            row(
              esc(i.label),
              `${esc(i.note)}${i.estimated ? ' · estimated from the percentage reported' : ''}`,
              share(i.value, rev) / scale,
              'var(--s7)',
              cents(share(i.value, rev)),
              money(i.value),
            ),
          )
          .join('')}
       </ul>`
    : `<p class="status">The filing doesn't list any tax breaks we can read.</p>`;

  // What the profit line in "Where it goes" would have been without the breaks.
  const profit = d.spending?.rows.find((r) => r.kind === 'profit');
  const saved = share(t.total, rev);
  const without =
    profit && profit.per100 > 0 && t.total > 0
      ? `<p class="hint">Without these breaks, ${esc(short)} would have paid <strong>${cents(saved)}</strong> more in tax per $100
          and kept <strong>${per100(Math.max(profit.per100 - saved, 0))}</strong> as profit instead of ${per100(profit.per100)}.</p>`
      : '';

  return `
    <h4>Tax breaks</h4>
    ${comparison}
    ${items}
    ${without}
    <p class="tile-note">From the tax rate reconciliation in the 10-K, on ${money(t.pretaxIncome)} of pre-tax profit. Companies
      group items differently and fold some breaks into other lines, and other items raise the bill, so the breaks don't
      add up exactly to the gap between the two tax lines.</p>`;
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
            <span class="amt"><span class="per">${cents(share(g.total, d.totalRevenue))}</span><span class="abs">${money(g.total)}</span></span>
          </li>`;
          })
          .join('')}
      </ul>`
    : `<p class="status">No federal contracts or awards found for this period.</p>`;
  return `
    <h4>Federal contracts &amp; awards</h4>
    <p class="hint">Money federal agencies committed to ${esc(short)} during its fiscal year (${period}), per $100 of revenue.</p>
    ${body}
    <p class="tile-note">${who} Amounts are what agencies committed in this period, which can differ from what the company
      counted as revenue. Awards made to subsidiaries under other names may be missing.</p>`;
}
