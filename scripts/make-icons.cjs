/**
 * Draws the launcher icons.
 *
 * The whole point of this app is that it looks like a notes app on the home
 * screen, so shipping the default Expo logo would give the game away on day
 * one. No image library is needed for a flat vector-ish glyph — this writes
 * PNGs directly with zlib.
 *
 * Run with: npm run icons
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- minimal PNG writer ---------------------------------------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function writePng(file, w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---- tiny drawing surface -------------------------------------------------
class Canvas {
  constructor(size) {
    this.s = size;
    this.buf = Buffer.alloc(size * size * 4, 0);
  }
  /** Alpha-blend a pixel; `a` is 0..1 and drives coverage for antialiasing. */
  px(x, y, [r, g, b], a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.s || y >= this.s) return;
    const i = (y * this.s + x) * 4;
    const dstA = this.buf[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA === 0) return;
    for (let k = 0; k < 3; k++) {
      const src = [r, g, b][k];
      this.buf[i + k] = Math.round((src * a + this.buf[i + k] * dstA * (1 - a)) / outA);
    }
    this.buf[i + 3] = Math.round(outA * 255);
  }
  /** Fill by signed-distance function; negative distance is inside. */
  fill(sdf, colour, alpha = 1) {
    for (let y = 0; y < this.s; y++) {
      for (let x = 0; x < this.s; x++) {
        const d = sdf(x + 0.5, y + 0.5);
        // One-pixel smooth edge.
        const cov = Math.min(1, Math.max(0, 0.5 - d));
        if (cov > 0) this.px(x, y, colour, cov * alpha);
      }
    }
  }
}

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const cx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const cy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(cx, cy) - r;
};

// ---- the glyph ------------------------------------------------------------
const PAPER = [0xff, 0xfd, 0xf6];
const INK = [0x1c, 0x1b, 0x17];
const ACCENT = [0xc9, 0xa2, 0x27];

/**
 * A sheet of paper with ruled lines and a gold spine.
 * `inset` is the fraction of the canvas left empty — adaptive icons crop hard,
 * so the foreground layer needs generous margins.
 */
function drawNote(size, inset, withBackground) {
  const c = new Canvas(size);
  const S = size;

  if (withBackground) {
    c.fill(roundRect(0, 0, S, S, S * 0.22), PAPER, 1);
  }

  const m = S * inset;
  const w = S - m * 2;
  const pageX0 = m + w * 0.10;
  const pageX1 = m + w * 0.90;
  const pageY0 = m + w * 0.04;
  const pageY1 = m + w * 0.96;
  const r = w * 0.10;

  // Page body.
  c.fill(roundRect(pageX0, pageY0, pageX1, pageY1, r), INK, 1);

  // Gold spine down the left edge.
  c.fill((x, y) => {
    const inPage = roundRect(pageX0, pageY0, pageX1, pageY1, r)(x, y);
    const inSpine = Math.max(inPage, x - (pageX0 + w * 0.13));
    return inSpine;
  }, ACCENT, 1);

  // Ruled lines.
  const lines = [0.30, 0.46, 0.62, 0.76];
  const widths = [0.60, 0.60, 0.60, 0.38];
  lines.forEach((t, i) => {
    const ly = pageY0 + (pageY1 - pageY0) * t;
    const lx0 = pageX0 + w * 0.24;
    const lx1 = lx0 + (pageX1 - lx0 - w * 0.10) * (widths[i] / 0.6);
    const th = w * 0.032;
    c.fill(roundRect(lx0, ly - th / 2, lx1, ly + th / 2, th / 2), PAPER, 1);
  });

  return c.buf;
}

const out = path.join(__dirname, '..', 'assets');
const jobs = [
  // Full-bleed icon (iOS, web, and the legacy Android icon).
  ['icon.png', 1024, 0.14, true],
  // Adaptive foreground: the system crops to a circle, so keep it small.
  ['android-icon-foreground.png', 1024, 0.28, false],
  ['android-icon-monochrome.png', 1024, 0.28, false],
  ['splash-icon.png', 512, 0.22, false],
  ['favicon.png', 64, 0.10, true],
];

for (const [name, size, inset, bg] of jobs) {
  writePng(path.join(out, name), size, size, drawNote(size, inset, bg));
  console.log('wrote assets/' + name);
}

// Flat background layer for the adaptive icon.
const bgCanvas = new Canvas(1024);
bgCanvas.fill(() => -1, PAPER, 1);
writePng(path.join(out, 'android-icon-background.png'), 1024, 1024, bgCanvas.buf);
console.log('wrote assets/android-icon-background.png');
