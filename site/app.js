import { toICS } from './ics.js';

const TZ = 'Europe/Prague';
const SYNC_UTC_HOURS = [5, 9, 13, 17]; // musí odpovídat cronu v .github/workflows/sync.yml
const REGIONS = [
  ['all', 'Vše'],
  ['praha', 'Praha'],
  ['cz', 'Další města'],
  ['online', 'Online'],
];
const IMP = { top: 'Top', high: 'Důležité', maybe: 'Možná', hide: 'Skrýt' };
const STATUS = { go: 'Jdu', maybe: 'Zvažuji', no: 'Nejdu' };
const FILTERS = { new: 'Nové', marked: 'Označené', mine: 'Jdu / zvažuji', free: 'Zdarma', past: 'Proběhlé', hidden: 'Skryté' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const fmt = (o) => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, ...o });
const keyOf = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ });
const keyDate = (k) => new Date(k + 'T12:00:00Z'); // poledne UTC = stejný den i v Praze
const addDays = (k, n) => new Date(keyDate(k).getTime() + n * 864e5).toISOString().slice(0, 10);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* soukromé okno: appka funguje dál, jen si nic nepamatuje */
    }
  },
};

// ---------- stav ----------

let data = { events: [], sources: [], updatedAt: null };
let user = store.get('mr.user', {});
let todayKey = keyOf(new Date());
const state = { q: '', region: 'all', city: null, view: 'list', f: new Set(), month: todayKey.slice(0, 7), day: null };

// „Nové“ = přibylo od minulé návštěvy. Návštěva se posune nejdřív po hodině, aby odznaky nezmizely po reloadu.
const visit = store.get('mr.visit', null) || { prev: Date.now(), cur: Date.now() };
if (Date.now() - visit.cur > 3600e3) {
  visit.prev = visit.cur;
  visit.cur = Date.now();
}
store.set('mr.visit', visit);

const u = (id) => user[id] || {};
function setUser(id, patch) {
  const next = { ...u(id), ...patch };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (Object.keys(next).length) user[id] = next;
  else delete user[id];
  store.set('mr.user', user);
}

const upcoming = (e) => e._ke >= todayKey;
const isNew = (e) => upcoming(e) && Date.parse(e.firstSeen) > visit.prev;

function prepare(raw) {
  for (const e of raw.events) {
    e._k = e.allDay ? e.start.slice(0, 10) : keyOf(new Date(e.start));
    e._ke = e.end ? (e.allDay ? e.end.slice(0, 10) : keyOf(new Date(e.end))) : e._k;
    if (e._ke < e._k) e._ke = e._k;
    e._ts = e.allDay ? keyDate(e._k).getTime() - 12 * 3600e3 : Date.parse(e.start);
    e._text = norm([e.title, e.description, e.venue, e.address, e.city, e.organizer, e.type, e.source, e.online ? 'online' : ''].join(' '));
  }
  raw.events.sort((a, b) => a._ts - b._ts);
  return raw;
}

function matches(e, { ignoreRegion = false, ignorePast = false } = {}) {
  const me = u(e.id);
  if (!ignoreRegion) {
    if (state.region !== 'all' && e.region !== state.region) return false;
    if (state.region === 'cz' && state.city && e.city !== state.city) return false;
  }
  if ((me.imp === 'hide') !== state.f.has('hidden')) return false;
  if (!ignorePast && upcoming(e) === state.f.has('past')) return false;
  if (state.f.has('new') && !isNew(e)) return false;
  if (state.f.has('marked') && !['top', 'high', 'maybe'].includes(me.imp)) return false;
  if (state.f.has('mine') && !['go', 'maybe'].includes(me.status)) return false;
  if (state.f.has('free') && !e.price?.free) return false;
  if (state.q) {
    const hay = e._text + ' ' + norm(me.note);
    for (const t of norm(state.q).split(/\s+/)) if (t && !hay.includes(t)) return false;
  }
  return true;
}

// ---------- formátování ----------

const timeOf = (e) => (e.allDay ? 'celý den' : fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(e.start)));
function whenLong(e) {
  const d = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(keyDate(e._k));
  const multi = e._ke !== e._k ? ` – ${fmt({ day: 'numeric', month: 'long' }).format(keyDate(e._ke))}` : '';
  return e.allDay ? d + multi : `${d}${multi}, ${timeOf(e)}`;
}
const whereOf = (e) => (e.online ? 'Online' : [e.city, e.venue].filter(Boolean).join(' · ') || 'Místo neuvedeno');
const daysTo = (k) => Math.round((keyDate(k) - keyDate(todayKey)) / 864e5);

