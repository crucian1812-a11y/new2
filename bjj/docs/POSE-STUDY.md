# Why some moments look unnatural mid-fight

A study of the transitions that read as "wrong" while the fight is moving, and
what was done about them. Driven by measurements, not by eye: the same
capsules `collide.js` builds the mesh from are the ruler, and the number is
`blend-check.mjs`'s worst penetration for each of the sixty-one transitions
plus twenty hold loops.

## The ruler

- A few centimetres of overlap is contact — two people in a grappling
  position genuinely share space, and it reads as pressure.
- Past about **8 cm** a limb is inside a body and it starts to look wrong.
- `blend-check` reports everything over **11 cm** (the work list) and fails a
  transition only over **22 cm** (where it is plainly seen).

## What was found

The four worst moments in the whole graph are all the same failure, in the
same place — a thigh travelling *through* the other man's thigh:

| transition | worst | at t | bones |
| --- | --- | --- | --- |
| STANDING>OPEN_GUARD_X   | 20 cm | 0.85 | A.thighR in B.thighL |
| STANDING>CLOSED_GUARD_X | 20 cm | 0.95 | A.thighL in B.thighR |
| MOUNT>CLOSED_GUARD_X    | 20 cm | 0.17 | A.thighR in B.thighL |
| MOUNT>KIMURA            | 19 cm | 0.65 | A.thighR in B.thighR |

The geometry was read off with a step tool (`tools/` experiments, printed as
world-space hip/knee/ankle positions per sample). The three 20 cm cases are
one mechanism: during a role reversal the two men's thighs occupy the *same
lateral band*, and the straight-line blend between the two authored poses
sweeps one through the other. Concretely:

- **Double leg / pull guard** (STANDING → a guard): the standing man's legs
  stay extended while he falls, so his thigh swings out to x ≈ 0.24 and back
  through the shooter's thigh at x ≈ 0.08–0.22 as the guard folds. The fold
  happens too late on the straight line.
- **Recovering guard from mount** (MOUNT → CLOSED_GUARD_X): the bottom man's
  left leg swings up to wrap the waist and crosses the top man's right thigh
  at t = 0.17, right at the start.

## What was tried

- **`arc-solve`** (the per-transition push/turn/joint lobes) — widened to
  `ARC_LIMIT=0.20 ARC_TWIST=32 ARC_BONES=8`. Fixed the sweep
  (`OPEN_GUARD>MOUNT_X`, below), came back worse on the thigh crossings.
- **Single-limb lobe sweep** — every thigh of both roles, each of three axes,
  ±6/12/18° in the late lobe. Best result 19.2 cm; the crossing is a path
  problem, not a posture problem, and a nudge cannot route a limb around a
  body.
- **`route-arc` / `via-pick`** — every pose in the library as a waypoint, at
  early/mid/late timing, role-restricted and not. Best candidate
  (`RNC@late+A`) only reaches 18.5 cm.
- **A first waypoint pose** (`GUARD_ENTRY`, the middle of falling into guard,
  legs folding early) — swept 486 parameter combinations. Every one was
  *worse* than the straight line: folding the guard player's legs early lifts
  his knees into the descending top man's chest (`A.chest in B.thighR`). The
  move trades one collision for another unless the top man's whole descent is
  authored to match.

This is exactly the situation the pose library already documents for
`ACROSS`, `MOUNT_ENTRY` and `SIDE_ENTRY`: a waypoint that swells in the
middle can shove two bodies apart, but it cannot route a limb around one —
the answer is a *different path*, authored as a waypoint pose, and none of the
existing ones is the right middle for these three.

## What shipped

- **`OPEN_GUARD>MOUNT_X`** (the guard sweep to mount) dropped **17 cm → 9 cm**
  with the widened solver, leaving the work list. It was the deepest of the
  transitions a player actually drives on purpose, and it is gone.

## What remains, and why

The three 20 cm thigh crossings (plus `MOUNT>KIMURA` at 19 cm) sit just under
the 22 cm "plainly seen" line, so they do not block shipping, and no numeric
search moves them. Each needs a dedicated waypoint pose authored against the
rendered skeleton — the true middle of the movement:

- the *drop into guard* (top man's legs already between/outside, guard
  player's legs folding as he lands), and
- the *guard recovery from mount* (bottom man's legs coming inside as the top
  man's hips lift).

That is art work with visual feedback (the `smoke`/`shot` tools under a
browser), not a blind search; the measurements above pin down exactly which
limb must go around which, so the waypoint has a target to hit. Until then
these three are the honest worst of the graph, and everything else is at or
under 18 cm.
