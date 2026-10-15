import { displayName, longDate, money, per100, searchTickers, shortName } from './format.js';
import { cents, governmentShare, renderGovernment } from './government.js';
import { explainRow } from './explain.js';
import { ceoShareOfWorkerPay, ownersToWorkers, whoGets } from './whogets.js';
import { ICONS } from './icons.js';

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
let companyCount = 500;
// Typical figures per sector ({ [sector]: { ownersToWorkers } }), for context on each page.
let sectors = {};
// The data's fingerprint (written into index.html by scripts/stamp.js), so a browser fetches
// fresh data right after it changes instead of reusing a cached copy.
const DATA_VERSION = document.querySelector('meta[name="data-version"]')?.content;
const dataUrl = (path) => (DATA_VERSION ? `${path}?v=${DATA_VERSION}` : path);

const ready = fetch(dataUrl('data/companies.json'))
  .then((r) => (r.ok ? r.json() : { companies: [] }))
  .then((d) => {
    tickers = d.companies;
    sectors = d.sectors ?? {};
    if (d.updated) $('#updated').textContent = `, updated ${longDate(d.updated)}`;
    // Share classes (GOOGL/GOOG) are separate rows for the same company.
    companyCount = new Set(d.companies.map((c) => c[2])).size;
    $('#company-count').textContent = companyCount;
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

/* ---------- Top 5 lists on the home page ---------- */

// [key in data/leaders.json, title, what it counts, color, icon]
const LEADER_LISTS = [
  ['workers', 'Most to workers', 'Pay to employees', '--s4', 'workers'],
  ['owners', 'Most to owners', 'Dividends and buybacks', '--s5', 'owners'],
  ['governments', 'Most to governments', 'Income taxes', '--s7', 'governments'],
  ['fromGovernment', 'Most from the government', 'As a customer or through federal awards', '--s7', 'governments'],
  ['kept', 'Most kept to reinvest', 'Profit left after dividends and buybacks', '--s3', 'kept'],
];

fetch(dataUrl('data/leaders.json'))
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    const el = $('#leaders');
    const lists = LEADER_LISTS.filter(([key]) => data[key]?.length);
    if (!lists.length) return;
    el.innerHTML = `
      <h2 id="leaders-head">Who gets the most of every $100?</h2>
      <p class="leaders-lede">Top 5 in the S&amp;P 500 for each, per $100 of revenue in their latest annual report.</p>
      <div class="leaders-grid">
        ${lists
          .map(
            ([key, title, what, color, icon]) => `
        <div class="leader-list" style="--c:var(${color})">
          <h3><span class="who-icon">${ICONS[icon]}</span><span>${title}<span class="sub">${what}</span></span></h3>
          <ol>
            ${data[key]
              .map(
                (r) => `
            <li><button type="button" data-ticker="${esc(r.ticker)}">
              <span class="ld-name">${esc(shortName(displayName(r.name)))}<span class="ld-tk">${esc(r.ticker)}</span></span>
              <span class="ld-amt">${per100(r.per100)}${r.estimate ? '<span class="ld-est" title="At least: employees × median pay">est.</span>' : ''}</span>
              <span class="ld-bar"><span style="width:${Math.min(r.per100, 100)}%"></span></span>
            </button></li>`,
              )
              .join('')}
          </ol>
        </div>`,
          )
          .join('')}
      </div>`;
    el.hidden = false;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ticker]');
      if (!b) return;
      go(b.dataset.ticker);
      window.scrollTo({ top: 0 });
    });
  })
  .catch(() => {});

/* ---------- Loading a company ---------- */

let requestId = 0;

let shownTicker = null;

