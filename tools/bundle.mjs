// Flattens the game into one self-contained .html file, for hosts that can
// only serve a single document (and for handing someone a file they can open
// offline). There is no build step in normal development — this is a
// distribution step, and it is deliberately dumb:
//
//   node tools/bundle.mjs dist/spiel.html
//
// It works because the module graph is acyclic and no two modules declare the
// same top-level name, so the modules can simply be concatenated in
// dependency order with their import/export keywords removed. The script
// checks both of those properties and refuses to write a bundle if either
// stops being true.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || resolve(root, 'dist/spiel.html');

const read = (p) => readFileSync(resolve(root, p), 'utf8');

// --- resolve the module graph -----------------------------------------------

const ENTRY = 'src/main.js';
const IMPORT_RE = /^import\s+(?:[\s\S]*?)\s+from\s+'([^']+)'\s*;?\s*$/gm;

const deps = new Map();
const collect = (file) => {
  if (deps.has(file)) return;
  const src = read(file);
  const list = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = relative(root, resolve(dirname(resolve(root, file)), m[1])).replace(/\\/g, '/');
    list.push(spec);
  }
  deps.set(file, list);
  for (const d of list) collect(d);
};
collect(ENTRY);

// Depth-first topological sort; the visiting set catches cycles, which the
// concatenation strategy could not honour.
const order = [];
const done = new Set();
const visiting = new Set();
const walk = (file, trail) => {
  if (done.has(file)) return;
  if (visiting.has(file)) {
    throw new Error(`import cycle: ${[...trail, file].join(' -> ')}`);
  }
  visiting.add(file);
  for (const d of deps.get(file)) walk(d, [...trail, file]);
  visiting.delete(file);
  done.add(file);
  order.push(file);
};
walk(ENTRY, []);

// --- strip module syntax ----------------------------------------------------

const DECL_RE = /^(?:export\s+)?(?:const|function|class|let|var)\s+([A-Za-z0-9_$]+)/gm;

const seen = new Map();
const chunks = [];
for (const file of order) {
  let src = read(file);
  for (const m of src.matchAll(DECL_RE)) {
    const name = m[1];
    if (seen.has(name)) {
      throw new Error(`duplicate top-level name '${name}' in ${file} and ${seen.get(name)}`);
    }
    seen.set(name, file);
  }
  src = src
    .replace(IMPORT_RE, '')
    // `export { lerp };` — a re-export, which the flat scope gives us for free.
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^export\s+(const|function|class|let|var|async)\b/gm, '$1');
  chunks.push(`// ===== ${file} ${'='.repeat(Math.max(0, 62 - file.length))}\n${src.trim()}\n`);
}

const js = chunks.join('\n');
if (/^\s*import\s/m.test(js) || /^\s*export\s/m.test(js)) {
  throw new Error('module syntax survived the strip pass');
}

// The bundle is a single file with no <head> of its own, so it cannot declare
// a charset and must not depend on the host guessing right. Escaping every
// non-ASCII character makes the output 7-bit clean: umlauts, Perkūnas and the
// glyphs in the HUD survive any transport. Safe as a blanket replacement
// because nothing here uses non-ASCII in an identifier.
const asciiJs = (s) => s.replace(/[^\x00-\x7F]/gu, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const asciiHtml = (s) => s.replace(/[^\x00-\x7F]/gu, (c) => '&#' + c.codePointAt(0) + ';');

// --- weave the page ---------------------------------------------------------

const html = read('index.html');
const css = read('styles.css');

const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const page = `<style>
${asciiHtml(css.trim())}
</style>

${asciiHtml(body)}

<script type="module">
${asciiJs(js)}
</script>
`;

if (/[^\x00-\x7F]/u.test(page)) throw new Error('bundle is not 7-bit clean');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`${out}  ${order.length} modules  ${(page.length / 1024).toFixed(0)} KB`);
