// Stáhne AI akce ze zdrojů, sloučí je s předchozím stavem a zapíše site/data/.
// Spuštění: node scripts/sync.mjs   (RADAR_AI=1 přidá dohledání přes Claude API)

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toICS } from '../site/ics.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'site', 'data');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const KEEP_PAST_DAYS = 45;

const sources = JSON.parse(await readFile(path.join(ROOT, 'scripts', 'sources.json'), 'utf8'));

// ---------- pomocné funkce ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const clip = (s, n = 420) => {
  const t = String(s ?? '')
    .replace(/[*_#>`]|\\-/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
};

async function get(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'cs,en;q=0.8' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return json ? res.json() : res.text();
}

const nextData = (html) => {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('stránka nemá __NEXT_DATA__');
  return JSON.parse(m[1]);
};

const AI_RE =
  /\b(ai|a\.i\.|umel\w* inteligenc\w*|artificial intelligence|machine learning|strojov\w* uceni|deep learning|llms?|gpt\w*|chatgpt|claude|gemini|copilot|gen ?ai|generativ\w*|agentic|ai agent\w*|agenti|neural\w*|neuronov\w*|mlops|rag|prompt\w*|openai|anthropic|hugging ?face|data science|nlp|computer vision|vibe ?coding|mcp)\b/;
const isAI = (text) => AI_RE.test(norm(text));
// Zmínka v popisu nestačí jednou (často jde o okrajovou poznámku), v názvu ano.
const relevant = (title, text) => isAI(title) || (norm(text).match(new RegExp(AI_RE, 'g')) || []).length >= 3;
const EXCLUDE = (sources.exclude || []).map(norm);
const excluded = (text) => EXCLUDE.some((x) => norm(text).includes(x));

const CITIES = {
  brno: 'Brno', ostrava: 'Ostrava', plzen: 'Plzeň', pilsen: 'Plzeň', olomouc: 'Olomouc', liberec: 'Liberec',
  'ceske budejovice': 'České Budějovice', 'hradec kralove': 'Hradec Králové', pardubice: 'Pardubice',
  zlin: 'Zlín', 'usti nad labem': 'Ústí nad Labem', 'karlovy vary': 'Karlovy Vary', jihlava: 'Jihlava',
  opava: 'Opava', kladno: 'Kladno', 'mlada boleslav': 'Mladá Boleslav',
};
function city(raw) {
  const n = norm(raw).trim();
  if (!n) return null;
  if (/\b(praha|prague|prag)\b/.test(n)) return 'Praha';
  for (const [k, v] of Object.entries(CITIES)) if (n.includes(k)) return v;
  return String(raw).split(',')[0].trim();
}

function typeOf(title, fallback = 'akce') {
  const n = norm(title);
  if (/hackathon|hackaton/.test(n)) return 'hackathon';
  if (/summit/.test(n)) return 'summit';
  if (/konferenc|conference|\bconf\b|kongres|congress|forum/.test(n)) return 'konference';
  if (/workshop|skoleni|kurz|training|bootcamp|masterclass/.test(n)) return 'workshop';
  if (/webinar/.test(n)) return 'webinář';
  if (/meetup|setkani|talks?\b|sraz/.test(n)) return 'meetup';
  return fallback;
}

// Pražský místní čas ("2026-11-25T18:30") → ISO s offsetem.
function pragueISO(local) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(local) || /[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return local;
  const asUTC = new Date(local + 'Z');
  const shown = new Date(asUTC.toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).replace(' ', 'T') + 'Z');
  const off = Math.round((shown - asUTC) / 60000);
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return `${local.slice(0, 16)}:00${sign}${hh}:${mm}`;
}

const dayKey = (iso) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });

// ---------- zdroje ----------

async function meetup() {
  const out = new Map();
  for (const location of sources.meetup.locations) {
    for (const kw of sources.meetup.keywords) {
      const url = `https://www.meetup.com/find/?keywords=${encodeURIComponent(kw)}&location=${location}&source=EVENTS`;
      try {
        const state = nextData(await get(url)).props.pageProps.__APOLLO_STATE__ || {};
        for (const e of Object.values(state)) {
          if (e.__typename !== 'Event' || out.has(e.id)) continue;
          const online = e.eventType === 'ONLINE';
          const v = e.venue || {};
          if (!online && v.country && v.country !== 'cz') continue;
          const group = state[e.group?.__ref] || {};
          const photo = state[e.featuredEventPhoto?.__ref] || {};
          const fee = e.feeSettings;
          out.set(e.id, {
            title: e.title,
            start: e.dateTime,
            end: e.endTime || null,
            online,
            hybrid: e.eventType === 'HYBRID',
            city: online ? null : city(v.city || v.address),
            venue: online ? null : v.name || null,
            address: online ? null : v.address || null,
            type: typeOf(e.title, 'meetup'),
            url: e.eventUrl,
            organizer: group.name || null,
            description: clip(e.description),
            image: photo.highResUrl || photo.baseUrl || null,
            price: fee ? { free: false, text: `${fee.amount} ${fee.currency}` } : { free: true },
            source: 'Meetup',
            _text: `${e.title} ${e.description}`,
          });
        }
      } catch (err) {
        console.warn(`  meetup ${location}/${kw}: ${err.message}`);
      }
      await sleep(400);
    }
  }
  if (!out.size) throw new Error('žádná data');
  return [...out.values()];
}