function go(ticker, push = true) {
  ticker = ticker.toUpperCase();
  shownTicker = ticker;
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
          ? `We don't have ${ticker}. We cover the ${companyCount} companies in the S&P 500 that file a US annual report (10-K).`
          : "Couldn't load the company list. Try reloading the page.",
      );
    }
    const res = await fetch(dataUrl(`data/c/${entry[2]}.json`));
    if (id !== requestId) return;
    if (!res.ok) throw new Error("Couldn't load this company's data. Try reloading the page.");
    const data = await res.json();
    if (id !== requestId) return;
    renderCompany({ ...data, sector: entry[3] ?? null });
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
      <h2>For every $100 ${esc(short)} brings in, who gets it?</h2>
      <p class="total">Total revenue: <strong>${money(d.totalRevenue, true)}</strong></p>
      ${renderWhoGets(d, short)}
    </div>

    <div class="card" id="costs">
      <h3 class="first">Where it goes, line by line</h3>
      ${d.spending ? '<div id="spending"></div>' : `<p class="status">We couldn't read ${esc(short)}'s costs from this filing yet.</p>`}
    </div>
    ${renderGovernment(d, short)}

    <div class="card">
      <h3 class="first">Where the money comes from</h3>
      ${
        d.views.length
          ? `<div class="tabs" role="tablist">${d.views
              .map((v, i) => `<button role="tab" data-view="${i}" aria-selected="${i === 0}">${esc(v.title)}</button>`)
              .join('')}</div>
             <div id="income"></div>`
          : `<p class="status">${esc(short)}'s filing doesn't break its revenue down in a way we can read yet.</p>`
      }
    </div>

    <p class="source" id="sources" tabindex="-1">Source: <a href="${esc(d.filingUrl)}" target="_blank" rel="noopener">${esc(name)} Form 10-K</a>,
      filed ${longDate(d.filingDate)}. Figures are as reported in the filing's machine-readable data.${workerNote(d)}</p>`;

  if (d.views.length) {
    const tabs = result.querySelector('.tabs');
    const showView = (v) => {
      const el = result.querySelector('#income');
      renderBreakdown(
        el,
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
      // Segments that sell to each other (a pharmacy business supplying an insurance business)
      // add up to more than total revenue; say how much was counted twice.
      if (v.betweenBusinesses) {
        el.insertAdjacentHTML(
          'beforeend',
          `<p class="hint">Shares of what the businesses brought in before removing ${money(v.betweenBusinesses)} of sales between them, which the company counts once in its total.</p>`,
        );
      }
    };
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      tabs.querySelectorAll('button').forEach((t) => t.setAttribute('aria-selected', t === b));
      showView(d.views[+b.dataset.view]);
    });
    showView(d.views[0]);
  }

  if (d.spending) renderSpending(result.querySelector('#spending'), d.spending, d, short);
  wireTimeline(result, d);

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

