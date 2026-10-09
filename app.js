import { displayName, longDate, money, per100, searchTickers, shortName } from './format.js';
import { renderGovernment } from './government.js';

const POPULAR = [
  ['AAPL', 'Apple'],
  ['AMZN', 'Amazon'],
  ['GOOGL', 'Alphabet'],
  ['MSFT', 'Microsoft'],
  ['NVDA', 'Nvidia'],
  ['META', 'Meta'],
  ['TSLA', 'Tesla'],
  ['WMT', 'Walmart'],
];
const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];

const $ = (sel) => document.querySelector(sel);
const form = $('#search');
const input = $('#q');
const list = $('#suggestions');
const chips = $('#chips');
const result = $('#result');
const tooltip = $('#tooltip');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ---------- Search with suggestions ---------- */

// [ticker, name, cik] for every company we have data for, built ahead of time from SEC filings.
let tickers = [];
const ready = fetch('data/companies.json')
  .then((r) => (r.ok ? r.json() : { companies: [] }))
  .then((d) => {
    tickers = d.companies;
    if (d.updated) $('#updated').textContent = `, updated ${longDate(d.updated)}`;
    return d.companies.length;
  })
  .catch(() => 0);

let matches = [];
let active = -1;

function renderSuggestions() {
  matches = searchTickers(tickers, input.value);
  active = matches.length ? 0 : -1;
  list.innerHTML = matches
    .map(
      (m, i) =>
        `<li role="option" id="opt-${i}" data-ticker="${esc(m.ticker)}" aria-selected="${i === active}">` +
        `<span class="tk">${esc(m.ticker)}</span><span class="nm">${esc(displayName(m.name))}</span></li>`,
    )
    .join('');
  const open = matches.length > 0;
  list.hidden = !open;
  input.setAttribute('aria-expanded', open);
  input.setAttribute('aria-activedescendant', open ? 'opt-0' : '');
}

function moveActive(delta) {
  if (!matches.length) return;
  active = (active + delta + matches.length) % matches.length;
  [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === active));
  input.setAttribute('aria-activedescendant', `opt-${active}`);
}

function closeSuggestions() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
}

input.addEventListener('input', renderSuggestions);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') (e.preventDefault(), moveActive(1));
  else if (e.key === 'ArrowUp') (e.preventDefault(), moveActive(-1));
  else if (e.key === 'Escape') closeSuggestions();
});
input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));
list.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) (e.preventDefault(), go(li.dataset.ticker));
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = !list.hidden && matches[active] ? matches[active].ticker : input.value.trim();
  if (pick) go(pick);
});

chips.innerHTML = POPULAR.map(([t, n]) => `<button type="button" data-ticker="${t}">${n}</button>`).join('');
chips.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) go(b.dataset.ticker);
});

/* ---------- Loading a company ---------- */

let requestId = 0;

function go(ticker, push = true) {
  ticker = ticker.toUpperCase();
  input.value = ticker;
  closeSuggestions();
  if (push) history.pushState({ ticker }, '', `?t=${encodeURIComponent(ticker)}`);
  load(ticker);
}

async function load(ticker) {
  const id = ++requestId;
  [...chips.children].forEach((b) => b.setAttribute('aria-pressed', b.dataset.ticker === ticker));
  result.hidden = false;
  result.innerHTML = `
    <div class="card">
      <p class="eyebrow">${esc(ticker)} · Reading the annual report…</p>
      <div class="skeleton" style="height:32px;width:70%"></div>
      <div class="skeleton" style="height:44px;margin-top:28px"></div>
      <div class="skeleton" style="height:120px;margin-top:20px"></div>
    </div>`;
  try {
    const count = await ready;
    const entry = tickers.find((t) => t[0] === ticker);
    if (!entry) {
      throw new Error(
        count
          ? `We don't have ${ticker} yet. For now we cover the 50 largest US companies that file a 10-K annual report.`
          : "Couldn't load the company list. Try reloading the page.",
      );
    }
    const res = await fetch(`data/c/${entry[2]}.json`);
    if (id !== requestId) return;
    if (!res.ok) throw new Error("Couldn't load this company's data. Try reloading the page.");
    const data = await res.json();
    if (id !== requestId) return;
    renderCompany(data);
  } catch (err) {
    if (id !== requestId) return;
    result.innerHTML = `<div class="card"><p class="status error">${esc(err.message)}</p></div>`;
  }
}

