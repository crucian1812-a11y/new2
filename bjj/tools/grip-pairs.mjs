// Which overlaps the pose asked for.
//
// Every position in this library is two people holding each other, and each one
// says where: `grips` is a list of «this hand, on that point of the other man»
// — a collar tie, a frame across the throat, a figure-four on a wrist — and
// `hold` says which parts have to stay near which. The rig obeys the grips with
// IK, so wherever the point lands is where the hand goes.
//
// The collision measure knows none of that. It sees capsules, and the capsule
// for a head is a ball wide enough to cover a jaw and a throat: GRIP_POINTS
// puts the neck point seven centimetres in front of the neck bone, which is
// eight centimetres from the head bone inside a capsule ten wide. A hand on the
// throat is eight centimetres inside the skull the moment it arrives, and no
// amount of authoring moves it, because the target is inside the capsule and
// the hand has to be on the target.
//
// Measured over the library: the deepest overlap anywhere is 8.0 cm and the
// deepest one nobody asked for is 5.1. Every single 8 is a declared grip — side
// control's frame, the clinch's collar tie, the guillotine — and they are all
// the same contact, a forearm across a throat.
//
// pose-check has known this since a pose failed by two millimetres on exactly
// that pair. What it could not do is tell the solver, which was paying for
// `pen.sum` on every evaluation and so being pushed to undo the grips the same
// pose declares, against an intent term weighted four hundred to keep them.
// Both read this now, so «a contact the pose asked for» has one definition.
//
// Found the way the collider would, by asking which capsules the point is
// actually in — not by naming the bone it hangs off. The point is a place, and
// the capsule model does not respect bone names.
import { POSES } from '../src/game/poses.js';
import { GRIP_POINTS } from '../src/render/body.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { m4point, v3 } from '../src/core/m4.js';

// How deep a declared contact may be, against two centimetres of squash
// everywhere else. Past this an arm is through a skull rather than against it.
export const GRIP_ALLOW = 0.12;

const _t = v3();

// How far from a grip point a capsule still counts as under the hand.
const PALM = 0.05;

// Both orderings folded into one key: the collider reports «A.foreL in B.head»
// and which of the two it names first is its business.
export const pairKey = (where) => (where || '').replace(' in ', '|').split('|').sort().join('|');

// The pairs this pose declared, for the skeletons as they currently stand.
//
// `overlap` is a live Overlap instance — the caller's, so the capsule table is
// the same one the measurement uses.
export function declaredPairs(skel, id, overlap) {
  const out = new Set();
  const pose = POSES[id];
  if (!pose) return out;
  for (const h of pose.hold || []) {
    if (h.of && h.near) out.add([h.of, h.near].sort().join('|'));
  }
  for (const g of pose.grips || []) {
    const def = GRIP_POINTS[g.point];
    // A hand on the man's own other wrist — a seatbelt, a gable grip — says
    // nothing about the pair of bodies, and this measure only ever compares one
    // man against the other.
    if (!def || g.self) continue;
    const held = g.role === 'A' ? 'B' : 'A';
    m4point(_t, skel[held].world[BONE_INDEX[def[0]]], def[1]);
    // The forearm as well as the hand, and it is the forearm that matters: a
    // hand capsule is four centimetres and stops at the point, a forearm ends
    // at the hand and so has its own tip in there too, seven centimetres wide.
    const arm = g.hand === 'L' ? ['handL', 'foreL'] : ['handR', 'foreR'];
    // Within a palm of the point, not strictly inside it. A grip point is a
    // place on somebody's surface — a lapel, a hip, a sleeve — and asking which
    // capsules strictly contain it answered «none» for four of the mount's four
    // grips and three of side control's four. The hand is four centimetres
    // thick and the forearm seven; five is what a hand laid on a place is
    // pressed against.
    for (const bone of overlap.contains(skel[held], _t, PALM)) {
      for (const own of arm) out.add([`${g.role}.${own}`, `${held}.${bone}`].sort().join('|'));
    }
  }
  return out;
}