async function luma() {
  const out = [];
  for (const slug of sources.luma.places) {
    const place = nextData(await get(`https://lu.ma/${slug}`)).props.pageProps.initialData.data.place;
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const url =
        `https://api.lu.ma/discover/get-paginated-events?discover_place_api_id=${place.api_id}&pagination_limit=50` +
        (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : '');
      const data = await get(url, { json: true });
      for (const entry of data.entries || []) {
        const e = entry.event;
        const geo = e.geo_address_info || {};
        const online = e.location_type !== 'offline';
        if (!online && geo.country_code && geo.country_code !== 'CZ') continue;
        const t = entry.ticket_info || {};
        out.push({
          title: e.name,
          start: e.start_at,
          end: e.end_at || null,
          online,
          city: online ? null : city(geo.city || geo.city_state || place.name),
          venue: online ? null : geo.address || null,
          address: online ? null : geo.full_address || null,
          type: typeOf(e.name),
          url: `https://lu.ma/${e.url}`,
          organizer: entry.calendar?.name || entry.hosts?.[0]?.name || null,
          description: clip(geo.description || entry.calendar?.description_short),
          image: e.cover_url || null,
          price: t.is_free
            ? { free: true }
            : t.price
              ? { free: false, text: `${Math.round(t.price.cents / 100)} ${String(t.price.currency).toUpperCase()}` }
              : null,
          soldOut: !!t.is_sold_out,
          source: 'Luma',
          _text: `${e.name} ${geo.description || ''} ${entry.calendar?.name || ''}`,
        });
      }
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
      await sleep(300);
    }
  }
  return out;
}

function fromJsonLd(html, source) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const types = [].concat(node['@type'] || []);
    if (types.some((t) => /Event$/.test(t)) && node.name && node.startDate) {
      const loc = [].concat(node.location || [])[0] || {};
      const addr = typeof loc.address === 'object' ? loc.address : {};
      const online = /Online/.test(node.eventAttendanceMode || '') || loc['@type'] === 'VirtualLocation';
      if (!online && addr.addressCountry && !/^(cz|cze|czechia|czech republic|cesko)$/.test(norm(addr.addressCountry.name || addr.addressCountry))) return;
      const offer = [].concat(node.offers || [])[0];
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(node.startDate);
      out.push({
        title: node.name,
        start: node.startDate,
        end: node.endDate || null,
        allDay,
        online,
        city: online ? null : city([addr.addressRegion, addr.addressLocality].some((x) => /praha|prague/i.test(x || '')) ? 'Praha' : addr.addressLocality || addr.addressRegion || (typeof loc.address === 'string' ? loc.address : '')),
        venue: online ? null : loc.name || null,
        address: online ? null : [addr.streetAddress, addr.addressLocality].filter(Boolean).join(', ') || null,
        type: typeOf(node.name),
        url: node.url,
        organizer: node.organizer?.name || null,
        description: clip(node.description),
        image: [].concat(node.image || [])[0]?.url || [].concat(node.image || [])[0] || null,
        price: offer?.price != null
          ? Number(offer.price) === 0 ? { free: true } : { free: false, text: `${offer.price} ${offer.priceCurrency || ''}`.trim() }
          : null,
        source,
        _text: `${node.name} ${node.description || ''}`,
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      visit(JSON.parse(m[1]));
    } catch {
      /* nevalidní JSON-LD přeskočit */
    }
  }
  return out;
}

async function pages(urls, label) {
  const out = [];
  let ok = 0;
  for (const url of urls) {
    try {
      out.push(...fromJsonLd(await get(url), label || new URL(url).hostname.replace(/^www\./, '')));
      ok++;
    } catch (err) {
      console.warn(`  ${url}: ${err.message}`);
    }
    await sleep(400);
  }
  if (urls.length && !ok) throw new Error('žádná stránka se nenačetla');
  return out;
}

