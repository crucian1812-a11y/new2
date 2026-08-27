# Mixamo clips and characters

Six Mixamo exports, all **With Skin**. Two of them are the game's two fighters;
the rest are clips and a mannequin.

| file | what it is | used for |
|---|---|---|
| `body-block.fbx` | a dressed man, Beta rig | **fighter A** — `assets/fighter.bin` |
| `Ch31_nonPBR.fbx` | a dressed man, long hair | **fighter B** — `assets/fighter-b.bin` |
| `passive-marker-man.fbx` | a mocap actor in a marker suit | nothing in the game; see below |
| `standing.fbx` | neutral idle | clip |
| `situp-to-idle.fbx` | lying down to standing, 4.4 s | clip |
| `rockin-shackle-a.fbx` | a dance | clip |

`Ch31_nonPBR.fbx` is 52 MB and is **not in git** — it lives in the repository's
`assets` release, which is where files too big for the web upload go:

```bash
curl -sL -o bjj/art/mixamo/Ch31_nonPBR.fbx \
  https://github.com/crucian1812-a11y/new2/releases/download/assets/Ch31_nonPBR.fbx
node bjj/tools/bake-mixamo.mjs bjj/art/mixamo/Ch31_nonPBR.fbx --out bjj/assets/fighter-b.bin
```

The baked `.bin` files are in git, so nothing here is needed to run the game —
only to re-bake a fighter.

## What each character bakes into

```
fighter A  body-block.fbx    16 851 verts  29 865 tris  455 KB
fighter B  Ch31_nonPBR.fbx   28 854 verts  46 314 tris  750 KB
```

Fighter B costs more because a third of him is hair: 13 124 vertices of it,
modelled as strands. That is also what makes him read as a different man from
across the mat, which is the entire point of having him.

Two things about him that are the source's and not the bake's:

- **His bare feet are stumps**, 14 cm against fighter A's 18. His toes were
  modelled inside his trainers, and the trainers are dropped — this sport is
  barefoot. `asset-check` measures a foot against the rig's own 15 cm now rather
  than against a range calibrated on fighter A, so both men pass, and the
  original disaster this check was written for — 44 cm flippers — still fails.
- **He came in long sleeves.** The baker inflates a gi sleeve out of the bare
  arm; his arm was already covered, so there is nothing to inflate and the
  report says so instead of printing `undefined`.

## `passive-marker-man.fbx` is not a fighter

It is a motion-capture actor in a black suit with reflective markers on it, and
the markers are geometry: little spheres all over the limbs. Baked, he comes out
as a man in a spotted leotard with a gi collar. He is worth keeping as a rig to
test against — his skeleton is clean and his mesh is one piece — but he is not
someone to put on the mat.

## What these files actually contain

```
objects: NodeAttribute:65 Geometry:2 Model:67 Pose:2 Material:2
         Deformer:131 AnimationStack:2 AnimationCurve:315 AnimationCurveNode:54
Geometry "Beta_Surface"  14232 verts  28272 tris  50 clusters
Geometry "Beta_Joints"   10514 verts  20840 tris  39 clusters
clusters: 129            bones: 65    units: centimetres, 181 cm tall
```

## A trap worth knowing: Mixamo numbers the rig

`body-block.fbx` calls its bones `mixamorig:Hips`. `Ch31_nonPBR.fbx` calls them
`mixamorig9:Hips`. The number is per character, and matching the literal prefix
— which the baker did — finds no bones at all in the second file and stops with
every bone reported missing. `mixamo.mjs` now exports `bare()`, which strips
`mixamorig<any digits>:`, and everything matches names through it.

## Why the Beta mannequin still does not fix rigging

The export setting was right — the mesh, the bind poses and the skin weights are
all there. The character is the problem: it is Mixamo's **Beta mannequin**. It
wears no gi, so it cannot be a fighter, and its weights cannot be borrowed
either:

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


## body-block.fbx — the fighter

This is the one the game is built on. A Mixamo character exported **with skin**:
67 bones of the full `mixamorig` skeleton, seven mesh parts, and — the part that
matters — real skin weights, authored rather than guessed.

`bake-mixamo.mjs` reads it directly. Nothing about it is estimated: the joints
are in the file, each bone's bind matrix is in the file as its cluster's
`TransformLink`, and the weights are in the file. All the baker does is say
which mixamorig bone is which of our twenty-four, move the mesh from their rest
pose to ours, and fold sixty-seven bones' worth of weights down onto ours.

The parts are identified by which bones move them and where they sit, not by
name, because the names do not survive the export:

| part | what it becomes |
|---|---|
| body, arms out in a T | skin |
| head shell above the brow | hair |
| two spheres on the eye bones | eyeballs, their own material |
| a thin sheet across the eyes | lashes and brows |
| shirt, trousers | dropped — the gi goes on instead |
| shoes | dropped — this is a barefoot sport |

The gi is built by `body.js` in the rig's own bind pose, which is the space the
retargeted body now lives in, so the two meet with no fitting step. That is the
payoff for warping the character onto our skeleton rather than adopting theirs.

```bash
node bjj/tools/bake-mixamo.mjs bjj/art/mixamo/body-block.fbx \
  --out bjj/assets/fighter.bin --report
node bjj/tools/asset-check.mjs bjj/assets/fighter.bin
```

`--nogi` keeps the clothes the character arrived in.
