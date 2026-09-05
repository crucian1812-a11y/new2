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

## What was done about it, in the round after

Two waypoints, and a bug in the tool that was supposed to find them.

**The bug first, because it explains why the study concluded what it did.**
`route-arc` and `via-pick` both threw away any route that let the pair's nearest
points get more than thirty centimetres apart — a sound rule between two
tangles, and nonsense for a transition out of the stance, where the pair
*begins* a metre and a third apart. So every candidate route for the four blends
that come out of standing was rejected before it was measured, and the straight
line, which was exempt from the test, won by walkover. That is why "every pose
in the library as a waypoint" came back with nothing: it never tried one. The
rule is relative now — a route may not pull them apart more than the movement
does on its own.

**The waypoints.** GUARD_ENTRY (the middle of falling into a guard) and
GUARD_RECOVER (the middle of getting one back from under a mount) are not typed
by hand: `tools/waypoint-from.mjs` lifts the pair out of the blend at the moment
before the crossing and prints it as a pose, and `pose-relax` then pushes the
limbs out of each other while keeping the rest. The shape the movement already
had, minus the collision. Each carries the sentence the straight line cannot
say, as an intent constraint:

    { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.10 }

— the man going underneath has a knee **either side** of the other man's hips,
rather than both on one side with the thighs interleaved.

| transition | was | now | via |
| --- | --- | --- | --- |
| STANDING>CLOSED_GUARD_X | 20 cm | **7 cm** | SIDE_ENTRY@late+A |
| CLINCH>CLOSED_GUARD_X   | 20 cm | **14 cm** | GUARD_ENTRY@late |
| STANDING>OPEN_GUARD_X   | 21 cm | **17 cm** | SIDE_ENTRY@late+A |
| MOUNT>CLOSED_GUARD_X    | 21 cm | **20 cm** | GUARD_ENTRY@early |

The worst moment in the whole graph is 20 cm, down from 22, and nothing is too
deep to ship. Two of the four are won by a pose that already existed and could
not be tried; two by GUARD_ENTRY. GUARD_RECOVER has not won a route yet — it is
in the library, measured and clean, and if it never wins one it should go.

MOUNT>CLOSED_GUARD_X is routed through GUARD_ENTRY@early rather than
@early+A, which is two centimetres deeper: the deeper of the two is the one that
keeps an elbow inside 155 degrees, and joint-check is a line while twenty
centimetres is a work list.

## What remains, and why

The four are at 7, 14, 17 and 20 cm and none of them blocks shipping. What is
left is the same shape of work, one level down:

- `MOUNT>CLOSED_GUARD_X` at 20 cm and `STANDING>OPEN_GUARD_X` at 17 are the two
  the waypoints helped least. Both fail at the very ends now — t = 0.05 and
  t = 0.97 — which is a different complaint from the one this study opened
  with: not a limb sweeping through a body in mid-flight, but the first and
  last frames of a movement disagreeing with the pose they start and end on.
- `GUARD_RECOVER` has yet to win a route. Either a transition is found that
  wants it, or it goes: an unused pose in the library is a pose nobody measures.
- The remaining fourteen on the work list sit between 11 and 18 cm, and none of
  them has been through `route-arc` since the filter was fixed. That is the
  cheapest measured win available and it is a machine's work, not an author's.

## И ещё раз, после того как позы поменяли линейку

Всё выше меряло переходы против поз, которые с тех пор сдвинулись: круг, где
решателю поз отдали настоящую кожу (см. `PLAN.md`), подвинул каждую позу в
библиотеке — где-то на миллиметры, где-то на сантиметры, — и все дуги были
пересчитаны с нуля против новых концов (`arc-all.mjs`, все 81 за 34.6 минут
на четырёх ядрах).

Числа после пересчёта: худший момент в полёте **20 см**, в списке работ
**8** (было 14 до того, как стена по сгибу и освобождённый сторож попали во все
дуги, а не в одну), за чертой «нельзя выпускать» — ни одного. Самый крупный выигрыш достался
`MOUNT>HALF_GUARD`: 14 → **6 см**, и не от нового поиска, а оттого, что сторож
наконец перестал защищать дугу, которая сама была за чертой — она складывала
чужой локоть на 158° при потолке в 155, и каждый ответ лучше отвергался за
сантиметр пересечения.

Таблицы выше оставлены как есть: они про то, **почему** переход ломается и что
с этим делают, и это не изменилось. Числа в них — прошлого круга.