/* ---------- Rendering ---------- */

function renderCompany(d) {
  const name = displayName(d.name);
  const short = shortName(d.name);
  document.title = `${short} · CorpoExplorer`;

  result.innerHTML = `
    <div class="card">
      <p class="eyebrow">${esc(d.ticker)} · Fiscal year ended ${longDate(d.fiscalYearEnd)}</p>
      <h2>For every $100 ${esc(short)} brings in…</h2>
      <p class="total">Total revenue: <strong>${money(d.totalRevenue, true)}</strong></p>

      <h3>Where it comes from</h3>
      ${
        d.views.length
          ? `<div class="tabs" role="tablist">${d.views
              .map((v, i) => `<button role="tab" data-view="${i}" aria-selected="${i === 0}">${esc(v.title)}</button>`)
              .join('')}</div>
             <div id="income"></div>`
          : `<p class="status">${esc(short)}'s filing doesn't break its revenue down in a way we can read yet.</p>`
      }
    </div>

    <div class="card">
      <h3 class="first">Where it goes</h3>
      ${d.spending ? '<div id="spending"></div>' : `<p class="status">We couldn't read ${esc(short)}'s costs from this filing yet.</p>`}
    </div>
    ${d.spending ? renderAfterProfit(d.spending) + renderSpotlight(d.spending) : ''}
    ${renderGovernment(d, short)}

    <p class="source">Source: <a href="${esc(d.filingUrl)}" target="_blank" rel="noopener">${esc(name)} Form 10-K</a>,
      filed ${longDate(d.filingDate)}. Figures are as reported in the filing's machine-readable data.</p>`;

  if (d.views.length) {
    const tabs = result.querySelector('.tabs');
    const showView = (v) =>
      renderBreakdown(
        result.querySelector('#income'),
        v.items.map((it, i) => ({
          ...it,
          color: it.residual || it.folded ? NEUTRAL : `var(${SERIES[i % SERIES.length]})`,
          hatch: it.residual,
          sub: it.folded
            ? `${it.folded} smaller lines combined`
            : it.residual
              ? "Revenue the filing doesn't assign to a category"
              : null,
        })),
      );
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      tabs.querySelectorAll('button').forEach((t) => t.setAttribute('aria-selected', t === b));
      showView(d.views[+b.dataset.view]);
    });
    showView(d.views[0]);
  }

  if (d.spending) renderSpending(result.querySelector('#spending'), d.spending);
}

const NEUTRAL = 'var(--neutral-fill)';
const COST_SERIES = ['--s1', '--s2', '--s4', '--s5', '--s6', '--s8'];
const BADGES = { government: 'Goes to government', employees: 'Goes to employees' };

function renderSpending(el, s) {
  let costIndex = 0;
  const items = s.rows.map((r) => {
    let color = NEUTRAL;
    if (r.kind === 'tax') color = 'var(--s7)';
    else if (r.kind === 'profit') color = 'var(--s3)';
    else if (r.kind === 'cost' && !r.residual && !r.folded) color = `var(${COST_SERIES[costIndex++ % COST_SERIES.length]})`;

    let sub = r.filingLabel ? `In the filing: ${r.filingLabel}` : null;
    if (r.folded) sub = `${r.folded} smaller lines combined`;
    if (r.residual) sub = "Costs the filing doesn't list separately";
    if (r.kind === 'other' && r.value > 0) sub = 'Interest on debt and other items outside day-to-day business';
    if (r.kind === 'other' && r.value < 0) sub = 'Interest, investment gains and other money not from customers';
    if (r.kind === 'profit' && r.value < 0) sub = 'Spent more than it brought in, covered by savings or borrowing';
    if (r.kind === 'tax' && r.value < 0) sub = 'A net tax benefit this year (credits or refunds), not a payment';
    return { ...r, color, hatch: r.residual, sub, badge: BADGES[r.tag] };
  });
  renderBreakdown(el, items);
}

