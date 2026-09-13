/**
 * The status-bar icon.
 *
 * Android tints notification small-icons to a flat silhouette: every
 * non-transparent pixel becomes white (or the accent colour), and everything
 * else disappears. So the source must be pure alpha — a coloured circle would
 * come out as a white circle anyway, and a detailed glyph would come out as a
 * smudge.
 *
 * A plain dot is also the whole point here: it says "something arrived" and
 * nothing else. No app name in the corner of the eye, no sender, no preview.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const SIZE = 96;
const R = SIZE * 0.26;          // a dot, not a blob
const cx = SIZE / 2, cy = SIZE / 2;

const rgba = Buffer.alloc(SIZE * SIZE * 4, 0);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    // One-pixel feather, so it does not look jagged at status-bar size.
    const cov = Math.min(1, Math.max(0, R + 0.5 - d));
    const i = (y * SIZE + x) * 4;
    rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255;
    rgba[i + 3] = Math.round(cov * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const out = path.join(__dirname, '..', 'assets', 'notification-dot.png');
fs.writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log('wrote', out);
