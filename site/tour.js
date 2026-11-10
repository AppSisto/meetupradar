// Prohlídka appky: reflektor na skutečné prvky stránky + karta s výkladem.

const PAD = 8;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const chips = (label, items, on) =>
  `<div class="tour-demo-row stack"><span>${label}</span>${items.map((t, i) => `<i class="${i === on ? 'on' : ''}">${t}</i>`).join('')}</div>`;

// target: selektor prvku, na který se posvítí (bez něj je karta uprostřed). enter/leave: úpravy appky kolem kroku.
const STEPS = [
  {
    kicker: 'Prohlídka · necelá minuta',
    title: 'Vítej na radaru.',
    text: 'Meetup Radar hlídá AI meetupy, konference a summity v Praze, dalších městech Česka a online. Ukážu ti, kde co je.',
  },
  {
    target: '#stats',
    title: 'Stav na první pohled',
    text: 'Kolik akcí je před tebou, kolik jich bude do 7 dnů a kolik přibylo od tvé poslední návštěvy.',
  },
  {
    target: '.search',
    title: 'Najdi cokoli',
    text: 'Hledá v názvu, popisu, místě, pořadateli i ve tvých poznámkách. Diakritiku řešit nemusíš.',
    demo: '<div class="tour-demo-row"><span>Zkratka</span><kbd>/</kbd> skočí rovnou do hledání</div>',
  },
  {
    target: '#regions',
    title: 'Praha zvlášť, zbytek zvlášť',
    text: 'Přepínej území. U Dalších měst se pod přepínačem objeví filtr na konkrétní město.',
  },
  {
    target: '.grid',
    enter: (app) => app.setView('cal'),
    leave: (app) => app.setView('list'),
    title: 'Seznam, nebo kalendář',
    text: 'Stejné akce v měsíční mřížce. Klepni na den a pod kalendářem uvidíš jeho program.',
    demo: '<div class="tour-demo-row tour-legend"><i class="lp"></i>Praha<i class="lc"></i>Další města<i class="lo"></i>Online</div>',
  },
  {
    target: '#filters',
    title: 'Filtry jedním klepnutím',
    text: 'Jen nové, jen tebou označené, jen kam jdeš, jen zdarma. Dají se kombinovat mezi sebou i s hledáním.',
  },
  {
    target: '.card',
    title: 'Karta akce',
    text: 'Datum a čas, místo, pořadatel a štítky. Hvězdička vpravo označí akci jako Top. Klepnutí na kartu otevře detail.',
  },
  {
    title: 'V detailu si akci roztřídíš',
    text: 'Nastav důležitost a svůj stav, připiš poznámku. Odtud akci taky pošleš do kalendáře nebo nasdílíš.',
    demo:
      chips('Důležitost', ['Top', 'Důležité', 'Možná', 'Skrýt'], 0) +
      chips('Můj stav', ['Jdu', 'Zvažuji', 'Nejdu'], 0),
  },
  {
    target: '.top-actions',
    title: 'Odběr a sdílení',
    text: 'Odběr přidá akce do Google, Apple nebo Outlook kalendáře a sám se obnovuje. Sdílet pošle odkaz přesně na výběr, který zrovna vidíš.',
  },
  {
    kicker: 'To je všechno',
    title: 'Radar běží sám.',
    text: 'Nové akce se načítají 4× denně. Přidej si appku na plochu telefonu, funguje i offline. Štítky a poznámky zůstávají jen v tomhle zařízení.',
    demo: '<div class="tour-demo-row"><span>Znovu</span>Prohlídku kdykoli spustíš tlačítkem <kbd>?</kbd> nahoře</div>',
  },
];

let active = null;

