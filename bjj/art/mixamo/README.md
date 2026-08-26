# Mixamo clips

Four Mixamo exports. Read this before assuming they solve anything.

| file | contents |
|---|---|
| `standing.fbx` | 65-bone skeleton + one clip |
| `body-block.fbx` | 65-bone skeleton + one clip |
| `situp-to-idle.fbx` | 65-bone skeleton + one clip |
| `rockin-shackle-a.fbx` | 65-bone skeleton + one clip |

All four are binary FBX 7.7 and all four are **"Without Skin"** exports:

```
objects: NodeAttribute:65 Model:65 AnimationStack:1 AnimationCurve:315
         AnimationCurveNode:54 AnimationLayer:1
clusters: 0
```

`Model:65` is the `mixamorig:` skeleton. `AnimationCurve:315` is one clip.
**`clusters: 0` and no `Geometry` is the important line** — there is no mesh and
there are no skin weights in these files. So they do not replace the rigging in
`bake-fighter.mjs`; there is nothing here to skin.

## What they could still be used for

A Mixamo clip is a stream of poses on a humanoid skeleton, and this game's
weakest data is its hand-typed pose angles. `tools/fbx.mjs` reads these files
already. The natural use is a pose importer: sample a frame, retarget the
skeleton onto the 24 bones in `src/render/skeleton.js`, and print it in the
format `src/game/poses.js` uses — captured angles instead of typed ones.

That is orthogonal to rigging and stays useful whatever else arrives.

Note that a solo clip cannot drive a *paired* pose on its own: both fighters
have to move together, so an imported frame is a starting point for one half of
a pose, not a finished pose.

## What to export instead, to fix rigging

On the Mixamo download dialog:

- **Format:** FBX Binary
- **Skin:** **With Skin** ← this is the setting that matters
- Pose: T-pose is fine (the baker warps onto the canonical rig either way)

A With Skin export carries `Geometry` and `Deformer::Cluster` records: the mesh,
the bone-to-vertex weights, and the bind matrices. That would replace every
estimate the baker currently makes — joint placement, weights, bind pose — with
values from the file.

Even better, if the character was uploaded from one of our own sculpts: rig it
in Mixamo, download **With Skin**, and the result is our fighter with a real rig.
