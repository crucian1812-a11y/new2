// Harmony4D off Hugging Face, only the part that is poses.
//
// The dataset is one zip a category (train/02_grappling.zip is 44 GB), and
// almost all of it is camera frames. The 3D poses of a whole category are a
// few megabytes. A zip keeps its table of contents at the end, so this reads
// that with HTTP Range requests, picks the members wanted, and fetches only
// the stretches of the archive they sit in.
//
//   node bjj/tools/h4d-fetch.mjs                     the categories and sizes
//   node bjj/tools/h4d-fetch.mjs train/02_grappling  its poses3d into
//                                                    bjj/data/h4d/train/...
//   node bjj/tools/h4d-fetch.mjs train/02_grappling --list   every member
//   node bjj/tools/h4d-fetch.mjs PART --match REGEX --out DIR
//
// The network goes through curl, which knows the machine's proxy.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const REPO = 'Jyun-Ting/Harmony4D';
const HF = 'https://huggingface.co';

const curl = (args) => execFileSync('curl', ['-sfL', ...args], { maxBuffer: 1 << 30 });

function categories() {
  const out = [];
  for (const split of ['train', 'test']) {
    for (const f of JSON.parse(curl([`${HF}/api/datasets/${REPO}/tree/main/${split}`]).toString())) {
      out.push(`${f.path.replace(/\.zip$/, '').padEnd(28)} ${(f.size / 1e9).toFixed(2).padStart(6)} GB`);
    }
  }
  console.log(out.join('\n'));
}

// The signed CDN address the dataset's resolve URL redirects to, and its size.
function locate(part) {
  const head = curl(['-I', `${HF}/datasets/${REPO}/resolve/main/${part}.zip`]).toString();
  const loc = [...head.matchAll(/^location:\s*(\S+)/gim)].pop();
  const size = [...head.matchAll(/^content-length:\s*(\d+)/gim)].pop();
  return { url: loc ? loc[1] : `${HF}/datasets/${REPO}/resolve/main/${part}.zip`, size: +size[1] };
}

let fetched = 0;
function range(url, a, b) {   // [a, b), retried: a CDN drops one now and then
  for (let t = 0; ; t++) {
    try {
      const buf = curl(['-r', `${a}-${b - 1}`, url]);
      if (buf.length === b - a) { fetched += buf.length; return buf; }
    } catch (e) { if (t >= 4) throw e; }
    if (t >= 4) throw new Error(`range ${a}-${b} came back short`);
  }
}

// --- the zip's table of contents (zip64: these archives are past 4 GB) ----
function contents(url, size) {
  const tailLen = Math.min(size, 1 << 16);
  const tail = range(url, size - tailLen, size);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end of central directory');
  let cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  const loc = eocd - 20;
  if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
    const recOff = Number(tail.readBigUInt64LE(loc + 8));
    const rec = recOff >= size - tailLen ? tail.subarray(recOff - (size - tailLen)) : range(url, recOff, recOff + 56);
    if (rec.readUInt32LE(0) !== 0x06064b50) throw new Error('bad zip64 end record');
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOff = Number(rec.readBigUInt64LE(48));
  }
  const cd = range(url, cdOff, cdOff + cdSize);
  const entries = [];
  for (let i = 0; i < cd.length;) {
    if (cd.readUInt32LE(i) !== 0x02014b50) throw new Error(`bad central header at ${i}`);
    const method = cd.readUInt16LE(i + 10);
    let csize = cd.readUInt32LE(i + 20), usize = cd.readUInt32LE(i + 24);
    const nl = cd.readUInt16LE(i + 28), xl = cd.readUInt16LE(i + 30), cl = cd.readUInt16LE(i + 32);
    let off = cd.readUInt32LE(i + 42);
    const name = cd.toString('utf8', i + 46, i + 46 + nl);
    // Zip64 extra: whichever of the three fields overflowed, in this order.
    for (let x = i + 46 + nl, end = x + xl; x < end;) {
      const id = cd.readUInt16LE(x), n = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let p = x + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(p)); p += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(p)); p += 8; }
        if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(p)); p += 8; }
      }
      x += 4 + n;
    }
    entries.push({ name, method, csize, usize, off });
    i += 46 + nl + xl + cl;
  }
  return entries;
}

// Members sorted by place in the archive, read a stretch at a time: a
// stretch runs on while the next member starts within a megabyte.
function extract(url, members, out) {
  members.sort((a, b) => a.off - b.off);
  const todo = members.filter((m) => !(existsSync(join(out, m.name)) && statSync(join(out, m.name)).size === m.usize));
  const GAP = 1 << 20, SPAN = 64 << 20, SLACK = 1024;   // slack: local header's name and extra
  for (let i = 0; i < todo.length;) {
    let j = i + 1;
    const end = (m) => m.off + 30 + m.name.length + SLACK + m.csize;
    let hi = end(todo[i]);
    while (j < todo.length && todo[j].off - hi < GAP && end(todo[j]) - todo[i].off < SPAN) hi = Math.max(hi, end(todo[j++]));
    const base = todo[i].off;
    const buf = range(url, base, hi);
    for (const m of todo.slice(i, j)) {
      const h = m.off - base;
      if (buf.readUInt32LE(h) !== 0x04034b50) throw new Error(`bad local header for ${m.name}`);
      const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
      const raw = buf.subarray(start, start + m.csize);
      const data = m.method === 0 ? raw : m.method === 8 ? inflateRawSync(raw) : null;
      if (!data) throw new Error(`${m.name}: compression ${m.method}`);
      const dst = join(out, m.name);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, data);
    }
    i = j;
  }
  return todo.length;
}

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const part = args.find((a, i) => !a.startsWith('--') && !['--match', '--out'].includes(args[i - 1]));
if (!part) { categories(); process.exit(0); }
const { url, size } = locate(part);
const all = contents(url, size);
if (args.includes('--list')) {
  for (const e of all) console.log(`${e.usize}\t${e.name}`);
  console.error(`${all.length} members, table read with ${(fetched / 1e6).toFixed(0)} MB of ${(size / 1e9).toFixed(1)} GB`);
} else {
  const rx = new RegExp(opt('--match', 'processed_data/poses3d/\\d+\\.npy$'));
  const out = opt('--out', join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'h4d', part.split('/')[0]));
  const want = all.filter((e) => rx.test(e.name) && !e.name.endsWith('/'));
  const t0 = Date.now();
  const n = extract(url, want, out);
  const seqs = new Set(want.map((e) => e.name.split('/').slice(0, 2).join('/')));
  console.log(`${want.length} members in ${seqs.size} sequences (${n} new) → ${out}; ` +
    `${(fetched / 1e6).toFixed(0)} MB fetched of ${(size / 1e9).toFixed(1)} GB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