function renderAfterProfit(s) {
  const profit = s.rows.find((r) => r.kind === 'profit');
  const { dividends, buybacks, investment } = s.afterProfit;
  const rows = [
    ['Paid to shareholders', 'Dividends: cash paid to people who own the stock', dividends],
    ['Bought back its own stock', 'Fewer shares makes each remaining share worth more', buybacks],
    ['Invested in buildings & equipment', 'Data centers, stores, factories, machines', investment],
  ];
  const max = Math.max(Math.abs(profit.per100), ...rows.map(([, , f]) => (f ? f.per100 : 0)), 1);
  const bar = (v, color) =>
    `<span class="mini"><span style="width:${(Math.max(v, 0) / max) * 100}%;background-color:${color}"></span></span>`;
  return `
    <div class="card">
      <h3 class="first">What it did with the money</h3>
      <p class="hint">Also per $100 of revenue, from the cash flow statement. These can add up to more than the profit:
        companies can also spend savings or borrow.</p>
      <ul class="rows compact">
        <li>
          <span class="label">${profit.value >= 0 ? 'Profit kept this year' : 'Loss this year'}<span class="sub">From above, for comparison</span></span>
          ${bar(profit.per100, 'var(--s3)')}
          <span class="amt"><span class="per">${per100(profit.per100)}</span><span class="abs">${money(profit.value)}</span></span>
        </li>
        ${rows
          .map(
            ([label, sub, f]) => `
        <li>
          <span class="label">${label}<span class="sub">${sub}</span></span>
          ${bar(f ? f.per100 : 0, 'var(--ink-2)')}
          <span class="amt"><span class="per">${f ? per100(f.per100) : '—'}</span><span class="abs">${f ? money(f.value) : 'None reported'}</span></span>
        </li>`,
          )
          .join('')}
      </ul>
    </div>`;
}

function renderSpotlight(s) {
  const t = s.taxes;
  const tax = s.rows.find((r) => r.kind === 'tax');
  const taxTile =
    t.rate != null && t.rate < 0
      ? `<p class="big">${t.rate}%</p>
         <p class="tile-lede">It got a net tax <em>benefit</em> this year (credits or refunds) instead of owing income tax on its
           profit. The US federal rate is 21%.</p>`
      : t.rate != null
      ? `<p class="big">${t.rate}%</p>
         <p class="tile-lede">of its pre-tax profit went to income taxes. The US federal rate is 21%.</p>`
      : `<p class="big">${per100(tax.per100)}</p><p class="tile-lede">per $100 went to income taxes.</p>`;
  const cash = t.cashPaid
    ? `<p class="tile-note">Cash actually paid in taxes this year: <strong>${per100(t.cashPaid.per100)}</strong> per $100
        (${money(t.cashPaid.value)}). This often differs from the tax on paper, because some taxes are paid in other years.</p>`
    : '';

  const e = s.employees;
  let payTile;
  if (e.payLine) {
    payTile = `<p class="big">${per100(e.payLine.per100)}</p>
      <p class="tile-lede">of every $100 went to employee pay and benefits.</p>`;
  } else if (e.stockPay) {
    payTile = `<p class="big">${per100(e.stockPay.per100)}</p>
      <p class="tile-lede">of every $100 was paid to employees in company stock (${money(e.stockPay.value)}).</p>
      <p class="tile-note">US companies don't have to report how much they pay in total wages, so the rest of employee pay is
        mixed into the costs above.</p>`;
  } else {
    payTile = `<p class="big">—</p><p class="tile-lede">This filing doesn't report employee pay.</p>`;
  }

  return `
    <div class="tiles">
      <div class="card tile"><h3 class="first">Taxes</h3>${taxTile}${cash}</div>
      <div class="card tile"><h3 class="first">Employees</h3>${payTile}</div>
    </div>`;
}

