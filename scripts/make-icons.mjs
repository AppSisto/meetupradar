// Vygeneruje ikony PWA (PNG + SVG) bez závislostí: node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'site', 'icons');
const INK = [10, 10, 10];
const ACC = [200, 255, 46];
const SS = 4; // supersampling na pixel v každé ose

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

// Geometrie v jednotkách poloměru disku (střed 0,0, osa y nahoru). Stejná čísla používá i SVG níže.
const RING = { r: 0.6, w: 0.075 };
const SWEEP = { from: 18, to: 82, r: 0.86 }; // výseč ve stupních
const BLIP = { x: -0.42, y: -0.36, r: 0.135 };

// Zářivě zelená plocha, na ní černý disk radaru se zelenou výsečí, kruhem a bodem.
function lime(x, y) {
  const r = Math.hypot(x, y);
  if (r > 1) return true;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (r <= SWEEP.r && deg >= SWEEP.from && deg <= SWEEP.to) return true;
  if (Math.abs(r - RING.r) <= RING.w / 2) return true;
  return Math.hypot(x - BLIP.x, y - BLIP.y) <= BLIP.r;
}

// `scale` zmenší motiv do bezpečné zóny maskable ikony.
function png(size, scale = 1) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const R = size * 0.37 * scale;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - size / 2) / R;
          const y = (size / 2 - (py + (sy + 0.5) / SS)) / R;
          if (lime(x, y)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const i = py * (size * 3 + 1) + 1 + px * 3;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(INK[k] + (ACC[k] - INK[k]) * a);
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

function svg() {
  const c = 256;
  const R = 512 * 0.37;
  const pt = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + Math.cos(a) * r * R).toFixed(1)} ${(c - Math.sin(a) * r * R).toFixed(1)}`;
  };
  const sr = (SWEEP.r * R).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#c8ff2e"/><circle cx="${c}" cy="${c}" r="${R.toFixed(1)}" fill="#0a0a0a"/><g fill="#c8ff2e"><path d="M${c} ${c}L${pt(SWEEP.from, SWEEP.r)}A${sr} ${sr} 0 0 0 ${pt(SWEEP.to, SWEEP.r)}Z"/><circle cx="${(c + BLIP.x * R).toFixed(1)}" cy="${(c - BLIP.y * R).toFixed(1)}" r="${(BLIP.r * R).toFixed(1)}"/></g><circle cx="${c}" cy="${c}" r="${(RING.r * R).toFixed(1)}" fill="none" stroke="#c8ff2e" stroke-width="${(RING.w * R).toFixed(1)}"/></svg>\n`;
}

await writeFile(path.join(OUT, 'icon.svg'), svg());
await writeFile(path.join(OUT, 'icon-192.png'), png(192));
await writeFile(path.join(OUT, 'icon-512.png'), png(512));
await writeFile(path.join(OUT, 'icon-180.png'), png(180));
await writeFile(path.join(OUT, 'icon-maskable-512.png'), png(512, 0.82));
console.log('Ikony zapsány do site/icons/');
