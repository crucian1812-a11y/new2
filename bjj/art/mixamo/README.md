# Mixamo clips

Four Mixamo exports, re-downloaded **With Skin**. What they actually contain:

```
objects: NodeAttribute:65 Geometry:2 Model:67 Pose:2 Material:2
         Deformer:131 AnimationStack:2 AnimationCurve:315 AnimationCurveNode:54
Geometry "Beta_Surface"  14232 verts  28272 tris  50 clusters
Geometry "Beta_Joints"   10514 verts  20840 tris  39 clusters
clusters: 129            bones: 65    units: centimetres, 181 cm tall
```

| file | clip |
|---|---|
| `standing.fbx` | neutral idle |
| `body-block.fbx` | a block |
| `situp-to-idle.fbx` | lying down to standing, 4.4 s |
| `rockin-shackle-a.fbx` | a dance |

## Why these still do not fix rigging

The export setting was right this time — the mesh, the bind poses and the skin
weights are all there. The character is the problem: it is Mixamo's **Beta
mannequin**, not one of our sculpts. It wears no gi, so it cannot be a fighter,
and its weights cannot be borrowed either:

```
Beta_Surface influences per vertex   1: 13367   2: 495   3: 370
```

94% of its vertices have a single influence. That is not a badly made rig — Beta
is a segmented robot, hard shells plus separate ball joints, and rigid weighting
is correct for it. Transferred onto a smooth body in a kimono it would deform in
blocks, which is worse than the weights `bake-fighter.mjs` computes itself.

**To fix rigging, the character has to be ours.** On mixamo.com: *Upload
Character*, feed it `bjj/art/judo-study-montage.glb` (or the black belt), let the
auto-rigger place the markers, then download **With Skin**. Mixamo's auto-rig
produces smooth weights for an organic mesh — it is the Beta mannequin
specifically that is rigid. That download would replace every estimate the baker
makes: joint placement, weights, bind pose.

## What they are good for

The clips. `tools/mixamo-pose.mjs` captures a frame as a pose in the format
`src/game/poses.js` uses:

```bash
node bjj/tools/mixamo-pose.mjs bjj/art/mixamo/situp-to-idle.fbx --at 1.0 --name SIT_UP
```

Verified against this clip: at 0.0 s it prints a figure flat on its back, at
1.0 s sitting up with a hand posted, at 2.0 s in a crouch, at 4.3 s standing —
which is what the clip does.

Two things to know before leaning on it:

- **It gives one fighter.** A paired pose still needs the other half authored
  against it. Half a pose from motion capture still beats a whole one guessed.
- **Twist is dropped.** The transfer matches bone *directions*, not rotations,
  because the two rigs bind differently — Mixamo in a T-pose, this one with the
  arms hanging. Rotation deltas mean different things in the two rigs and copying
  them folds a standing figure's arms across its chest, which is what the first
  version of the tool did. Directions have no such problem, and roll about a
  limb's own axis is not something a grappling position reads.
