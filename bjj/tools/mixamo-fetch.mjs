// Mixamo off its own API: characters With Skin, clips without.
//
// The site's Download button is three calls — export, poll the monitor, fetch
// the file it names — and this does the same with the token from the
// environment, so nothing has to pass through somebody's browser and a chat
// upload. The token is the `access_token` the site keeps in localStorage after
// a login; it lives a day or so.
//
//   MIXAMO_TOKEN=... node bjj/tools/mixamo-fetch.mjs --chars [QUERY]
//   MIXAMO_TOKEN=... node bjj/tools/mixamo-fetch.mjs --clips QUERY
//   MIXAMO_TOKEN=... node bjj/tools/mixamo-fetch.mjs char NAME [--out FILE]
//   MIXAMO_TOKEN=... node bjj/tools/mixamo-fetch.mjs clip NAME|ID [--on CHAR] [--out FILE]
//   MIXAMO_TOKEN=... node bjj/tools/mixamo-fetch.mjs --wanted     everything picked below
//
// A character comes as FBX 2019 in the T-pose, which is what bake-mixamo
// reads. A clip comes without skin, on the character named by --on (Mixamo
// retargets on its side; the default is the account's primary character), so
// mixamo-pose and clips-fbx read it as they read the clips already here.
//
// The network goes through curl, which knows the machine's proxy. The token is
// handed to curl on stdin, never on the command line.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const API = 'https://www.mixamo.com/api/v1';
const TOKEN = process.env.MIXAMO_TOKEN;
if (!TOKEN) {
  console.error('MIXAMO_TOKEN is not set');
  process.exit(2);
}

const headers = `Authorization: Bearer ${TOKEN}\nX-Api-Key: mixamo2\nAccept: application/json\n`;

function call(path, body) {
  const args = ['-sfS', '--max-time', '120', '-H', '@-', `${API}${path}`];
  if (body) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  return JSON.parse(execFileSync('curl', args, { input: headers, maxBuffer: 1 << 26 }).toString());
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function search(type, query) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = encodeURIComponent(query || '');
    const j = call(`/products?page=${page}&limit=96&order=&type=${encodeURIComponent(type)}&query=${q}`);
    out.push(...j.results);
    if (page >= j.pagination.num_pages) return out;
  }
}

// Names are not unique: there are five clips called "Getting Up". An id
// (the last column of --clips) names exactly one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function find(type, name) {
  if (UUID.test(name)) return call(`/products/${name}?similar=0&character_id=${primary()}`);
  const hits = search(type, name).filter((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!hits.length) throw new Error(`${type} "${name}": not found`);
  return hits[0];
}

function primary() {
  return call('/characters/primary').primary_character_id;
}

// Export, then poll the character's monitor until the job names a file.
function exportAndWait(characterId, body) {
  call('/animations/export', body);
  for (let i = 0; i < 120; i++) {
    sleep(2000);
    const m = call(`/characters/${characterId}/monitor`);
    if (m.status === 'completed') return m.job_result;
    if (m.status === 'failed') throw new Error(`export failed: ${JSON.stringify(m)}`);
  }
  throw new Error('export: no result after four minutes');
}

