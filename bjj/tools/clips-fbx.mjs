// A pack of paired animation delivered as FBX, one file per fighter per clip.
//
// The other shape a pack arrives in is a single GLB with both skeletons in it
// (see clips-glb.mjs). This one is a folder of `12_HalfGuard_A_RM.fbx` and
// `12_HalfGuard_B_RM.fbx`, which is how Unity and Unreal like to receive
// animation and how the exporters therefore write it.
//
// The split matters more than it looks. In a single-scene GLB the two fighters
// are placed relative to each other because they share a world; in two files
// they are only paired if somebody remembered to put that placement into each
// file's root motion. Whether they did is the first thing worth measuring, and
// this front-end exists so `clip-check` can ask.
//
// The clip name is the stem the two files share: `12_HalfGuard`.

import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { readMixamo, readCurves, clipLength, poseAt, bare } from './mixamo.mjs';

// Their world is Mixamo's: the floor is y = 0 and there is no mat in the file.
const MAT_Y = 0;

export function openPack(path) {
  if (!statSync(path).isDirectory()) throw new Error(`${path}: expected a folder of FBX clips`);

  // Two flavours ship side by side. Root motion is the one that can carry the
  // pair's placement, so it is the default; in-place is what a state machine
  // plays and is worth looking at separately.
  const files = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.toLowerCase().endsWith('.fbx')) files.push(p);
    }
  })(path);

  const groups = new Map();
  for (const f of files) {
    // `05_DoubleLeg_Finish_A_RM_MOBILE_HQ.fbx` -> stem `05_DoubleLeg_Finish`,
    // role `A`, flavour `RM`. The role is the last `_A_`/`_B_` in the name, so
    // a clip called `ArmDrag` is not mistaken for one.
    const name = basename(f).replace(/\.fbx$/i, '');
    // `(?:_|$)` and not `\b`: an underscore is a word character, so `RM\b`
    // never matches inside `RM_MOBILE_HQ` and the whole pack reads as unpaired.
    const m = name.match(/^(.*)_([AB])_(RM|IP)(?:_|$)/);
    if (!m) continue;
    const [, stem, role, flavour] = m;
    const key = `${flavour}:${stem}`;
    if (!groups.has(key)) groups.set(key, { stem, flavour, files: {} });
    groups.get(key).files[role] = f;
  }

  const paired = [...groups.values()].filter((g) => g.files.A && g.files.B);
  if (!paired.length) throw new Error(`${path}: no _A_/_B_ pairs found`);
  // If the pack ships both flavours, judge the one that can hold a pair.
  const flavours = new Set(paired.map((g) => g.flavour));
  const use = flavours.has('RM') ? 'RM' : [...flavours][0];
  const list = paired.filter((g) => g.flavour === use)
    .sort((a, b) => (a.stem < b.stem ? -1 : 1));

  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const parsed = readMixamo(file);
    const curves = readCurves(file, parsed);
    const byName = new Map();
    for (const b of parsed.bones.values()) byName.set(bare(b.name), b.id);
    const entry = { parsed, curves, byName, seconds: clipLength(curves) };
    cache.set(file, entry);
    return entry;
  };

  const poseCache = new Map();
  const poseOf = (file, t) => {
    const key = `${file}@${t.toFixed(4)}`;
    if (poseCache.has(key)) return poseCache.get(key);
    const e = load(file);
    const world = poseAt(e.parsed, e.curves, t);
    const got = { world, byName: e.byName };
    // A frame at a time is enough of a cache: clip-check walks forwards and
    // asks for both fighters at the same instant.
    if (poseCache.size > 8) poseCache.clear();
    poseCache.set(key, got);
    return got;
  };

  const accessor = (g, t) => (role, joint) => {
    const { world, byName } = poseOf(g.files[role], t);
    const id = byName.get(joint);
    return id === undefined ? null : world.get(id) || null;
  };

  return {
    label: `${basename(path)} (${use === 'RM' ? 'root motion' : 'in place'})`,
    matY: MAT_Y,
    clips: () => list.map((g, i) => ({ name: g.stem, index: i, seconds: load(g.files.A).seconds })),
    rest: () => accessor(list[0], 0),
    frame: (index, t) => accessor(list[index], t),
  };
}