async function ai(known) {
  const { discover } = await import('./discover.mjs');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' });
  const items = await discover({ today, known });
  return items
    .filter((i) => i && i.title && i.start && /^https?:\/\//.test(i.url || ''))
    .map((i) => ({
      title: String(i.title),
      start: pragueISO(String(i.start)),
      end: i.end ? pragueISO(String(i.end)) : null,
      allDay: /^\d{4}-\d{2}-\d{2}$/.test(i.start),
      online: !!i.online,
      city: i.online ? null : city(i.city),
      venue: i.online ? null : i.venue || null,
      address: null,
      type: i.type || typeOf(i.title),
      url: i.url,
      organizer: i.organizer || null,
      description: clip(i.description),
      image: null,
      price: i.free === true ? { free: true } : i.price ? { free: false, text: String(i.price) } : null,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(i.deadline || '') ? i.deadline : null,
      source: 'AI hledání',
      _text: 'ai',
    }));
}

// ---------- běh ----------

const prev = await readFile(path.join(DATA, 'events.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({ events: [] }));
const prevById = new Map(prev.events.map((e) => [e.id, e]));
const now = new Date();
const nowISO = now.toISOString();
const report = [];
const collected = [];

async function run(name, fn) {
  process.stdout.write(`${name}… `);
  try {
    const items = await fn();
    collected.push(...items);
    report.push({ name, ok: true, count: items.length });
    console.log(items.length);
  } catch (err) {
    report.push({ name, ok: false, count: 0, error: err.message });
    console.log(`CHYBA: ${err.message}`);
  }
}

await run('Meetup', meetup);
await run('Luma', luma);
await run('Eventbrite', () => pages(sources.eventbrite.urls, 'Eventbrite'));
if (sources.jsonld.urls.length) await run('Vlastní weby', () => pages(sources.jsonld.urls));

const idOf = (e) =>
  createHash('sha1')
    .update(`${norm(e.title).replace(/[^a-z0-9]+/g, ' ').trim()}|${dayKey(e.start)}`)
    .digest('hex')
    .slice(0, 10);

function merge(items) {
  const byId = new Map();
  for (const raw of items) {
    if (!raw.title || !raw.start || Number.isNaN(new Date(raw.start).getTime())) continue;
    const { _text, ...e } = raw;
    // Online akce z celého světa jsou plné balastu: AI musí být přímo v názvu.
    if (_text !== 'ai' && (!(e.online ? isAI(e.title) : relevant(e.title, _text)) || excluded(_text))) continue;
    e.id = idOf(e);
    e.allDay = !!e.allDay;
    e.region = e.online ? 'online' : e.city === 'Praha' ? 'praha' : 'cz';
    const had = byId.get(e.id);
    if (!had) byId.set(e.id, e);
    else for (const k of Object.keys(e)) if (had[k] == null && e[k] != null) had[k] = e[k];
  }
  return byId;
}

let fresh = merge(collected);

if (process.env.RADAR_AI === '1') {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    report.push({ name: 'AI hledání', ok: false, count: 0, error: 'chybí ANTHROPIC_API_KEY' });
    console.log('AI hledání… přeskočeno (chybí ANTHROPIC_API_KEY)');
  } else {
    const known = [...new Map([...prevById, ...fresh]).values()]
      .filter((e) => new Date(e.end || e.start) >= now)
      .slice(0, 150)
      .map((e) => `${e.title} (${dayKey(e.start)})`);
    const before = collected.length;
    await run('AI hledání', () => ai(known));
    fresh = merge(collected);
    if (collected.length > before) prev.aiAt = nowISO;
  }
}

// Sloučení s minulým stavem: firstSeen zůstává, akce, které ze zdroje vypadly, se drží do konce.
const cutoff = new Date(now.getTime() - KEEP_PAST_DAYS * 864e5);
const events = [];
for (const e of fresh.values()) {
  const old = prevById.get(e.id);
  // AI hledání neběží při každém syncu, jeho doplňky (deadline, cena) se nesmí ztratit.
  events.push({ ...old, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v != null)), firstSeen: old?.firstSeen || nowISO, lastSeen: nowISO });
}
for (const old of prevById.values()) if (!fresh.has(old.id)) events.push(old);

const kept = events
  .filter((e) => new Date(e.end || e.start) >= cutoff)
  .sort((a, b) => new Date(a.start) - new Date(b.start) || a.title.localeCompare(b.title, 'cs'));

await mkdir(DATA, { recursive: true });
const out = { updatedAt: nowISO, aiAt: prev.aiAt || null, sources: report, events: kept };
await writeFile(path.join(DATA, 'events.json'), JSON.stringify(out, null, 1) + '\n');

const upcoming = kept.filter((e) => new Date(e.end || e.start) >= new Date(now.getTime() - 864e5));
const feeds = {
  'vse.ics': ['Meetup Radar – všechny AI akce', () => true],
  'praha.ics': ['Meetup Radar – Praha', (e) => e.region === 'praha'],
  'cesko.ics': ['Meetup Radar – další města ČR', (e) => e.region === 'cz'],
  'online.ics': ['Meetup Radar – online', (e) => e.region === 'online'],
};
for (const [file, [name, f]] of Object.entries(feeds)) {
  await writeFile(path.join(DATA, file), toICS(upcoming.filter(f), name));
}

const added = kept.filter((e) => e.firstSeen === nowISO).length;
console.log(`Hotovo: ${kept.length} akcí (${upcoming.length} nadcházejících, ${added} nových).`);
if (report.every((r) => !r.ok)) process.exit(1);
