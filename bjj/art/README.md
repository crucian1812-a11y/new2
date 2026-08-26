# Source sculpts

The two `.glb` files here are what a mesh generator produced from a prompt about
judo and jiu-jitsu. They are **not loaded by the game** — nothing fetches them at
runtime, and deleting them changes nothing except the ability to re-bake.

What they actually contain, which is worth knowing before planning around them:

| | judo-study-montage | bjj-study-montage |
|---|---|---|
| triangles | 157 130 | 209 422 |
| vertex attributes | positions only | positions only |
| normals, UVs, materials, textures | none | none |
| skeleton, skinning, animation | none | none |
| separate objects | one soup, 7 connected components | one soup, several groups |

No skeleton means neither file is a character on its own: there is nothing to
pose. What `judo-study-montage.glb` does have is two clean standing figures in a
gi, arms hanging at their sides — which happens to be this engine's rest pose —
and those can be rigged automatically.

`bjj/tools/bake-fighter.mjs` does that, and writes `bjj/assets/fighter.bin`:

```bash
node bjj/tools/bake-fighter.mjs bjj/art/judo-study-montage.glb \
  --component 1 --out bjj/assets/fighter.bin --report
```

`--component` picks one connected component, ordered largest first. On this file
`0` and `1` are the two standing figures; the rest are the kneeling and ground
figures from the montage, which have no usable rest pose and cannot be rigged
this way.

`bjj-study-montage.glb` is sculpted pairs already locked into positions — closed
guard, mount, a back take. Nothing in it stands up, so none of it is riggable,
but it is good reference for what the paired poses in `src/game/poses.js` are
trying to look like.

## If you want to replace these with something better

The thing to ask a generator for is **one fighter, standing, arms at the sides**,
and then to run its rigging step. A `.glb` that already carries a `skins` array
skips every guess this pipeline has to make — the bones come with the file, and
`bake-fighter.mjs` would only need to map their names onto `src/render/skeleton.js`.
Failing that, a single clean A-pose figure like the two here bakes well.

What does *not* work: a montage of people already in positions, a scene with the
floor welded to the figures, or a mesh below roughly 8 000 triangles, which is
not enough to hold a gi's silhouette.