function badges(e) {
  const me = u(e.id);
  const out = [];
  if (isNew(e)) out.push('<span class="b new">Nové</span>');
  if (me.imp) out.push(`<span class="b inv">${esc(me.imp === 'hide' ? 'Skryto' : IMP[me.imp])}</span>`);
  if (me.status) out.push(`<span class="b info">${esc(STATUS[me.status])}</span>`);
  out.push(`<span class="b">${esc(e.type)}</span>`);
  if (e.hybrid) out.push('<span class="b">Hybrid</span>');
  if (e.soldOut) out.push('<span class="b hot">Vyprodáno</span>');
  else if (e.price?.free) out.push('<span class="b">Zdarma</span>');
  else if (e.price?.text) out.push(`<span class="b">${esc(e.price.text)}</span>`);
  if (e.deadline && e.deadline >= todayKey) {
    const n = daysTo(e.deadline);
    const label = n === 0 ? 'Registrace končí dnes' : `Registrace do ${fmt({ day: 'numeric', month: 'numeric' }).format(keyDate(e.deadline))}`;
    out.push(`<span class="b ${n <= 7 ? 'hot' : ''}">${label}</span>`);
  }
  return out.join('');
}

function card(e) {
  const me = u(e.id);
  const d = keyDate(e._k);
  const span = e._ke !== e._k ? ` – ${fmt({ day: 'numeric', month: 'numeric' }).format(keyDate(e._ke))}` : '';
  return `<div class="card ${me.imp ? 'imp-' + me.imp : ''} ${upcoming(e) ? '' : 'past'}" role="button" tabindex="0" data-id="${e.id}">
    <div class="date ${e._k === todayKey ? 'today' : ''}">
      <span class="d">${fmt({ day: 'numeric' }).format(d)}</span>
      <span class="w">${fmt({ weekday: 'short' }).format(d)}${span}</span>
      <span class="t">${timeOf(e)}</span>
    </div>
    <div class="body">
      <h3 class="title">${esc(e.title)}</h3>
      <div class="meta">${esc([whereOf(e), e.organizer].filter(Boolean).join(' · '))}</div>
      <div class="badges">${badges(e)}</div>
    </div>
    <button class="star ${me.imp === 'top' ? 'on' : ''}" type="button" data-star="${e.id}" aria-label="Označit jako Top" aria-pressed="${me.imp === 'top'}">★</button>
  </div>`;
}

// ---------- render ----------

