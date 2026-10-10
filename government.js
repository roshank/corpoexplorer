// "Government money & taxes": what the US government pays a company as a customer, through
// federal awards (USAspending.gov, gathered when the data is built), and through tax breaks (10-K).
// Everything is per $100 of revenue, like the rest of the page.

import { longDate, money, per100 } from './format.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const share = (part, whole) => (whole ? (part / whole) * 100 : 0);
const SMALL = 0.01; // rows under 1¢ per $100 are combined into one
/** $ per $100 of revenue, with "<1¢" for amounts too small to show in cents. */
export const cents = (v) => (v > 0 && v < 0.005 ? '<1¢' : per100(v));
const bar = (fraction, color) =>
  `<span class="mini"><span style="width:${Math.min(Math.max(fraction, 0), 1) * 100}%;background-color:${color}"></span></span>`;
const row = (label, sub, fraction, color, per, abs, fine = false) => `
  <li>
    <span class="label">${label}${sub ? `<span class="sub${fine ? ' fine' : ''}">${sub}</span>` : ''}</span>
    ${bar(fraction, color)}
    <span class="amt"><span class="per">${per}</span>${abs ? `<span class="abs">${abs}</span>` : ''}</span>
  </li>`;

/** Keep rows of at least 1¢ per $100; fold two or more smaller ones into a single row. */
function foldSmall(items, valueOf, rev, label) {
  const small = items.filter((i) => share(valueOf(i), rev) < SMALL);
  if (small.length < 2) return { big: items, small: null };
  return {
    big: items.filter((i) => !small.includes(i)),
    small: { label, count: small.length, value: small.reduce((s, i) => s + valueOf(i), 0) },
  };
}

/**
 * How much of every $100 came from the government: the 10-K's own figure when it has one,
 * otherwise federal money committed in USAspending. Null when neither is available.
 */
export function governmentShare(d) {
  const customer = d.government?.customer;
  if (customer) {
    return {
      per100: share(customer.value, d.totalRevenue),
      value: customer.value,
      note: `“${esc(customer.label)}” in the 10-K${customer.fromPercent ? ', from the share of revenue reported' : ''}`,
    };
  }
  if (!d.federal) return null;
  const value = d.federal.groups.reduce((s, g) => s + Math.max(g.total, 0), 0);
  return { per100: share(value, d.totalRevenue), value, note: 'federal contracts &amp; awards (USAspending.gov)' };
}

/** The card's markup. */
export function renderGovernment(d, short) {
  if (!d.government) return '';
  return `
    <div class="card gov" id="government">
      <h3 class="first">Government money &amp; taxes</h3>
      <p class="hint">What the US government paid ${esc(short)}, and what it paid back in taxes, per $100 of revenue.</p>
      ${d.federal ? renderFederal(d.federal, d, short) : ''}
      ${renderTaxes(d, short)}
    </div>`;
}

function renderTaxes(d, short) {
  const t = d.government.taxBreaks;
  const s = d.spending?.taxes;
  const rev = d.totalRevenue;
  const parts = [];

  if (s?.rate != null) {
    parts.push(
      s.rate < 0
        ? `<p class="tax-rate"><strong>${s.rate}%</strong> tax rate: a net tax <em>benefit</em> this year (credits or refunds)
            instead of tax on its profit. The federal rate is 21%.</p>`
        : `<p class="tax-rate"><strong>${s.rate}%</strong> of its pre-tax profit went to income taxes. The federal rate is 21%.</p>`,
    );
  }

  if (t && t.pretaxIncome > 0) {
    const at21 = share(t.statutoryTax, rev);
    const actual = share(t.actualTax, rev);
    const scale = Math.max(at21, actual, 0.01);
    parts.push(`
      <ul class="rows compact">
        ${row('At the 21% federal rate', 'What it would owe with no breaks', at21 / scale, 'var(--neutral-fill)', cents(at21), money(t.statutoryTax))}
        ${row('What it reported', 'Federal, state and foreign, after breaks', actual / scale, 'var(--s7)', actual < 0 ? per100(actual) : cents(actual), money(t.actualTax))}
      </ul>`);

    if (t.items.length) {
      const { big, small } = foldSmall(t.items, (i) => i.value, rev, 'Smaller breaks');
      const rows = big.map((i) =>
        row(
          esc(i.label),
          `${esc(i.note)}${i.estimated ? ' · estimated from the percentage reported' : ''}`,
          share(i.value, rev) / scale,
          'var(--s7)',
          cents(share(i.value, rev)),
          money(i.value),
        ),
      );
      if (small) rows.push(row(small.label, `${small.count} items under 1¢ each`, share(small.value, rev) / scale, 'var(--s7)', cents(share(small.value, rev)), money(small.value)));
      parts.push(`<p class="plus-head">Tax breaks that lowered the bill:</p><ul class="rows compact">${rows.join('')}</ul>`);
    }

    // What the profit line in "Where it goes" would have been without the breaks.
    const profit = d.spending?.rows.find((r) => r.kind === 'profit');
    const saved = share(t.total, rev);
    if (profit && profit.per100 > 0 && t.total > 0) {
      parts.push(`<p class="hint">Without these breaks, ${esc(short)} would have paid <strong>${cents(saved)}</strong> more per $100
        and kept <strong>${per100(Math.max(profit.per100 - saved, 0))}</strong> as profit instead of ${per100(profit.per100)}.</p>`);
    }
  }

  if (s?.cashPaid) {
    parts.push(`<p class="tile-note">Cash actually paid in taxes this year: <strong>${per100(s.cashPaid.per100)}</strong> per $100
      (${money(s.cashPaid.value)}). It often differs from the tax on paper, because some taxes are paid in other years.</p>`);
  }
  if (t && t.pretaxIncome > 0) {
    parts.push(`<p class="tile-note fine">From the tax rate reconciliation in the 10-K, on ${money(t.pretaxIncome)} of pre-tax profit.
      Companies group items differently and fold some breaks into other lines, and other items raise the bill, so the breaks
      don't add up exactly to the gap between the two tax lines.</p>`);
  }

  return parts.length ? `<h4>Taxes</h4>${parts.join('')}` : '';
}

function renderFederal(f, d, short) {
  const rev = d.totalRevenue;
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
  const { big, small } = foldSmall(groups, (g) => g.total, rev, 'Other awards');
  const max = Math.max(...groups.map((g) => g.total), 1);
  const rows = big.map((g) => {
    const top = g.agencies.slice(0, 3).map((a) => a.name);
    return row(
      esc(g.label),
      `${esc(g.note)}.${top.length ? ` Mostly ${esc(top.join(', '))}` : ''}`,
      g.total / max,
      'var(--s1)',
      cents(share(g.total, rev)),
      money(g.total),
      true,
    );
  });
  if (small) {
    rows.push(row(small.label, `${small.count} kinds of award under 1¢ each`, small.value / max, 'var(--s1)', cents(share(small.value, rev)), money(small.value)));
  }

  return `
    <h4>Federal contracts &amp; awards</h4>
    <p class="hint">Money federal agencies committed to ${esc(short)} during its fiscal year (${period}).</p>
    ${rows.length ? `<ul class="rows compact">${rows.join('')}</ul>` : `<p class="status">No federal contracts or awards found for this period.</p>`}
    <p class="tile-note fine">${who} Amounts are what agencies committed in this period, which can differ from what the company
      counted as revenue. Awards made to subsidiaries under other names may be missing.</p>`;
}
