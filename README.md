# Meetup Radar

PWA, která hlídá AI meetupy, konference, summity a další akce v Praze, dalších městech ČR a online.

## Co umí

- Seznam řazený podle data a měsíční kalendář.
- Území: Praha, další města ČR (s filtrem na město), online.
- Fulltext přes název, popis, místo, pořadatele i vlastní poznámku (bez ohledu na diakritiku).
- Štítky důležitosti (Top, Důležité, Možná, Skrýt), můj stav (Jdu, Zvažuji, Nejdu) a poznámka.
- Odznak „Nové“ a souhrn akcí přibylých od poslední návštěvy.
- Cena a deadline registrace, pokud je zdroj uvádí.
- Export do kalendáře (.ics u akce i celý výběr) a odběr feedů `data/vse.ics`, `praha.ics`, `cesko.ics`, `online.ics`.
- Sdílení akce nebo aktuálního výběru odkazem (stav je v `#hash`).
- Instalace jako aplikace, funguje offline nad posledními daty.

Štítky, stav a poznámky se ukládají do `localStorage`, tedy jen v daném zařízení.

## Struktura

| Cesta | Účel |
|---|---|
| `site/` | Statická PWA (nasazuje se celá složka) |
| `site/data/events.json` | Data akcí, zapisuje sync |
| `scripts/sync.mjs` | Stažení zdrojů, filtr relevance, deduplikace, sloučení s minulým stavem, feedy |
| `scripts/discover.mjs` | AI dohledání přes Claude API s web searchem |
| `scripts/sources.json` | Seznam zdrojů, klíčových slov a vyloučených výrazů |
| `.github/workflows/sync.yml` | Cron 4× denně + nasazení na GitHub Pages |

## Zdroje

- **Meetup.com**: hledání podle klíčových slov pro Prahu, Brno, Ostravu, Plzeň a Olomouc.
- **Luma**: městská stránka Prahy.
- **Eventbrite**: AI akce pro Prahu, Brno a Ostravu.
- **Vlastní weby**: libovolná URL se schema.org JSON-LD typu Event (`jsonld.urls` v `sources.json`).
- **AI hledání**: jednou denně Claude s web searchem dohledá akce mimo tyto zdroje. Takové akce mají v detailu upozornění, že je potřeba ověřit datum na webu.

Zdroje se čtou z veřejných stránek bez oficiálního API. Když některý změní strukturu, sync ho přeskočí, vypíše chybu a v patičce appky se u něj objeví ✕.

## Lokální spuštění

```bash
npm install
npm run sync      # stáhne akce do site/data
npm run dev       # http://localhost:4173
```

AI hledání lokálně: `ANTHROPIC_API_KEY=… npm run sync:ai`.

## Nasazení (GitHub Actions + Pages)

1. Repozitář na GitHubu, větev `main`.
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → secret `ANTHROPIC_API_KEY` (bez něj běží jen pevné zdroje).

Workflow běží v 5:07, 9:07, 13:07 a 17:07 UTC. Ranní běh spouští i AI hledání. Ručně jde spustit z Actions → „Sync a nasazení“.

Nastavení přes proměnné prostředí: `RADAR_MODEL` (výchozí `claude-opus-5-5`), `RADAR_MAX_SEARCHES` (výchozí 15).

## Vložení do portálu

Appka je čistě statická, stačí `<iframe src="…">`. V iframe se automaticky schová velký nadpis.
Portál může číst i samotná data z `data/events.json`.