/** How the workers figure is estimated, for the sources note, when it is an estimate. */
function workerNote(d) {
  if (whoGets(d)?.workers?.source !== 'estimate') return '';
  const f = d.workforce.payFiling;
  const doc = f ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${f.form === 'DEF 14A' ? 'proxy statement' : '10-K amendment'}</a>` : 'proxy statement';
  return ` Pay to workers is an estimate: the number of employees in the 10-K times the median employee’s pay from the company’s ${doc},
      including stock at its value when granted. The real total is likely higher, since average pay is above the median.`;
}

/** Who gets the $100: other businesses, workers, governments, owners, and the company itself. */
function renderWhoGets(d, short) {
  const w = whoGets(d);
  const gov = governmentShare(d);
  const publicLine =
    gov && gov.value > 0
      ? `<a class="gov-line" href="#government"><strong>${cents(gov.per100)}</strong> of the $100 came from the government
          (${money(gov.value)}, ${gov.note}) →</a>`
      : '';
  if (!w) return publicLine;

  const { other, workers, workersMissing, governments: g, owners, kept } = w;
  const missingReason = {
    headcount: `${esc(short)}\u2019s filings don\u2019t say how many people it employs`,
    medianPay: `${esc(short)}\u2019s filings don\u2019t give its median employee\u2019s pay`,
    implausible: 'the employee count and median pay in its filings don\u2019t give a believable total',
  }[workersMissing];
  const amount = (v) => (v < 0 ? per100(v) : cents(v));
  const blocks = [
    {
      key: 'other',
      color: '--s1',
      label: 'Other businesses',
      value: other.per100,
      sub: `Suppliers, materials, rent, advertising, interest and other costs${
        workers ? '' : ', plus employee pay, which the filing doesn’t report separately'
      }. <a href="#costs">See every cost line ↓</a>`,
    },
    !workers && {
      key: 'workers',
      color: '--neutral-fill',
      label: 'Workers',
      value: null,
      sub: `${missingReason[0].toUpperCase()}${missingReason.slice(1)}, so we can\u2019t estimate pay. It\u2019s counted in Other businesses.`,
    },
    workers && {
      key: 'workers',
      color: '--s4',
      label: 'Workers',
      value: workers.per100,
      sub:
        workers.source === 'estimate'
          ? `About ${Math.round(workers.employees).toLocaleString('en-US')} employees × ${money(workers.medianPay)} median pay${
              workers.payYear ? ` (${workers.payYear})` : ''
            }. <a href="#sources">How we estimate this ↓</a>`
          : 'Pay and benefits, as reported in the filing.',
    },
    {
      key: 'governments',
      color: '--s7',
      label: 'Governments',
      value: g.per100,
      sub: [
        g.per100 < 0 ? 'A net tax benefit this year (credits or refunds), not a payment.' : 'Income taxes.',
        g.state != null
          ? `US federal ${cents(g.federal)} · US state & local ${cents(g.state)} · abroad ${cents(g.abroad)}.`
          : g.us != null
            ? `US ${cents(g.us)} · abroad ${cents(g.abroad)}.`
            : '',
        g.at21 != null ? `It would be ${per100(g.at21)} at the 21% federal rate. <a href="#government">See why ↓</a>` : '',
      ].join(' '),
    },
    {
      key: 'owners',
      color: '--s5',
      label: 'Paid out to owners',
      value: owners.per100,
      sub:
        owners.per100 > 0
          ? `Dividends ${per100(owners.dividends)} · buybacks ${per100(owners.buybacks)}.`
          : 'It didn\u2019t pay dividends or buy back stock this year.',
    },
    {
      key: 'kept',
      color: kept.per100 >= 0 ? '--s3' : '--s8',
      label: 'Kept by the company',
      value: kept.per100,
      sub:
        kept.profit < 0
          ? 'It lost money this year: costs and taxes were more than it brought in.'
          : kept.per100 < 0
            ? `Paid out more to owners than it earned (${per100(kept.profit)} profit), from savings or borrowing.`
            : 'Held on the owners\u2019 behalf: reinvested, used to pay down debt, or saved.',
    },
  ].filter(Boolean);

  // Grouped by who ends up with it: people, the wider economy, and the owners' side.
  // Workers first, then owners, so the two can be compared, then everyone else.
  const GROUPS = [
    { title: 'Paid to workers', note: 'Wages, benefits and stock pay for employees.', keys: ['workers'] },
    { title: 'Owners\u2019 profit', note: 'What\u2019s left after everyone else is paid. It belongs to the owners.', keys: ['owners', 'kept'] },
    {
      title: 'Spent in the wider economy',
      note: 'Paid to suppliers, landlords and lenders, and taxes to governments.',
      keys: ['other', 'governments'],
    },
  ];
  const groups = GROUPS.map((g) => ({ ...g, blocks: g.keys.map((k) => blocks.find((b) => b.key === k)).filter(Boolean) }));
  // The CEO is a worker too: how their pay compares with the typical employee's, and with all pay.
  groups.find((g) => g.keys.includes('workers')).extra = ceoPayRow(d, workers);
  // Its own section after Owners' profit: who got more, workers or owners.
  groups.find((g) => g.keys.includes('owners')).after = versusSection(d, w);
  blocks.splice(0, blocks.length, ...groups.flatMap((g) => g.blocks));

  const positive = blocks.filter((b) => b.value > 0);
  const shown = (b) => (b.value == null ? '<span class="not-reported">Not reported</span>' : amount(b.value));
  return `
    <div class="whogets">
      <div class="topline-bar" role="img" aria-label="${esc(blocks.filter((b) => b.value != null).map((b) => `${b.label} ${per100(b.value)}`).join(', '))}">
        ${positive.map((b) => `<span style="flex-grow:${b.value};background-color:var(${b.color})"></span>`).join('')}
      </div>
      <div class="topline-scale" aria-hidden="true"><span>$0</span><span>$100</span></div>
      ${groups
        .map((g) => {
          const known = g.blocks.filter((b) => b.value != null);
          const total = g.blocks.length > 1 && known.length ? amount(known.reduce((sum, b) => sum + b.value, 0)) : '';
          return `
      <div class="who-group">
        <h3 class="who-group-head"><span>${g.title}</span><span class="who-group-total">${total}</span></h3>
        <p class="who-group-note">${g.note}</p>
        <ul class="rows who-rows">
          ${g.blocks
            .map(
              (b) => `
          <li>
            <span class="who-icon" style="--c:var(${b.color})">${ICONS[b.key]}</span>
            <span class="label">${b.label}<span class="sub">${b.sub}</span></span>
            <span class="amt"><span class="per">${shown(b)}</span></span>
          </li>`,
            )
            .join('')}
          ${g.extra ?? ''}
        </ul>
      </div>${g.after ?? ''}`;
        })
        .join('')}
      ${publicLine}
    </div>`;
}

/** 0.22×, 4.1×, 36× */
const times = (r) => (r < 1 ? r.toFixed(2) : r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US'));

/** "FY2024": the year the fiscal year ends in, as companies name it (Walmart's ends in January). */
const fyLabel = (date) => `FY${date.slice(0, 4)}`;

/** Who got more, in a sentence. */
function versusSays(r) {
  if (r.owners === 0) return 'Owners got no payouts this year: no dividends or buybacks.';
  if (r.ratio >= 1.05) return `Owners got ${times(r.ratio)} times what workers got.`;
  if (r.ratio > 1 / 1.05) return 'Workers and owners got about the same.';
  return `Workers got ${times(1 / r.ratio)} times what owners got.`;
}

/**
 * Workers vs owners for each year we have, oldest first: { fy, r } with r from ownersToWorkers(),
 * null for a year without a workers figure. The last one is the latest 10-K.
 */
function versusYears(d) {
  return [d, ...(d.history ?? [])]
    .map((y) => ({ fy: fyLabel(y.fiscalYearEnd), r: ownersToWorkers(whoGets(y)) }))
    .reverse();
}

/**
 * Workers vs owners, who gets more: what went to owners as a multiple of what went to workers
 * (10x, 50x), with both amounts as bars and the sector's typical figure. With earlier years, a
 * chart of both over time picks the year the scale shows, and play steps through them.
 */
function versusSection(d, w) {
  const r = ownersToWorkers(w);
  if (!r) return '';
  const est = r.estimate ? ' (est.)' : '';
  const says = versusSays(r);
  const typical = sectors[d.sector]?.ownersToWorkers;
  const context = typical != null ? ` Typical in ${esc(d.sector)}: owners get ${times(typical)}× what workers get.` : '';
  const years = versusYears(d);
  const known = years.filter((y) => y.r);
  return `
    <section class="vs" aria-label="Workers vs owners">
      <h3 class="vs-head">Workers vs owners <span>Who gets more?</span></h3>
      ${known.length > 1 ? `<p class="vs-year" aria-live="polite">${years.at(-1).fy}</p>` : ''}
      ${scale(r, est, says)}
      <p class="vs-says">${says}</p>
      ${known.length > 1 ? timeline(years) : ''}
      <p class="vs-note">Of every $100: pay to workers vs money paid out to owners as dividends and buybacks.${context}</p>
    </section>`;
}

// The scale's geometry. The beam and pans are drawn level and tipped with CSS transforms, so a
// change of year animates.
const SC = { W: 340, cx: 170, top: 68, arm: 118, drop: 62, maxDeg: 20 };

/** How the scale tips for r: degrees (positive when owners got more, growing with the log of the ratio) and the badge's words. */
function tilt(r) {
  const sign = r.owners === 0 ? -1 : Math.sign(Math.log(r.ratio));
  // Full tilt at 64x, so the years of a company that pays owners far more still differ.
  const size = r.owners === 0 ? 1 : Math.min(Math.abs(Math.log2(r.ratio)) / 6, 1);
  const even = r.owners > 0 && Math.abs(Math.log(r.ratio)) < Math.log(1.05);
  const deg = even ? 0 : sign * (4 + (SC.maxDeg - 4) * size);
  const badge = even
    ? 'About even'
    : r.owners === 0
      ? 'All to workers'
      : `${sign > 0 ? 'Owners' : 'Workers'} get ${times(Math.max(r.ratio, 1 / r.ratio))}× more`;
  return { deg, badge };
}

/** Where a pan hangs when the beam is at `deg`, relative to where it hangs when level. */
function panShift(side, deg) {
  const rad = (deg * Math.PI) / 180;
  return `translate(${side * SC.arm * (Math.cos(rad) - 1)}px, ${side * SC.arm * Math.sin(rad)}px)`;
}

/**
 * A balance scale with workers on the left pan and owners on the right. The beam tips toward
 * whoever got more, further the bigger the gap, and a badge over the pivot says by how much.
 */
function scale(r, est, says) {
  const { W, cx, top, arm, drop } = SC;
  const { deg, badge } = tilt(r);
  // Tall enough for the steepest tilt, so the layout doesn't jump between years.
  const H = Math.ceil(top + arm * Math.sin((SC.maxDeg * Math.PI) / 180) + drop + 60);
  const pan = (side, cls, color, icon, amount, label) => {
    const x = cx + side * arm;
    const y = top;
    return `
      <g class="sc-pan ${cls}" style="transform:${panShift(side, deg)}">
        <line x1="${x - 26}" y1="${y + drop}" x2="${x}" y2="${y}" class="sc-string"/>
        <line x1="${x + 26}" y1="${y + drop}" x2="${x}" y2="${y}" class="sc-string"/>
        <path d="M${x - 34} ${y + drop} h68 a34 12 0 0 1 -68 0z" fill="var(${color})" opacity="0.9"/>
        <circle cx="${x}" cy="${y + drop - 22}" r="20" fill="var(--surface)" stroke="var(${color})" stroke-width="2"/>
        <g transform="translate(${x - 13} ${y + drop - 35})" style="color:var(${color})">${icon}</g>
        <text x="${x}" y="${y + drop + 34}" class="sc-amt">${amount}</text>
        <text x="${x}" y="${y + drop + 52}" class="sc-label">${label}</text>
      </g>`;
  };
  const bw = badge.length * 8.2 + 24;
  return `
      <svg class="sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(says)}">
        <path d="M${cx - 40} ${H - 6} h80" class="sc-post"/>
        <line x1="${cx}" y1="${top}" x2="${cx}" y2="${H - 6}" class="sc-post"/>
        <line x1="${cx - arm}" y1="${top}" x2="${cx + arm}" y2="${top}" class="sc-beam"
          style="transform-origin:${cx}px ${top}px;transform:rotate(${deg}deg)"/>
        <circle cx="${cx}" cy="${top}" r="6" class="sc-pivot"/>
        ${pan(-1, 'sc-workers', '--s4', ICONS.workers, per100(r.workers), `Workers${est}`)}
        ${pan(1, 'sc-owners', '--s5', ICONS.owners, per100(r.owners), 'Owners')}
        <g class="sc-badge"><rect x="${cx - bw / 2}" y="4" width="${bw}" height="28" rx="14"/><text x="${cx}" y="23">${badge}</text></g>
      </svg>`;
}

/** Point an already drawn scale at another year's figures. */
function setScale(svg, r, says) {
  const { cx } = SC;
  const { deg, badge } = tilt(r);
  svg.querySelector('.sc-beam').style.transform = `rotate(${deg}deg)`;
  svg.querySelector('.sc-workers').style.transform = panShift(-1, deg);
  svg.querySelector('.sc-owners').style.transform = panShift(1, deg);
  svg.querySelector('.sc-workers .sc-amt').textContent = per100(r.workers);
  svg.querySelector('.sc-workers .sc-label').textContent = `Workers${r.estimate ? ' (est.)' : ''}`;
  svg.querySelector('.sc-owners .sc-amt').textContent = per100(r.owners);
  const bw = badge.length * 8.2 + 24;
  const rect = svg.querySelector('.sc-badge rect');
  rect.setAttribute('x', cx - bw / 2);
  rect.setAttribute('width', bw);
  svg.querySelector('.sc-badge text').textContent = badge;
  svg.setAttribute('aria-label', says);
}

/**
 * Workers' and owners' $ per 100 over the years, as two lines on one axis, with a button per
 * year underneath that sets the scale. Years without a workers figure have a gap.
 */
function timeline(years) {
  const W = 340;
  const H = 128;
  const pad = { l: 34, r: 62, t: 12, b: 8 };
  const n = years.length;
  const x = (i) => pad.l + (n === 1 ? 0 : (i * (W - pad.l - pad.r)) / (n - 1));
  const max = Math.max(...years.flatMap((y) => (y.r ? [y.r.workers, y.r.owners] : [])), 1);
  const top = max <= 10 ? Math.ceil(max) : max <= 50 ? Math.ceil(max / 5) * 5 : Math.ceil(max / 10) * 10;
  const y = (v) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  // A line through each run of years that have figures.
  const line = (key) => {
    let d = '';
    let pen = 'M';
    years.forEach((yr, i) => {
      if (!yr.r) return void (pen = 'M');
      d += `${pen}${x(i).toFixed(1)} ${y(yr.r[key]).toFixed(1)}`;
      pen = 'L';
    });
    return d;
  };
  const dots = (key, color) =>
    years
      .map((yr, i) => (yr.r ? `<circle cx="${x(i)}" cy="${y(yr.r[key])}" r="4" fill="var(${color})" class="tl-dot" data-i="${i}"/>` : ''))
      .join('');
  // Direct labels at the right end, nudged apart when the lines end close together.
  const last = [...years].reverse().find((yr) => yr.r).r;
  let ly = { workers: y(last.workers), owners: y(last.owners) };
  if (Math.abs(ly.workers - ly.owners) < 14) {
    const mid = (ly.workers + ly.owners) / 2;
    const up = last.owners >= last.workers ? 'owners' : 'workers';
    ly = { [up]: mid - 7, [up === 'owners' ? 'workers' : 'owners']: mid + 7 };
  }
  const endX = x(n - 1) + 10;
  return `
      <div class="tl">
        <div class="tl-head">
          <span class="tl-title">Of every $100, over ${n} years</span>
          <button type="button" class="tl-play" aria-label="Play ${n} years">${PLAY}</button>
        </div>
        <svg class="tl-chart" viewBox="0 0 ${W} ${H}" role="img"
          aria-label="${esc(years.map((yr) => (yr.r ? `${yr.fy}: workers ${per100(yr.r.workers)}, owners ${per100(yr.r.owners)}` : `${yr.fy}: no workers figure`)).join('; '))}">
          <line x1="${pad.l}" x2="${x(n - 1)}" y1="${y(0)}" y2="${y(0)}" class="tl-base"/>
          <line x1="${pad.l}" x2="${x(n - 1)}" y1="${y(top)}" y2="${y(top)}" class="tl-grid"/>
          <text x="${pad.l - 6}" y="${y(0) + 4}" class="tl-axis">$0</text>
          <text x="${pad.l - 6}" y="${y(top) + 4}" class="tl-axis">$${top}</text>
          <line class="tl-now" x1="${x(n - 1)}" x2="${x(n - 1)}" y1="${pad.t - 6}" y2="${y(0)}"/>
          <path d="${line('workers')}" class="tl-line" stroke="var(--s4)"/>
          <path d="${line('owners')}" class="tl-line" stroke="var(--s5)"/>
          ${dots('workers', '--s4')}${dots('owners', '--s5')}
          <text x="${endX}" y="${ly.workers + 4}" class="tl-label">Workers</text>
          <text x="${endX}" y="${ly.owners + 4}" class="tl-label">Owners</text>
          ${years.map((yr, i) => `<rect class="tl-hit" data-i="${i}" x="${x(i) - 22}" y="0" width="44" height="${H}"/>`).join('')}
        </svg>
        <div class="tl-years" role="group" aria-label="Show year">
          ${years
            .map(
              (yr, i) =>
                `<button type="button" data-i="${i}" style="left:${((x(i) / W) * 100).toFixed(2)}%" aria-pressed="${i === n - 1}"${yr.r ? '' : ' disabled title="No workers figure for this year"'}>${yr.fy}</button>`,
            )
            .join('')}
        </div>
      </div>`;
}

const PLAY = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>';

// The workers vs owners play timer, stopped when another company is shown.
let timer = null;

/** The year buttons, chart hover and play button of the workers vs owners section. */
function wireTimeline(root, d) {
  clearInterval(timer);
  timer = null;
  const tl = root.querySelector('.tl');
  if (!tl) return;
  const years = versusYears(d);
  const svg = root.querySelector('.vs .sc');
  const sayEl = root.querySelector('.vs-says');
  const yearEl = root.querySelector('.vs-year');
  const play = tl.querySelector('.tl-play');
  const chart = tl.querySelector('.tl-chart');
  const xOf = (i) => tl.querySelector(`.tl-hit[data-i="${i}"]`);

  const show = (i) => {
    const { r, fy } = years[i];
    if (!r) return;
    const says = versusSays(r);
    setScale(svg, r, says);
    sayEl.textContent = says;
    yearEl.textContent = fy;
    tl.querySelectorAll('.tl-years button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.i === i));
    tl.querySelectorAll('.tl-dot').forEach((c) => c.classList.toggle('on', +c.dataset.i === i));
    const hit = xOf(i);
    const cx = +hit.getAttribute('x') + 22;
    const now = chart.querySelector('.tl-now');
    now.setAttribute('x1', cx);
    now.setAttribute('x2', cx);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    play.innerHTML = PLAY;
    play.setAttribute('aria-label', `Play ${years.length} years`);
  };
  show(years.length - 1);

  tl.querySelector('.tl-years').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    stop();
    show(+b.dataset.i);
  });
  chart.addEventListener('click', (e) => {
    const hit = e.target.closest('.tl-hit');
    if (!hit) return;
    stop();
    show(+hit.dataset.i);
  });
  chart.querySelectorAll('.tl-hit').forEach((hit) => {
    const yr = years[+hit.dataset.i];
    hit.addEventListener('mouseenter', () => {
      tooltip.innerHTML = yr.r
        ? `<strong>${yr.fy}</strong>Workers${yr.r.estimate ? ' (est.)' : ''} ${per100(yr.r.workers)} · Owners ${per100(yr.r.owners)}<br>${esc(versusSays(yr.r))}`
        : `<strong>${yr.fy}</strong>No workers figure in this year's filings`;
      tooltip.hidden = false;
    });
    hit.addEventListener('mousemove', (e) => {
      const w = tooltip.offsetWidth;
      tooltip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - w - 8)}px`;
      tooltip.style.top = `${e.clientY + 16}px`;
    });
    hit.addEventListener('mouseleave', () => (tooltip.hidden = true));
  });
  play.addEventListener('click', () => {
    if (timer) return stop();
    const steps = years.map((_, i) => i).filter((i) => years[i].r);
    let k = 0;
    show(steps[k]);
    play.innerHTML = PAUSE;
    play.setAttribute('aria-label', 'Pause');
    timer = setInterval(() => {
      if (++k >= steps.length) return stop();
      show(steps[k]);
    }, 1200);
  });
}

/** The CEO pay multiplier: CEO pay as a multiple of the median employee's, from the proxy. */
function ceoPayRow(d, workers) {
  const w = d.workforce;
  if (!w?.ceoRatio || !w.medianPay) return '';
  const r = w.ceoRatio;
  // A few CEOs take almost nothing (Block's was $2.75): below 0.1× the median, say so.
  const times = r < 0.1 ? '<0.1' : r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString('en-US');
  // Tesla's 2,522,203× doesn't fit the amount column on a phone: 2.5M×.
  const short = r >= 100_000 ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(r) : times;
  const year = w.payYear ? ` (${w.payYear})` : '';
  const source = w.payFiling ? ` · <a href="${esc(w.payFiling.url)}" target="_blank" rel="noopener">Source</a>` : '';
  // How much of all pay to workers went to this one person.
  const pct = ceoShareOfWorkerPay(d, workers);
  const est = workers?.source === 'estimate' ? ' (est.)' : '';
  let share = '';
  if (pct != null && pct >= 100) share = ` · ${Math.floor(pct / 100)}× all other worker pay${est}`;
  else if (pct != null) share = ` · ${pct < 0.01 ? '<0.01' : pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}% of all worker pay${est}`;
  // Pay this large is almost always a multi-year stock award counted in full the year it's granted.
  const upfront = w.ceoPay >= 200e6 ? ' · Mostly a multi-year stock award, valued up front' : '';
  return `
          <li class="who-stat">
            <span class="who-icon" style="--c:var(--s4)">${ICONS.ceo}</span>
            <span class="label">CEO pay multiplier<span class="sub">${money(w.ceoPay)} vs ${money(w.medianPay)} for the typical
              employee${year}${share}${upfront}${source}</span></span>
            <span class="amt"><span class="per">${short}×</span></span>
          </li>`;
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

// Links to another section ("See why ↓") scroll there instead of changing the URL.
result.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  const target = link && document.getElementById(link.getAttribute('href').slice(1));
  if (!target) return;
  e.preventDefault();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});

window.addEventListener('popstate', () => {
  const t = new URLSearchParams(location.search).get('t');
  // Only a different company needs loading; a change to just the #fragment doesn't.
  if (t && t.toUpperCase() === shownTicker) return;
  if (t) go(t, false);
  else {
    shownTicker = null;
    result.hidden = true;
    document.body.classList.remove('has-company');
    input.value = '';
  }
});

const initial = new URLSearchParams(location.search).get('t');
if (initial) go(initial, false);
