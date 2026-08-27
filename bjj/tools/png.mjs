// A PNG writer, so the offline checks can put a picture on disk.
//
// Every other measurement in this project is a number, and for the marks a
// number is not enough: nobody can tell from a coverage histogram whether the
// helmet looks like a helmet. zlib is in node, so this is thirty lines.

import { deflateSync } from 'zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// `rgba` is straight (not premultiplied) 8-bit RGBA, row 0 at the top.
export function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The atlas is premultiplied and lives GL-side up; a picture wants neither.
export function atlasToPNG(size, premul, background = [1, 1, 1]) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = ((size - 1 - y) * size + x) * 4;
      const d = (y * size + x) * 4;
      const a = premul[s + 3] / 255;
      for (let k = 0; k < 3; k++) {
        out[d + k] = Math.round(Math.min(255, premul[s + k] + background[k] * 255 * (1 - a)));
      }
      out[d + 3] = 255;
    }
  }
  return encodePNG(size, size, out);
}