function renderChrome() {
  const base = data.events.filter((e) => upcoming(e) && u(e.id).imp !== 'hide');
  const count = (r) => base.filter((e) => r === 'all' || e.region === r).length;

  $('#regions').innerHTML = REGIONS.map(
    ([k, label]) => `<button type="button" role="tab" data-region="${k}" aria-selected="${state.region === k}">${label} <small>${count(k)}</small></button>`,
  ).join('');
  for (const b of $('#views').children) b.setAttribute('aria-selected', b.dataset.view === state.view);

  const cities = {};
  for (const e of base) if (e.region === 'cz' && e.city) cities[e.city] = (cities[e.city] || 0) + 1;
  const cityEl = $('#cities');
  cityEl.hidden = state.region !== 'cz' || !Object.keys(cities).length;
  cityEl.innerHTML =
    `<button class="chip" type="button" data-city="" aria-pressed="${!state.city}">Všechna města</button>` +
    Object.entries(cities)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'))
      .map(([c, n]) => `<button class="chip" type="button" data-city="${esc(c)}" aria-pressed="${state.city === c}">${esc(c)}<small>${n}</small></button>`)
      .join('');

  $('#filters').innerHTML = Object.entries(FILTERS)
    .map(([k, label]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${state.f.has(k)}">${label}</button>`)
    .join('');

  const week = addDays(todayKey, 7);
  const fresh = base.filter(isNew).length;
  $('#stats').innerHTML = `
    <div><dd>${base.length}</dd><dt>nadcházejících</dt></div>
    <div><dd>${base.filter((e) => e._k <= week).length}</dd><dt>do 7 dnů</dt></div>
    <div class="${fresh ? 'hl' : ''}"><dd>${fresh}</dd><dt>nových</dt></div>`;

  const bar = $('#newbar');
  bar.hidden = !fresh || state.f.has('new');
  bar.innerHTML = `<span>${fresh} ${plural(fresh, 'nová akce', 'nové akce', 'nových akcí')} od tvé poslední návštěvy</span>
    <div><button type="button" class="solid" data-newbar="show">Zobrazit</button><button type="button" data-newbar="seen">Viděno</button></div>`;

  if (data.updatedAt) {
    const up = new Date(data.updatedAt);
    const next = new Date();
    const h = SYNC_UTC_HOURS.find((x) => x * 60 + 7 > next.getUTCHours() * 60 + next.getUTCMinutes());
    next.setUTCHours(h ?? SYNC_UTC_HOURS[0] + 24, 7, 0, 0);
    const hm = { hour: '2-digit', minute: '2-digit' };
    const upLabel = keyOf(up) === todayKey ? fmt(hm).format(up) : fmt({ day: 'numeric', month: 'numeric', ...hm }).format(up);
    $('#sync').textContent = `sync ${upLabel} · další ~${fmt(hm).format(next)}`;
    $('#foot-sources').textContent =
      'Zdroje: ' + (data.sources || []).map((s) => `${s.name} ${s.ok ? s.count : '✕'}`).join(' · ');
  }
}

function emptyState() {
  return `<div class="empty"><b>Nic na radaru.</b>Zkus jiné území, vypnout filtry nebo upravit hledání.</div>`;
}

function renderList() {
  const items = data.events.filter((e) => matches(e));
  if (state.f.has('past')) items.reverse();
  if (!items.length) return emptyState();
  let month = '';
  let html = '';
  for (const e of items) {
    const m = fmt({ month: 'long', year: 'numeric' }).format(keyDate(e._k));
    if (m !== month) html += `<h2 class="month">${m}</h2>`;
    month = m;
    html += card(e);
  }
  return html;
}

function renderCal() {
  const [y, m] = state.month.split('-').map(Number);
  const first = `${state.month}-01`;
  const lead = (keyDate(first).getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysIn) / 7) * 7;
  const start = addDays(first, -lead);

  const byDay = new Map();
  for (const e of data.events) {
    if (!matches(e, { ignorePast: true })) continue;
    for (let k = e._k, i = 0; k <= e._ke && i < 31; k = addDays(k, 1), i++) {
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
  }

  if (!state.day || state.day.slice(0, 7) !== state.month) {
    const inMonth = [...byDay.keys()].filter((k) => k.startsWith(state.month)).sort();
    state.day = todayKey.startsWith(state.month) ? todayKey : inMonth[0] || first;
  }

  let grid = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < cells; i++) {
    const k = addDays(start, i);
    const evs = byDay.get(k) || [];
    const pills = evs
      .slice(0, 3)
      .map((e) => `<span class="pill r-${e.region}" data-id="${e.id}" title="${esc(e.title)}">${esc(e.title)}</span>`)
      .join('');
    const more = evs.length > 3 ? `<span class="pill more-n">+${evs.length - 3}</span>` : '';
    grid += `<button type="button" class="cell ${k.startsWith(state.month) ? '' : 'out'} ${k === todayKey ? 'today' : ''} ${k === state.day ? 'sel' : ''}"
      data-day="${k}" aria-label="${fmt({ day: 'numeric', month: 'long' }).format(keyDate(k))}, ${evs.length} akcí">
      <span class="n">${Number(k.slice(8))}</span><span class="pills">${pills}${more}</span></button>`;
  }

  const dayEvents = byDay.get(state.day) || [];
  return `<div class="cal-head">
      <h2>${fmt({ month: 'long', year: 'numeric' }).format(keyDate(first))}</h2>
      <div class="cal-nav">
        <button type="button" data-nav="-1" aria-label="Předchozí měsíc">←</button>
        <button type="button" class="today-btn" data-nav="0">Dnes</button>
        <button type="button" data-nav="1" aria-label="Další měsíc">→</button>
      </div>
    </div>
    <div class="grid">${grid}</div>
    <div class="legend"><span><i class="lp"></i>Praha</span><span><i></i>Další města</span><span><i class="lo"></i>Online</span></div>
    <h3 class="day-title">${fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(keyDate(state.day))}</h3>
    ${dayEvents.length ? dayEvents.map(card).join('') : '<div class="empty">Na tenhle den nic nemáme.</div>'}`;
}

function render() {
  renderChrome();
  $('#view').innerHTML = state.view === 'cal' ? renderCal() : renderList();
  writeHash();
}

// ---------- detail ----------

function openDetail(id) {
  const e = data.events.find((x) => x.id === id);
  if (!e) return;
  const me = u(id);
  const pick = (kind, opts, cur) =>
    `<div class="pick" data-pick="${kind}">${Object.entries(opts)
      .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`)
      .join('')}</div>`;
  const facts = [
    ['Kdy', whenLong(e)],
    ['Kde', e.online ? 'Online' : [e.venue, e.address || e.city].filter(Boolean).join(', ') || 'Neuvedeno'],
    ['Pořádá', e.organizer],
    ['Cena', e.soldOut ? 'Vyprodáno' : e.price?.free ? 'Zdarma' : e.price?.text],
    ['Registrace', e.deadline ? `do ${fmt({ day: 'numeric', month: 'long' }).format(keyDate(e.deadline))}` : null],
    ['Zdroj', e.source],
  ].filter(([, v]) => v);

  const dlg = $('#detail');
  dlg.dataset.id = id;
  dlg.innerHTML = `<div class="dlg">
    <div class="dlg-top"><div class="badges">${badges(e)}</div><button class="x" type="button" data-close aria-label="Zavřít">✕</button></div>
    <h2>${esc(e.title)}</h2>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
    ${e.source === 'AI hledání' ? '<p class="note">Nalezeno AI hledáním. Datum a místo si ověř na webu akce.</p>' : ''}
    <div class="field"><span>Důležitost</span>${pick('imp', IMP, me.imp)}</div>
    <div class="field"><span>Můj stav</span>${pick('status', STATUS, me.status)}</div>
    <label class="field"><span>Poznámka</span><textarea id="note" placeholder="Proč jít, koho tam potkat…">${esc(me.note)}</textarea></label>
    <div class="actions">
      <a class="btn primary" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">Otevřít web</a>
      <button class="btn" type="button" data-act="ics">Do kalendáře</button>
      <button class="btn" type="button" data-act="share">Sdílet</button>
    </div>
  </div>`;
  if (!dlg.open) dlg.showModal();
  writeHash();
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  // Popover leží v top layer, takže je vidět i nad otevřeným dialogem.
  if (t.showPopover) {
    t.popover = 'manual';
    if (t.matches(':popover-open')) t.hidePopover();
    t.showPopover();
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (t.matches?.(':popover-open')) t.hidePopover();
    t.hidden = true;
  }, 2400);
}

async function share({ title, text, url }) {
  try {
    if (navigator.share) await navigator.share({ title, text, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Odkaz zkopírován');
    }
  } catch (err) {
    if (err.name !== 'AbortError') toast('Sdílení se nepovedlo');
  }
}

const baseUrl = () => location.origin + location.pathname;

// ---------- hash (sdílitelný stav) ----------

function writeHash() {
  const p = new URLSearchParams();
  if (state.region !== 'all') p.set('r', state.region);
  if (state.city) p.set('c', state.city);
  if (state.q) p.set('q', state.q);
  if (state.view === 'cal') p.set('v', 'cal');
  if ($('#detail').open) p.set('e', $('#detail').dataset.id);
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (REGIONS.some(([k]) => k === p.get('r'))) state.region = p.get('r');
  state.city = p.get('c') || null;
  state.q = p.get('q') || '';
  state.view = p.get('v') === 'cal' ? 'cal' : 'list';
  $('#q').value = state.q;
  return p.get('e');
}

// ---------- události ----------

$('#regions').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-region]');
  if (!b) return;
  state.region = b.dataset.region;
  state.city = null;
  render();
});
$('#views').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  render();
});
$('#cities').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-city]');
  if (!b) return;
  state.city = b.dataset.city || null;
  render();
});
$('#filters').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-filter]');
  if (!b) return;
  const k = b.dataset.filter;
  state.f.has(k) ? state.f.delete(k) : state.f.add(k);
  render();
});
$('#newbar').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-newbar]');
  if (!b) return;
  if (b.dataset.newbar === 'show') {
    state.f.add('new');
    state.view = 'list';
  } else {
    visit.prev = Date.now();
    store.set('mr.visit', visit);
  }
  render();
});

let qTimer;
$('#q').addEventListener('input', (ev) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    state.q = ev.target.value.trim();
    render();
  }, 120);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === '/' && !/input|textarea/i.test(document.activeElement.tagName) && !$('dialog[open]')) {
    ev.preventDefault();
    $('#q').focus();
  }
});

const view = $('#view');
view.addEventListener('click', (ev) => {
  const star = ev.target.closest('[data-star]');
  if (star) {
    const id = star.dataset.star;
    setUser(id, { imp: u(id).imp === 'top' ? null : 'top' });
    return render();
  }
  const nav = ev.target.closest('[data-nav]');
  if (nav) {
    const n = Number(nav.dataset.nav);
    const [y, m] = state.month.split('-').map(Number);
    state.month = n === 0 ? todayKey.slice(0, 7) : new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
    state.day = null;
    return render();
  }
  const pill = ev.target.closest('.pill[data-id]');
  if (pill && matchMedia('(min-width: 641px)').matches) return openDetail(pill.dataset.id);
  const cell = ev.target.closest('[data-day]');
  if (cell) {
    state.day = cell.dataset.day;
    return render();
  }
  const c = ev.target.closest('.card');
  if (c) openDetail(c.dataset.id);
});
view.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('card')) {
    ev.preventDefault();
    openDetail(ev.target.dataset.id);
  }
});

const detail = $('#detail');
detail.addEventListener('click', (ev) => {
  const id = detail.dataset.id;
  const e = data.events.find((x) => x.id === id);
  if (ev.target === detail || ev.target.closest('[data-close]')) return detail.close();
  const opt = ev.target.closest('[data-pick] button');
  if (opt) {
    const kind = opt.parentElement.dataset.pick;
    setUser(id, { [kind]: u(id)[kind] === opt.dataset.v ? null : opt.dataset.v });
    render();
    return openDetail(id);
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'ics') download(`${norm(e.title).replace(/[^a-z0-9]+/g, '-').slice(0, 50)}.ics`, toICS([e], e.title), 'text/calendar');
  if (act === 'share') share({ title: e.title, text: `${e.title} – ${whenLong(e)}, ${whereOf(e)}`, url: `${baseUrl()}#e=${id}` });
});
detail.addEventListener('input', (ev) => {
  if (ev.target.id === 'note') setUser(detail.dataset.id, { note: ev.target.value });
});
detail.addEventListener('close', render);