/**
 * The $100 strip plus a list that doubles as legend and table.
 * Items: { label, sub?, badge?, per100, value, color, hatch? }. Negative items are money
 * that came from somewhere other than customers; they're listed separately below the strip.
 */
function renderBreakdown(el, items) {
  const out = items.filter((i) => i.per100 > 0);
  const extra = items.filter((i) => i.per100 < 0);
  const outTotal = out.reduce((s, i) => s + i.per100, 0);
  const over = outTotal > 100.005;

  const row = (it, sign = '') => `
    <li data-i="${items.indexOf(it)}">
      <span class="swatch${it.hatch ? ' hatch' : ''}" style="background-color:${it.color}"></span>
      <span class="label">${esc(it.label)}${it.badge ? ` <span class="badge">${esc(it.badge)}</span>` : ''}${
        it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''
      }</span>
      <span class="amt"><span class="per">${sign}${per100(Math.abs(it.per100))}</span><span class="abs">${money(Math.abs(it.value))}</span></span>
    </li>`;

  el.innerHTML = `
    <div class="strip-wrap">
      <div class="strip" role="img" aria-label="${esc(items.map((i) => `${i.label} ${per100(i.per100)}`).join(', '))}">
        ${out
          .map(
            (it) =>
              `<div class="seg${it.hatch ? ' hatch' : ''}" data-i="${items.indexOf(it)}" style="flex-grow:0;background-color:${it.color}"></div>`,
          )
          .join('')}
      </div>
      ${over ? `<div class="mark100" style="left:${(100 / outTotal) * 100}%"></div>` : ''}
    </div>
    <div class="scale"><span>$0</span>${over ? `<span>$${outTotal.toFixed(2)}</span>` : '<span>$100</span>'}</div>
    <ul class="rows">${out.map((it) => row(it)).join('')}</ul>
    ${
      extra.length
        ? `<p class="plus-head">Plus money that didn't come from customers${
            over ? `, which is why the bar goes past the <span class="tick">$100</span> mark` : ''
          }</p>
           <ul class="rows plus">${extra.map((it) => row(it, '+')).join('')}</ul>`
        : ''
    }`;

  requestAnimationFrame(() =>
    el.querySelectorAll('.seg').forEach((s) => (s.style.flexGrow = items[+s.dataset.i].per100)),
  );

  const rows = [...el.querySelectorAll('.rows li')];
  const highlight = (i) => {
    el.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', +s.dataset.i === i));
    rows.forEach((r) => r.classList.toggle('dim', i != null && +r.dataset.i !== i));
  };

  el.querySelectorAll('.seg').forEach((seg) => {
    const it = items[+seg.dataset.i];
    seg.addEventListener('mouseenter', () => {
      tooltip.innerHTML = `<strong>${esc(it.label)}</strong>${per100(it.per100)} of every $100 · ${money(it.value)}`;
      tooltip.hidden = false;
      highlight(+seg.dataset.i);
    });
    seg.addEventListener('mousemove', (e) => {
      const w = tooltip.offsetWidth;
      tooltip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - w - 8)}px`;
      tooltip.style.top = `${e.clientY + 16}px`;
    });
    seg.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
      highlight(null);
    });
  });
  rows.forEach((r) => {
    r.addEventListener('mouseenter', () => highlight(+r.dataset.i));
    r.addEventListener('mouseleave', () => highlight(null));
  });
}

/* ---------- URL state ---------- */

window.addEventListener('popstate', () => {
  const t = new URLSearchParams(location.search).get('t');
  if (t) go(t, false);
  else {
    result.hidden = true;
    input.value = '';
  }
});

const initial = new URLSearchParams(location.search).get('t');
if (initial) go(initial, false);