function download(url, out) {
  mkdirSync(dirname(out), { recursive: true });
  // The result is a signed storage URL on S3; it takes no token and lives
  // five minutes. The host is not mixamo.com, and a network policy that lets
  // the API through can still refuse it — say which host, not the whole URL.
  try {
    execFileSync('curl', ['-sfSL', '--max-time', '600', '-o', out, url], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw new Error(`download from ${new URL(url).host} refused: ${String(e.stderr).trim()}`);
  }
  console.log(`${out}  ${(statSync(out).size / 1e6).toFixed(1)} MB`);
}

// What has been picked for the game, so a fresh container gets it with one
// command. Characters: ordinary men of sporting build in ordinary clothes —
// no armour, cloaks or skirts, as HANDOFF asks of a fighter — chosen to look
// unlike each other and unlike the two already baked. Clips: the ones whose
// movement is on the ground or leads to it; the takedown is a recorded pair.
const WANTED = [
  ['char', 'Bryce'], // t-shirt and shorts: bare arms and legs, dark hair
  ['char', 'Remy'], // t-shirt and shorts, fair hair
  ['char', 'Lewis'], // short sleeves, dark skin
  ['char', 'Brian'], // polo, shaved head
  ['char', 'David'], // long sleeves, dark skin, short hair
  ['clip', 'c9cd0754-b96c-11e4-a802-0aaa78deedf9', 'double-leg-attacker'],
  ['clip', 'c9cd0819-b96c-11e4-a802-0aaa78deedf9', 'double-leg-victim'],
  ['clip', 'c9c7276e-b96c-11e4-a802-0aaa78deedf9', 'getting-up-from-back'],
  ['clip', 'c9c71f39-b96c-11e4-a802-0aaa78deedf9', 'getting-up-from-stomach'],
  ['clip', 'c9c7937e-b96c-11e4-a802-0aaa78deedf9', 'stand-up-from-seated'],
  ['clip', 'c9c8cebb-b96c-11e4-a802-0aaa78deedf9', 'stand-up-from-kneeling'],
  ['clip', 'c9c77c34-b96c-11e4-a802-0aaa78deedf9', 'crawling'],
  ['clip', 'c9cd9c47-b96c-11e4-a802-0aaa78deedf9', 'kneeling-idle'],
  ['clip', 'c9ccd526-b96c-11e4-a802-0aaa78deedf9', 'sitting-on-floor'],
  ['clip', 'c9c63b43-b96c-11e4-a802-0aaa78deedf9', 'fight-idle'],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function fetchChar(name, out) {
  const c = find('Character', name);
  out ||= join('bjj/art/mixamo', `${slug(c.name)}.fbx`);
  if (existsSync(out)) return console.log(`${out}  already here`);
  const url = exportAndWait(c.id, {
    character_id: c.id,
    product_name: c.name,
    type: 'Character',
    preferences: { format: 'fbx7_2019', mesh: 't-pose' },
    gms_hash: null,
  });
  download(url, out);
}

function fetchClip(name, on, out) {
  if (out && !out.includes('/')) out = join('bjj/art/mixamo/clips', `${out}.fbx`);
  const m = find('Motion,MotionPack', name);
  const charId = on ? find('Character', on).id : primary();
  // The product's own details carry the gms_hash the export wants, with the
  // clip's default parameters already filled in.
  const p = call(`/products/${m.id}?similar=0&character_id=${charId}`);
  const g = p.details.gms_hash;
  const hash = {
    'model-id': g['model-id'],
    mirror: g.mirror ?? false,
    trim: g.trim ?? [0, 100],
    overdrive: 0,
    params: (g.params || []).map((x) => x[1]).join(','),
    'arm-space': g['arm-space'] ?? 0,
    inplace: g.inplace ?? false,
  };
  out ||= join('bjj/art/mixamo/clips', `${slug(m.name)}.fbx`);
  if (existsSync(out)) return console.log(`${out}  already here`);
  const url = exportAndWait(charId, {
    character_id: charId,
    product_name: m.name,
    type: 'Motion',
    preferences: { format: 'fbx7_2019', skin: 'false', fps: '30', reducekf: '0' },
    gms_hash: [hash],
  });
  download(url, out);
}

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv[0] === '--chars') {
  for (const r of search('Character', argv[1])) console.log(`${r.name.padEnd(32)} ${r.id}`);
} else if (argv[0] === '--clips') {
  for (const r of search('Motion,MotionPack', argv[1])) {
    console.log(`${r.name.padEnd(32)} ${(r.description || '').slice(0, 60).padEnd(60)} ${r.id}`);
  }
} else if (argv[0] === '--wanted') {
  for (const [kind, name, out] of WANTED) {
    try {
      if (kind === 'char') fetchChar(name);
      else fetchClip(name, undefined, out);
    } catch (e) {
      console.error(`${name}: ${String(e.message).split('\n')[0]}`);
    }
  }
} else if (argv[0] === 'char' && argv[1]) {
  fetchChar(argv[1], flag('out'));
} else if (argv[0] === 'clip' && argv[1]) {
  fetchClip(argv[1], flag('on'), flag('out'));
} else {
  console.error('usage: mixamo-fetch.mjs --chars [Q] | --clips Q | --wanted | char NAME [--out F] | clip NAME|ID [--on CHAR] [--out F]');
  process.exit(2);
}
