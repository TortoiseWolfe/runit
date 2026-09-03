// Tiny PNG pixel reader for the fidelity loop (no ImageMagick on this box).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
export function pixelAt(path, x, y) {
  const d = readFileSync(path);
  let pos = 8, w = 0, ct = 6; const idat = [];
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos); const typ = d.toString('ascii', pos + 4, pos + 8);
    if (typ === 'IHDR') { w = d.readUInt32BE(pos + 8); ct = d[pos + 17]; }
    else if (typ === 'IDAT') idat.push(d.subarray(pos + 8, pos + 8 + ln));
    pos += 12 + ln;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; const stride = w * ch;
  let prev = Buffer.alloc(stride), cur = prev, off = 0;
  for (let row = 0; row <= y; row++) {
    const f = raw[off++]; const line = Buffer.from(raw.subarray(off, off + stride)); off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = line; cur = line;
  }
  const i = x * ch;
  return '#' + [cur[i], cur[i + 1], cur[i + 2]].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('');
}
