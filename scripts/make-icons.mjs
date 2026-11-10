// Vygeneruje ikony PWA (PNG + SVG) bez závislostí: node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'site', 'icons');
const BG = [10, 10, 10];
const ACC = [200, 255, 46];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const data = Buffer.concat([Buffer.from(type), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(data));
  return Buffer.concat([head, data, tail]);
};

// Radar: soustředné kruhy, výseč a bod. `scale` zmenší motiv do bezpečné zóny maskable ikony.
function png(size, scale = 1) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const c = size / 2;
  const R = (size / 2) * 0.72 * scale;
  const w = size * 0.035 * scale;
  const dot = { x: c + R * 0.42, y: c - R * 0.42, r: size * 0.07 * scale };
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d)); // antialiasing: vzdálenost od hrany v px
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      let a = 0;
      for (const ring of [R, R * 0.62, R * 0.24]) a = Math.max(a, cover(Math.abs(r - ring) - w / 2));
      const ang = Math.atan2(-dy, dx);
      if (ang > 0 && ang < Math.PI / 2) a = Math.max(a, 0.22 * cover(r - R));
      a = Math.max(a, cover(Math.hypot(x + 0.5 - dot.x, y + 0.5 - dot.y) - dot.r));
      const i = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(BG[k] + (ACC[k] - BG[k]) * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0a0a0a"/><g fill="none" stroke="#c8ff2e" stroke-width="18"><circle cx="256" cy="256" r="184"/><circle cx="256" cy="256" r="114"/><circle cx="256" cy="256" r="44"/></g><path d="M256 256V72a184 184 0 0 1 184 184z" fill="#c8ff2e" opacity=".22"/><circle cx="333" cy="179" r="36" fill="#c8ff2e"/></svg>\n`;

await writeFile(path.join(OUT, 'icon.svg'), svg);
await writeFile(path.join(OUT, 'icon-192.png'), png(192));
await writeFile(path.join(OUT, 'icon-512.png'), png(512));
await writeFile(path.join(OUT, 'icon-180.png'), png(180));
await writeFile(path.join(OUT, 'icon-maskable-512.png'), png(512, 0.78));
console.log('Ikony zapsány do site/icons/');
