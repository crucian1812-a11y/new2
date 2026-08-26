# Source sculpts

Everything here is what a mesh generator produced from a prompt. **None of it is
loaded by the game** — nothing fetches these at runtime, and deleting them
changes nothing except the ability to re-bake. What ships is what
`bjj/tools/bake-fighter.mjs` writes into `bjj/assets/`.

Every one of these files has the same shape: one triangle soup, positions only.

| file | tris | what is in it | what it is good for |
|---|---|---|---|
| `judo-study-montage.glb` | 157 130 | 7 components; two are standing figures in a gi, arms at their sides | **the match fighter** — `assets/fighter.bin` |
| `black-belt-stance.glb` | 97 128 | one figure, gi and black belt, hands up in a striking stance | **the title-screen hero** — `assets/hero.bin` |
| `bjj-study-montage.glb` | 209 422 | sculpted pairs already locked into positions | reference for the paired poses; nothing in it stands up, so nothing is riggable |
| `mini-arena.glb` | 81 196 | a mat, a low wall, benches, a hanging cube | one idea: the jumbotron, now built procedurally in `src/render/arena.js` |
| `material-tiles.glb` | 20 562 | six flat plates, 19 mm thick | nothing — see below |

None of them carries normals, UVs, materials, textures, a skeleton, skinning or
animation.

## Why the arena is not used

The generated arena is a box: a platform, a knee-high wall, four bench shapes and
a hanging cube. `src/render/arena.js` already generates tiered stands, a crowd, a
lighting truss, barrier hoardings and a mat with a painted competition boundary.
Swapping one for the other would lose all of that to gain nothing, so only the
jumbotron idea was taken — twelve triangles, hung over the middle of the mat.

## Why the tiles are nothing at all

A "material comparison" file with no materials, no textures and no UVs is six
rectangles. There is no information in it about any material. If material
reference is what is wanted, the useful thing to ask for is an image, not a mesh.

## Why the black belt sculpt is the menu and not the match

It is the better sculpt of the two figures, and it is still the wrong one to
animate. Linear blend skinning degrades with the angle between the bind pose and
the pose being played: a bind pose with the fists up beside the chin is a long
way from a guard pass, and every position in the game would deform from it. The
judo figure stands with its arms hanging at its sides, which is this engine's
rest pose almost exactly, so it deforms from nearly zero.

So the black belt sculpt is baked `--static`: no rig, no weights, bound rigidly
to the root bone, decimated to 15 000 triangles, and stood on the mat behind the
title card. Which is what a "focus" sculpt is for.

## Re-baking

```bash
# the match fighter: rigged, warped onto the canonical skeleton
node bjj/tools/bake-fighter.mjs bjj/art/judo-study-montage.glb \
  --component 1 --out bjj/assets/fighter.bin --report

# the title-screen hero: static prop, decimated
node bjj/tools/bake-fighter.mjs bjj/art/black-belt-stance.glb \
  --component 0 --static --tris 14000 --height 1.72 --out bjj/assets/hero.bin

node bjj/tools/asset-check.mjs bjj/assets/fighter.bin
node bjj/tools/asset-check.mjs bjj/assets/hero.bin
```

`--component` picks one connected component, ordered largest first.

## What to ask a generator for next time

**One fighter, standing, arms hanging at the sides, and run its rigging step.**
A `.glb` that arrives with a `skins` array skips every guess this pipeline makes:
the bones come with the file and `bake-fighter.mjs` would only need to map their
names onto `src/render/skeleton.js`. Failing that, a single clean A-pose figure
bakes well — that is exactly what `judo-study-montage.glb` accidentally provided.

What does not work, in order of how badly:

- **a montage of people already in positions** — no rest pose, nothing to rig;
- **a fighting stance** — riggable in principle, but a bad bind pose (above);
- **a scene with the floor welded to the figures** — connected components stop
  separating people and start separating nothing;
- **anything under ~8 000 triangles** — not enough to hold a gi's silhouette;
- **"material" or "texture" prompts that return geometry** — a mesh cannot carry
  a material the exporter did not write.