export function startTour(app, { onDone } = {}) {
  if (active) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `<div class="tour-block"></div><div class="tour-hole"></div>
    <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" tabindex="-1"></section>`;
  document.body.append(root);
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  const prevOverflow = document.documentElement.style.overflow;
  const prevFocus = document.activeElement;
  document.documentElement.style.overflow = 'hidden';
  let i = -1;
  let target = null;

  function place() {
    // Nejmenší z hlášených rozměrů: při zoomu nebo emulaci se layoutový a viditelný viewport liší.
    const vw = Math.min(innerWidth, document.documentElement.clientWidth, visualViewport?.width ?? Infinity);
    const vh = Math.min(innerHeight, document.documentElement.clientHeight, visualViewport?.height ?? Infinity);
    card.style.width = `${Math.min(400, vw - 24)}px`;
    const r = target?.getBoundingClientRect();
    const visible = r && r.width > 0 && r.height > 0;
    if (visible) {
      const top = Math.max(4, r.top - PAD);
      const left = Math.max(4, r.left - PAD);
      Object.assign(hole.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${Math.min(vw - 4, r.right + PAD) - left}px`,
        height: `${Math.min(vh - 4, r.bottom + PAD) - top}px`,
      });
    } else {
      Object.assign(hole.style, { top: `${vh / 2}px`, left: `${vw / 2}px`, width: '0px', height: '0px' });
    }
    hole.classList.toggle('off', !visible);

    // Karta se umisťuje do viditelného viewportu (při zoomu je posunutý proti layoutovému).
    const ox = visualViewport?.offsetLeft ?? 0;
    const oy = visualViewport?.offsetTop ?? 0;
    const t = visible ? { top: r.top - oy, bottom: r.bottom - oy, left: r.left - ox } : null;
    const ch = card.offsetHeight;
    const cw = card.offsetWidth;
    const gap = 18;
    let top;
    let left = (vw - cw) / 2;
    if (!t) top = (vh - ch) / 2;
    else if (vw <= 640) top = vh - t.bottom >= t.top ? vh - ch - 12 : 12;
    else {
      left = Math.min(Math.max(12, t.left - PAD), vw - cw - 12);
      if (t.bottom + gap + ch <= vh - 12) top = t.bottom + gap;
      else if (t.top - gap - ch >= 12) top = t.top - gap - ch;
      else {
        // Prvek zabírá skoro celou výšku: karta se přisune k dolnímu okraji, kde překryje nejméně.
        top = vh - ch - 12;
        left = vw - cw - 12;
      }
    }
    card.style.transform = `translate(${Math.round(left + ox)}px, ${Math.round(Math.max(12, top) + oy)}px)`;
  }

  function show(n) {
    if (n < 0) return;
    if (n >= STEPS.length) return finish();
    STEPS[i]?.leave?.(app);
    i = n;
    const s = STEPS[i];
    s.enter?.(app);
    target = s.target ? document.querySelector(s.target) : null;
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Vysoký prvek (kalendář) se přisune pod hlavičku, aby pod ním zbylo místo na kartu.
    const tr = target?.getBoundingClientRect();
    if (tr && tr.height > innerHeight * 0.4) scrollBy({ top: tr.top - 72, behavior: 'instant' });

    const last = i === STEPS.length - 1;
    card.innerHTML = `
      <div class="tour-head">
        <span class="tour-count"><b>${String(i + 1).padStart(2, '0')}</b> / ${String(STEPS.length).padStart(2, '0')}</span>
        <button type="button" class="tour-skip" data-tour="skip">${last ? 'Zavřít' : 'Přeskočit'}</button>
      </div>
      <div class="tour-bar">${STEPS.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
      ${s.kicker ? `<p class="tour-kicker">${esc(s.kicker)}</p>` : ''}
      <h2 id="tour-title">${esc(s.title)}</h2>
      <p class="tour-text">${esc(s.text)}</p>
      ${s.demo ? `<div class="tour-demo">${s.demo}</div>` : ''}
      <div class="tour-nav">
        <button type="button" class="tour-back" data-tour="back" ${i === 0 ? 'hidden' : ''}>← Zpět</button>
        <button type="button" class="tour-next" data-tour="next">${last ? 'Jdu na to' : i === 0 ? 'Spustit prohlídku' : 'Další →'}</button>
      </div>`;
    card.classList.remove('in');
    place();
    void card.offsetWidth; // reflow, aby se animace obsahu spustila znovu u každého kroku
    card.classList.add('in');
    card.querySelector('.tour-next').focus({ preventScroll: true });
  }

  function finish() {
    STEPS[i]?.leave?.(app);
    removeEventListener('resize', place);
    removeEventListener('keydown', onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    root.remove();
    active = null;
    scrollTo({ top: 0, behavior: 'instant' });
    prevFocus?.focus?.({ preventScroll: true });
    onDone?.();
  }

  function onKey(ev) {
    if (ev.key === 'Escape') finish();
    else if (ev.key === 'ArrowRight') show(i + 1);
    else if (ev.key === 'ArrowLeft') show(i - 1);
    else if (ev.key === 'Tab') {
      // Fokus zůstává v kartě, zbytek stránky je během prohlídky jen na dívání.
      const f = [...card.querySelectorAll('button:not([hidden])')];
      const at = f.indexOf(document.activeElement);
      f[(at + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  card.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-tour]')?.dataset.tour;
    if (act === 'next') show(i + 1);
    if (act === 'back') show(i - 1);
    if (act === 'skip') finish();
  });
  addEventListener('resize', place);
  addEventListener('keydown', onKey, true);
  active = root;
  show(0);
}
