// Sestaví appku do jednoho samostatného HTML souboru: node scripts/build-standalone.mjs
// Soubor má data vložená v sobě a po otevření si zkusí stáhnout čerstvá z nasazené appky.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, 'site');
const LIVE = 'https://appsisto.github.io/meetupradar/';
const read = (f) => readFile(path.join(SITE, f), 'utf8');

function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`V předloze chybí: ${from}`);
  return text.replace(from, () => to);
}

const [html, css, app, ics, tour, icon, events] = await Promise.all(
  ['index.html', 'styles.css', 'app.js', 'ics.js', 'tour.js', 'icons/icon.svg', 'data/events.json'].map(read),
);

// Moduly se zabalí do funkcí, aby se jejich pomocné konstanty nepotkaly se jmény v app.js.
const asModule = (src, name) => `const { ${name} } = (() => {\n${src.replace(/^export /m, '')}\nreturn { ${name} };\n})();`;

let js = app;
js = swap(js, "import { toICS } from './ics.js';\n", '');
js = swap(js, "import { startTour } from './tour.js';\n", '');
js = swap(js, 'const baseUrl = () => location.origin + location.pathname;', 'const baseUrl = () => LIVE;');
js = swap(js, "new URL('data/', location.href).href", "LIVE + 'data/'");
js = swap(js, "fetch('data/events.json', { cache: 'no-cache' })", "fetch(LIVE + 'data/events.json', { cache: 'no-cache' })");
js = swap(js, "if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});\n", '');
// Vložená data se ukážou hned, čerstvá je nahradí, jakmile dorazí.
js = swap(js, 'await load();', 'data = prepare(EMBEDDED);\nrender();\nload();');

const script = [
  `const LIVE = ${JSON.stringify(LIVE)};`,
  `const EMBEDDED = ${JSON.stringify(JSON.parse(events)).replace(/</g, '\\u003c')};`,
  asModule(ics, 'toICS'),
  asModule(tour, 'startTour'),
  js,
].join('\n\n');

let out = html;
out = swap(out, '  <link rel="manifest" href="manifest.webmanifest">\n', '');
out = swap(out, '  <link rel="apple-touch-icon" href="icons/icon-180.png">\n', '');
out = swap(out, 'href="icons/icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(icon.trim())}"`);
out = swap(out, '<link rel="stylesheet" href="styles.css">', `<style>\n${css}</style>`);
out = swap(out, '<script type="module" src="app.js"></script>', `<script type="module">\n${script.replace(/<\/script/g, '<\\/script')}\n</script>`);

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const file = path.join(ROOT, 'dist', 'meetupradar.html');
await writeFile(file, out);
console.log(`${file} (${Math.round(out.length / 1024)} kB)`);
