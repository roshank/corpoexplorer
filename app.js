import { displayName, longDate, money, per100, searchTickers, shortName } from './format.js';
import { cents, governmentShare, renderGovernment } from './government.js';

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
      <div class="card-head">
        <p class="eyebrow">${esc(d.ticker)} · Fiscal year ended ${longDate(d.fiscalYearEnd)}</p>
        <button type="button" class="details-toggle" aria-pressed="${showDetails}">Show details</button>
      </div>
      <h2>For every $100 ${esc(short)} brings in…</h2>
      <p class="total">Total revenue: <strong>${money(d.totalRevenue, true)}</strong></p>
      ${renderGlance(d)}

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
      ${d.spending ? '<div id="spending"></div>' + renderAfterProfit(d.spending) : `<p class="status">We couldn't read ${esc(short)}'s costs from this filing yet.</p>`}
    </div>
    ${renderGovernment(d, short)}
    ${d.spending ? renderEmployees(d.spending) : ''}

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

  result.classList.toggle('show-details', showDetails);
  result.querySelector('.details-toggle').addEventListener('click', (e) => {
    showDetails = !showDetails;
    e.currentTarget.setAttribute('aria-pressed', showDetails);
    result.classList.toggle('show-details', showDetails);
    try {
      localStorage.setItem('showDetails', showDetails ? '1' : '');
    } catch {}
  });
}

// Filing labels, agency lists and method notes are hidden until the reader asks for them.
let showDetails = false;
try {
  showDetails = localStorage.getItem('showDetails') === '1';
} catch {}

/** The story in four numbers, each per $100 of revenue. */
function renderGlance(d) {
  const tiles = [];
  const gov = governmentShare(d);
  if (gov) {
    tiles.push(`<a class="glance-tile gov-tile" href="#government">
      <span class="big">${cents(gov.per100)}</span>
      <span class="glance-label">came from the government</span>
      <span class="glance-note">${money(gov.value)}, ${gov.note}</span></a>`);
  }
  const s = d.spending;
  if (s) {
    const costs = s.rows.filter((r) => r.kind === 'cost' || (r.kind === 'other' && r.per100 > 0)).reduce((t, r) => t + r.per100, 0);
    const tax = s.rows.find((r) => r.kind === 'tax');
    const profit = s.rows.find((r) => r.kind === 'profit');
    const at21 = d.government?.taxBreaks?.pretaxIncome > 0 ? (d.government.taxBreaks.statutoryTax / d.totalRevenue) * 100 : null;
    tiles.push(`<div class="glance-tile"><span class="big">${per100(costs)}</span><span class="glance-label">went to running the business</span></div>`);
    tiles.push(`<a class="glance-tile" href="#government"><span class="big">${per100(tax.per100)}</span>
      <span class="glance-label">${tax.per100 < 0 ? 'net tax benefit' : 'went to income taxes'}</span>
      ${at21 != null ? `<span class="glance-note">${per100(at21)} at the 21% rate</span>` : ''}</a>`);
    tiles.push(`<div class="glance-tile"><span class="big">${per100(profit.per100)}</span>
      <span class="glance-label">${profit.per100 >= 0 ? 'kept as profit' : 'lost'}</span></div>`);
  }
  return tiles.length ? `<div class="glance">${tiles.join('')}</div>` : '';
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
    return { ...r, color, hatch: r.residual, sub, fine: !!sub?.startsWith('In the filing:'), badge: BADGES[r.tag] };
  });
  renderBreakdown(el, items);
}

/** What happened to the profit, as a short list under "Where it goes". */
function renderAfterProfit(s) {
  const profit = s.rows.find((r) => r.kind === 'profit');
  const { dividends, buybacks, investment } = s.afterProfit;
  const rows = [
    ['Paid to shareholders', 'Dividends', dividends],
    ['Bought back its own stock', 'Makes each remaining share worth more', buybacks],
    ['Invested in buildings & equipment', 'Data centers, stores, factories, machines', investment],
  ].filter(([, , f]) => f);
  if (!rows.length) return '';
  const max = Math.max(Math.abs(profit.per100), ...rows.map(([, , f]) => f.per100), 1);
  const bar = (v) =>
    `<span class="mini"><span style="width:${(Math.max(v, 0) / max) * 100}%;background-color:var(--ink-2)"></span></span>`;
  return `
    <h4>What it did with the money</h4>
    <p class="hint">From the cash flow statement. This can add up to more than the ${per100(profit.per100)} profit:
      companies also spend savings or borrow.</p>
    <ul class="rows compact">
      ${rows
        .map(
          ([label, sub, f]) => `
      <li>
        <span class="label">${label}<span class="sub fine">${sub}</span></span>
        ${bar(f.per100)}
        <span class="amt"><span class="per">${per100(f.per100)}</span><span class="abs">${money(f.value)}</span></span>
      </li>`,
        )
        .join('')}
    </ul>`;
}

function renderEmployees(s) {
  const e = s.employees;
  let body;
  if (e.payLine) {
    body = `<p><strong>${per100(e.payLine.per100)}</strong> of every $100 went to employee pay and benefits.</p>`;
  } else if (e.stockPay) {
    body = `<p><strong>${per100(e.stockPay.per100)}</strong> of every $100 was paid to employees in company stock
      (${money(e.stockPay.value)}).</p>
      <p class="tile-note">US companies don't have to report total wages, so the rest of employee pay is mixed into the costs above.</p>`;
  } else {
    return '';
  }
  return `<div class="card employees"><h3 class="first">Employees</h3>${body}</div>`;
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
        it.sub ? `<span class="sub${it.fine ? ' fine' : ''}">${esc(it.sub)}</span>` : ''
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
