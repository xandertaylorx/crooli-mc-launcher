// Draws the app icon: the grass block from the site logo on a dark rounded square, as a PNG.
// No dependencies. Run: node scripts/make-icon.js   (writes build/icon.png and the copies the app and site use)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The same 8 by 8 block as web/index.html's logo symbol.
const GRASS = '#5fa83a', DIRT = '#8a5f3c', SHADE = '#6e4a2d';
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rects = [
  [DIRT, [[0, 3, 8, 5]]],
  [GRASS, [[0, 0, 8, 3], [1, 3, 1, 1], [4, 3, 1, 2], [6, 3, 1, 1]]],
  [SHADE, [[2, 5, 1, 1], [6, 6, 1, 1], [3, 7, 1, 1]]],
];
const cell = (cx, cy) => { let c = null; for (const [col, rs] of rects) for (const [x, y, w, h] of rs) if (cx >= x && cx < x + w && cy >= y && cy < y + h) c = col; return c; };

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const u = size / 1024;                       // everything is designed on a 1024 grid
  const R = 232 * u, B = 80 * u, N = 8 * B;    // corner radius, block cell size, block size
  const bx = (size - N) / 2, by = (size - N) / 2 + 6 * u;
  const edge = 16 * u, band = 26 * u;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // rounded square, anti-aliased by its signed distance
    const dx = Math.abs(x + 0.5 - size / 2) - (size / 2 - R), dy = Math.abs(y + 0.5 - size / 2) - (size / 2 - R);
    const sd = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - R;
    const a = Math.max(0, Math.min(1, 0.5 - sd));
    if (a === 0) continue;
    // background: charcoal, a little lighter at the top
    const t = y / size;
    let c = [0x3f, 0x43, 0x4b].map((v, i) => v + (([0x25, 0x27, 0x2c][i]) - v) * t);
    // soft shadow under the block
    const sx = x - (bx + N / 2), sy = y - (by + N + 22 * u);
    const sh = Math.exp(-((sx * sx) / (N * N * 0.28) + (sy * sy) / (60 * u * 60 * u)));
    c = c.map((v) => v * (1 - 0.35 * sh));
    // the block, with a dark outline and the same light/dark bevel the logo has
    const px = x - bx, py = y - by;
    if (px >= -edge && px < N + edge && py >= -edge && py < N + edge) {
      c = [0x1d, 0x1e, 0x22];
      if (px >= 0 && px < N && py >= 0 && py < N) {
        const col = cell(Math.floor(px / B), Math.floor(py / B));
        let rgb = hex(col);
        if (px < band || py < band) rgb = rgb.map((v) => v + (255 - v) * 0.16);
        else if (px > N - band || py > N - band) rgb = rgb.map((v) => v * 0.74);
        c = rgb;
      }
    }
    const o = (y * size + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = Math.round(a * 255);
  }
  return buf;
}

// A minimal PNG writer: signature, IHDR, one zlib-compressed IDAT, IEND.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size) {
  const raw = render(size), stride = size * 4, rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { rows[y * (stride + 1)] = 0; raw.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.join(__dirname, '..');
const out = (rel, size) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, png(size)); console.log(rel, size + 'px'); };
out('build/icon.png', 1024);          // electron-builder turns this into the .icns and .ico
out('src/assets/icon.png', 512);      // the window and dock icon while developing, and on Windows and Linux
out('web/assets/icon.png', 512);      // the site's touch icon and share image
