import { displayName, longDate, money, per100, searchTickers, shortName } from './format.js';

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

let tickers = [];
fetch('/api/tickers')
  .then((r) => (r.ok ? r.json() : []))
  .then((t) => (tickers = t))
  .catch(() => {});

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
    <p class="eyebrow">${esc(ticker)} · Reading the annual report…</p>
    <div class="skeleton" style="height:32px;width:70%"></div>
    <div class="skeleton" style="height:44px;margin-top:28px"></div>
    <div class="skeleton" style="height:120px;margin-top:20px"></div>`;
  try {
    const res = await fetch(`/api/revenue/${encodeURIComponent(ticker)}`);
    const data = await res.json();
    if (id !== requestId) return;
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    renderCompany(data);
  } catch (err) {
    if (id !== requestId) return;
    result.innerHTML = `<p class="status error">${esc(err.message)}</p>`;
  }
}

/* ---------- Rendering ---------- */

function renderCompany(d) {
  const name = displayName(d.name);
  const short = shortName(d.name);
  document.title = `${short} · CorpoExplorer`;

  result.innerHTML = `
    <p class="eyebrow">${esc(d.ticker)} · Fiscal year ended ${longDate(d.fiscalYearEnd)}</p>
    <h2>For every $100 ${esc(short)} brings in…</h2>
    <p class="total">Total revenue: <strong>${money(d.totalRevenue, true)}</strong></p>
    ${
      d.views.length
        ? `<div class="tabs" role="tablist">${d.views
            .map((v, i) => `<button role="tab" data-view="${i}" aria-selected="${i === 0}">${esc(v.title)}</button>`)
            .join('')}</div>
           <div id="view"></div>`
        : `<p class="status">${esc(short)}'s filing doesn't break its revenue down in a way we can read yet.</p>`
    }
    <p class="source">Source: <a href="${esc(d.filingUrl)}" target="_blank" rel="noopener">${esc(name)} Form 10-K</a>,
      filed ${longDate(d.filingDate)}. Figures are as reported in the filing's machine-readable data.</p>`;

  if (!d.views.length) return;
  const tabs = result.querySelector('.tabs');
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tabs.querySelectorAll('button').forEach((t) => t.setAttribute('aria-selected', t === b));
    renderView(d, d.views[+b.dataset.view]);
  });
  renderView(d, d.views[0]);
}

function colorFor(item, i) {
  if (item.residual || item.folded) return 'var(--neutral-fill)';
  return `var(${SERIES[i % SERIES.length]})`;
}

function renderView(d, view) {
  const el = result.querySelector('#view');
  const items = view.items;
  const positive = items.filter((i) => i.per100 > 0);

  el.innerHTML = `
    <div class="strip" role="img" aria-label="${esc(
      items.map((i) => `${i.label} ${per100(i.per100)}`).join(', '),
    )}">
      ${positive
        .map((it) => {
          const idx = items.indexOf(it);
          return `<div class="seg${it.residual ? ' hatch' : ''}" data-i="${idx}" style="flex-grow:0;background-color:${colorFor(it, idx)}"></div>`;
        })
        .join('')}
    </div>
    <div class="scale"><span>$0</span><span>$100</span></div>
    <ul class="rows">
      ${items
        .map(
          (it, idx) => `
        <li data-i="${idx}">
          <span class="swatch${it.residual ? ' hatch' : ''}" style="background-color:${colorFor(it, idx)}"></span>
          <span class="label">${esc(it.label)}${
            it.folded ? `<span class="sub">${it.folded} smaller lines combined</span>` : ''
          }${it.residual ? `<span class="sub">Revenue the filing doesn't assign to a category</span>` : ''}</span>
          <span class="amt"><span class="per">${per100(it.per100)}</span><span class="abs">${money(it.value)}</span></span>
        </li>`,
        )
        .join('')}
    </ul>`;

  // Grow the strip in on the next frame.
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
