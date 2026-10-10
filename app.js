import { displayName, longDate, money, per100, searchTickers, shortName } from './format.js';
import { cents, governmentShare, renderGovernment } from './government.js';
import { explainRow } from './explain.js';

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
  document.body.classList.add('has-company');
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
      ${renderTopline(d, short)}

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

  if (d.spending) renderSpending(result.querySelector('#spending'), d.spending, d, short);

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

/**
 * The simplest cut of the $100, in three blocks that add up to exactly $100:
 * what it cost to run the business, what went to taxes, and what was left over.
 */
function renderTopline(d, short) {
  const s = d.spending;
  const gov = governmentShare(d);
  const govLine =
    gov && gov.value > 0
      ? `<a class="gov-line" href="#government"><strong>${cents(gov.per100)}</strong> of the $100 came from the government
          (${money(gov.value)}, ${gov.note}) →</a>`
      : '';
  if (!s) return govLine;

  const tax = s.rows.find((r) => r.kind === 'tax').per100;
  const left = s.rows.find((r) => r.kind === 'profit').per100;
  // Everything else: costs, interest, and net of any income from outside the main business.
  const costs = Math.round((100 - tax - left) * 100) / 100;
  const biggest = s.rows
    .filter((r) => r.kind === 'cost' && !r.residual && !r.folded && r.per100 > 0)
    .sort((a, b) => b.per100 - a.per100)
    .slice(0, 3);
  const rest = Math.round((costs - biggest.reduce((sum, r) => sum + r.per100, 0)) * 100) / 100;
  // When income from outside the main business outweighs the smaller costs, show it being subtracted.
  const costRows = [
    ...biggest.map((r) => [esc(r.label), r.per100]),
    ...(rest >= 0.01 ? [['Everything else', rest]] : rest <= -0.01 ? [['Minus other income', rest]] : []),
  ];

  const t = d.government?.taxBreaks;
  const at21 = t?.pretaxIncome > 0 ? (t.statutoryTax / d.totalRevenue) * 100 : null;
  const cash = s.taxes?.cashPaid?.per100;
  const taxRows = [
    ...(at21 != null ? [['At the 21% federal rate', at21]] : []),
    ...(cash != null ? [['Cash actually paid', cash]] : []),
  ];
  const list = (rows) =>
    rows.length ? `<ul class="split">${rows.map(([label, v]) => `<li><span>${label}</span><span>${per100(v)}</span></li>`).join('')}</ul>` : '';

  // What happened to what was left: dividends, buybacks, and the rest kept in the business.
  const { dividends, buybacks, investment } = s.afterProfit;
  const paid = dividends?.per100 ?? 0;
  const bought = buybacks?.per100 ?? 0;
  const kept = Math.round((left - paid - bought) * 100) / 100;
  const split =
    left > 0
      ? `<ul class="split">
          ${paid ? `<li><span>Paid to shareholders</span><span>${per100(paid)}</span></li>` : ''}
          ${bought ? `<li><span>Bought back its own stock</span><span>${per100(bought)}</span></li>` : ''}
          ${
            kept >= 0
              ? `<li><span>Kept in the business</span><span>${per100(kept)}</span></li>`
              : `<li class="over"><span>Paid out more than it earned, from savings or borrowing</span><span>${per100(-kept)}</span></li>`
          }
        </ul>`
      : `<p class="block-note">Spent more than it brought in, covered by savings or borrowing.</p>`;

  // Segments share the bar in proportion; a tax benefit or a loss has no segment.
  const grow = (v) => Math.max(v, 0);
  return `
    <div class="topline">
      <div class="topline-bar" role="img" aria-label="Costs ${per100(costs)}, taxes ${per100(tax)}, left over ${per100(left)}">
        <span style="flex-grow:${grow(costs)};background-color:var(--s1)"></span>
        <span style="flex-grow:${grow(tax)};background-color:var(--s7)"></span>
        <span style="flex-grow:${grow(left)};background-color:var(--s3)"></span>
      </div>
      <div class="blocks">
        <div class="block">
          <p class="block-head"><span class="dot" style="background-color:var(--s1)"></span>Running the business</p>
          <p class="big">${per100(costs)}</p>
          ${list(costRows)}
        </div>
        <div class="block">
          <p class="block-head"><span class="dot" style="background-color:var(--s7)"></span>Taxes</p>
          <p class="big">${per100(tax)}</p>
          ${tax < 0 ? '<p class="block-note">A net tax benefit this year (credits or refunds).</p>' : ''}
          ${list(taxRows)}
        </div>
        <div class="block">
          <p class="block-head"><span class="dot" style="background-color:var(${left >= 0 ? '--s3' : '--s8'})"></span>${left >= 0 ? 'Left over' : 'Lost'}</p>
          <p class="big">${per100(left)}</p>
          ${split}
          ${investment ? `<p class="block-note fine">Separately, it spent ${per100(investment.per100)} per $100 on buildings and equipment, paid for from its cash flow.</p>` : ''}
        </div>
      </div>
      ${govLine}
    </div>`;
}