const feeds = $('#feeds');
$('#btn-feeds').addEventListener('click', () => {
  const list = [
    ['vse.ics', 'Všechny AI akce'],
    ['praha.ics', 'Praha'],
    ['cesko.ics', 'Další města ČR'],
    ['online.ics', 'Online'],
  ];
  const dir = new URL('data/', location.href).href;
  feeds.innerHTML = `<div class="dlg">
    <div class="dlg-top"><h2>Odběr kalendáře</h2><button class="x" type="button" data-close aria-label="Zavřít">✕</button></div>
    <p class="note">Přidej si feed do Google, Apple nebo Outlook kalendáře. Akce se v něm obnovují samy po každém syncu.</p>
    <div>${list
      .map(
        ([f, l]) => `<div class="feed"><div><b>${l}</b><small>${f}</small></div>
        <div><button class="ghost" type="button" data-copy="${dir + f}">Kopírovat</button><a class="ghost" href="${(dir + f).replace(/^https?:/, 'webcal:')}">Odebírat</a></div></div>`,
      )
      .join('')}</div>
    <button class="btn" type="button" data-export>Stáhnout aktuální výběr (.ics)</button>
  </div>`;
  feeds.showModal();
});
feeds.addEventListener('click', async (ev) => {
  if (ev.target === feeds || ev.target.closest('[data-close]')) return feeds.close();
  const copy = ev.target.closest('[data-copy]');
  if (copy) {
    await navigator.clipboard.writeText(copy.dataset.copy).then(
      () => toast('Odkaz na feed zkopírován'),
      () => toast('Kopírování se nepovedlo'),
    );
  }
  if (ev.target.closest('[data-export]')) {
    const items = data.events.filter((e) => matches(e));
    if (!items.length) return toast('Výběr je prázdný');
    download('meetup-radar-vyber.ics', toICS(items, 'Meetup Radar – výběr'), 'text/calendar');
    toast(`Staženo ${items.length} ${plural(items.length, 'akce', 'akce', 'akcí')}`);
  }
});

$('#btn-share').addEventListener('click', () => {
  writeHash();
  share({ title: 'Meetup Radar', text: 'AI akce na radaru', url: location.href });
});

// ---------- data ----------

let lastFetch = 0;
async function load() {
  lastFetch = Date.now();
  try {
    const res = await fetch('data/events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const next = await res.json();
    if (next.updatedAt === data.updatedAt) return;
    data = prepare(next);
    todayKey = keyOf(new Date());
    render();
  } catch {
    if (!data.updatedAt) {
      $('#sync').textContent = 'offline';
      $('#view').innerHTML = `<div class="empty"><b>Data se nepodařilo načíst.</b>Zkontroluj připojení a zkus to znovu.</div>`;
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch > 10 * 60e3) load();
});
setInterval(load, 30 * 60e3);

if (window.self !== window.top) document.documentElement.classList.add('embed');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const deepLink = readHash();
await load();
if (deepLink) openDetail(deepLink);
