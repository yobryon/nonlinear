// Regenerate the PWA icons in apps/web/public/ from the "N" mark — pure Node, no
// image dependency. Run from the repo root: node apps/web/scripts/genicons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// CRC32 for PNG chunks.
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // filter byte 0 per scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Accent color and the "N" geometry in a 512 coordinate space.
const ACCENT = [86, 97, 201];
const WHITE = [255, 255, 255];
const barW = 42;
const nx0 = 150,
  nx1 = 362,
  ny0 = 150,
  ny1 = 362;
// Diagonal from top of left bar to bottom of right bar.
const ax = nx0 + barW / 2,
  ay = ny0,
  bx = nx1 - barW / 2,
  by = ny1;

function distToSeg(px, py) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx,
    cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function inN(x, y) {
  if (y < ny0 || y > ny1) return false;
  if (x >= nx0 && x <= nx0 + barW) return true; // left bar
  if (x >= nx1 - barW && x <= nx1) return true; // right bar
  return distToSeg(x, y) <= barW / 2 + 3; // diagonal
}

function render(size, masked) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const radius = masked ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Rounded-corner background mask (skip for maskable — the OS masks it).
      let bg = true;
      if (radius) {
        const cx = Math.min(x, size - 1 - x),
          cy = Math.min(y, size - 1 - y);
        if (cx < radius && cy < radius) {
          bg = Math.hypot(radius - cx, radius - cy) <= radius;
        }
      }
      const i = (y * size + x) * 4;
      if (!bg) {
        rgba[i + 3] = 0;
        continue;
      }
      const sx = x / scale,
        sy = y / scale;
      const on = masked
        ? // Shrink the glyph into the maskable safe zone.
          inN((sx - 256) / 0.7 + 256, (sy - 256) / 0.7 + 256)
        : inN(sx, sy);
      const c = on ? WHITE : ACCENT;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, rgba);
}

const dir = 'apps/web/public';
writeFileSync(`${dir}/icon-192.png`, render(192, false));
writeFileSync(`${dir}/icon-512.png`, render(512, false));
writeFileSync(`${dir}/icon-maskable-512.png`, render(512, true));
writeFileSync(`${dir}/apple-touch-icon.png`, render(180, false));
console.log('icons written');