const NEUTRAL = 'var(--neutral-fill)';
const COST_SERIES = ['--s1', '--s2', '--s4', '--s5', '--s6', '--s8'];
const BADGES = { government: 'Goes to government', employees: 'Goes to employees' };

function renderSpending(el, s, d, short) {
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
    return { ...r, color, hatch: r.residual, sub, fine: !!sub?.startsWith('In the filing:'), badge: BADGES[r.tag], more: rowDetails(r, d, short) };
  });
  renderBreakdown(el, items);
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
    <li data-i="${items.indexOf(it)}"${it.more ? ' class="expandable" tabindex="0" role="button" aria-expanded="false"' : ''}>
      <span class="swatch${it.hatch ? ' hatch' : ''}" style="background-color:${it.color}"></span>
      <span class="label">${esc(it.label)}${it.more ? '<span class="chev" aria-hidden="true">›</span>' : ''}${it.badge ? ` <span class="badge">${esc(it.badge)}</span>` : ''}${
        it.sub ? `<span class="sub${it.fine ? ' fine' : ''}">${esc(it.sub)}</span>` : ''
      }</span>
      <span class="amt"><span class="per">${sign}${per100(Math.abs(it.per100))}</span><span class="abs">${money(Math.abs(it.value))}</span></span>
      ${it.more ? `<div class="row-more" hidden>${it.more}</div>` : ''}
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
    if (!r.classList.contains('expandable')) return;
    const toggle = (e) => {
      if (e.target.closest('a, .row-more')) return; // let links and text selection work
      const open = r.getAttribute('aria-expanded') !== 'true';
      r.setAttribute('aria-expanded', open);
      r.querySelector('.row-more').hidden = !open;
    };
    r.addEventListener('click', toggle);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), toggle(e));
    });
  });
}

/** What opens under a "Where it goes" row: a general explanation and the company's own words. */
function rowDetails(r, d, short) {
  const general = explainRow(r);
  if (!general && !r.description) return null;
  return `
    ${general ? `<p>${esc(general)}</p>` : ''}
    ${
      r.description
        ? `<blockquote>${esc(r.description)}</blockquote>
           <p class="row-more-source">${esc(short)}'s own description, from its <a href="${esc(d.filingUrl)}" target="_blank" rel="noopener">10-K</a></p>`
        : ''
    }`;
}

/* ---------- URL state ---------- */

window.addEventListener('popstate', () => {
  const t = new URLSearchParams(location.search).get('t');
  if (t) go(t, false);
  else {
    result.hidden = true;
    document.body.classList.remove('has-company');
    input.value = '';
  }
});

const initial = new URLSearchParams(location.search).get('t');
if (initial) go(initial, false);
