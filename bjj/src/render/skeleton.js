// The skeleton, and the one idea the whole game rests on.
//
// You cannot animate grappling one fighter at a time. A guard pass is not
// "fighter A plays pass.anim while fighter B plays getting-passed.anim" — the
// two bodies are a single articulated object with two roots, and the moment
// they drift apart by two centimetres a shin is inside a ribcage and the shot
// is ruined.
//
// So every keyframe in this game is a PAIRED pose: one record holding the
// joint angles of both skeletons plus the offset between their hips. A
// transition is a slerp between two paired poses. Contact is then fixed up by
// IK: each pose declares which hand holds what (a lapel, a wrist, an ankle),
// and the arm chain is solved onto that point after the blend, so the grip
// stays welded through the whole move even while everything else interpolates.

import {
  quat, qIdent, qEuler, qMul, qSlerp, qCopy, qBetween, qFromAxisAngle, m4, m4compose, m4mul,
  m4invRigid, m4dir, v3, v3set, v3copy, v3sub, v3norm, v3len, v3dot, v3cross, clamp,
} from '../core/m4.js';

// name, parent, rest offset from parent's head.
// Y up, +Z is the direction the fighter faces, +X is their left.
// A knuckle row between the palm and the fingertips, and it is the whole of
// what turns a hand into a hand.
//
// A gi grip is four fingers hooked into cloth. Until this the hand was two
// bones — the palm and a tip — and closing it rotated the tip by sixteen
// degrees, which moved six per cent of the hand's vertices by six millimetres.
// The rest of the fingers rode the palm rigidly, so a fist and an open hand
// were the same shape with one segment of one finger bent. Both source
// characters carry a full finger skeleton (Thumb, Index, Middle, Ring, Pinky,
// three joints each) and the bake folded every one of them onto the palm.
//
// One bone per hand, not fifteen. The four fingers move together — in a grip
// they do — and the thumb does not move at all, which is not a shortcut: a gi
// grip is famously thumbless, you hook the cloth with the fingers and the thumb
// stays out of it. So the thumb keeps riding the palm, correctly.
//
// Inserted rather than appended: `pose()` walks this list once and needs every
// parent to come before its child, so the indices below shift and the numbers
// in this table are the only place that matters — everything else looks bones
// up by name. The baked meshes store bone indices and had to be rebaked.
export const BONES = [
  ['hips', -1, [0, 0, 0]],
  ['spine', 0, [0, 0.105, 0]],
  ['chest', 1, [0, 0.145, 0]],
  ['neck', 2, [0, 0.185, 0]],
  ['head', 3, [0, 0.075, 0]],
  ['headTop', 4, [0, 0.2, 0]],

  ['clavL', 2, [0.045, 0.15, 0.005]],
  ['armL', 6, [0.135, 0.0, 0]],
  ['foreL', 7, [0, -0.275, 0]],
  ['handL', 8, [0, -0.245, 0]],
  ['fingL', 9, [0, -0.052, 0.008]],
  ['handLTip', 10, [0, -0.048, 0]],

  ['clavR', 2, [-0.045, 0.15, 0.005]],
  ['armR', 12, [-0.135, 0.0, 0]],
  ['foreR', 13, [0, -0.275, 0]],
  ['handR', 14, [0, -0.245, 0]],
  ['fingR', 15, [0, -0.052, 0.008]],
  ['handRTip', 16, [0, -0.048, 0]],

  ['thighL', 0, [0.085, -0.045, 0]],
  ['shinL', 18, [0, -0.425, 0]],
  ['footL', 19, [0, -0.41, 0]],
  ['toeL', 20, [0, -0.055, 0.15]],

  ['thighR', 0, [-0.085, -0.045, 0]],
  ['shinR', 22, [0, -0.425, 0]],
  ['footR', 23, [0, -0.41, 0]],
  ['toeR', 24, [0, -0.055, 0.15]],
];

export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BONE_COUNT = BONES.length;

// Bones whose segment carries no skin: the tips exist only so the bone before
// them has a direction and a length.
export const TIPS = new Set(['headTop', 'handLTip', 'handRTip', 'toeL', 'toeR']);

// How far a hand is closed, in degrees at the knuckles and again past them.
//
// A hand holding nothing is not flat, and the bind pose is: a Mixamo T-pose has
// the fingers straight and slightly spread, which is a board. That never showed
// while the hand was a palm and a tip — the fingers were one paddle with no gaps
// in it — and the moment they became separate geometry the referee started
// standing at the edge of the mat with two open claws, which is how this was
// found: in a screenshot, not in a number. Measured after the fact, every hand
// in the game that was not on a grip sat at 8.7 degrees of bend, and a hand at
// 8.7 degrees is a plank.
//
// Rest is a hand hanging by a side or held ready; grip is that hand closed on
// cloth. Both are here rather than in the rig because the referee has his own
// skeleton and his own four poses and needs the same answer.
export const HAND_REST = 26, HAND_GRIP = 46;
export const TIP_REST = 14, TIP_GRIP = 34;

const HIP_HEIGHT = 0.94;

export class Skeleton {
  constructor() {
    this.rest = BONES.map((b) => v3(b[2][0], b[2][1], b[2][2]));
    this.parent = BONES.map((b) => b[1]);
    // Each bone's own direction, in its local frame: the way its first child
    // sits. Arms and legs are built pointing down, the spine points up, so
    // there is no single "bone axis" convention to lean on — it has to be read
    // off the rest skeleton, and everything that aims a bone reads it here.
    this.axis = BONES.map(() => v3(0, 1, 0));
    for (let i = BONE_COUNT - 1; i >= 0; i--) {
      const p = BONES[i][1];
      if (p >= 0) v3norm(this.axis[p], this.rest[i]);
    }
    this.local = Array.from({ length: BONE_COUNT }, () => quat());
    this.world = Array.from({ length: BONE_COUNT }, () => m4());
    this.bind = Array.from({ length: BONE_COUNT }, () => m4());
    this.invBind = Array.from({ length: BONE_COUNT }, () => m4());
    this.skin = new Float32Array(BONE_COUNT * 16);
    this.rootPos = v3(0, HIP_HEIGHT, 0);
    this.rootRot = quat();
    this._tmpM = m4();
    this._tmpV = v3();
    this._tmpQ = quat();
    this._rootQ = quat();
    this.computeBind();
    this.pose();
  }

  // The bind pose is the rest skeleton standing at the origin. Every vertex is
  // authored in that space, so the inverse bind is what takes it back to a
  // bone's local frame before the animated world matrix puts it somewhere new.
  computeBind() {
    const t = m4();
    for (let i = 0; i < BONE_COUNT; i++) {
      m4compose(t, IDENT_Q, this.rest[i]);
      if (this.parent[i] < 0) {
        m4compose(this.bind[i], IDENT_Q, [0, HIP_HEIGHT, 0]);
      } else {
        m4mul(this.bind[i], this.bind[this.parent[i]], t);
      }
      m4invRigid(this.invBind[i], this.bind[i]);
    }
  }

  // Walk the hierarchy once, then fold in the inverse bind. Parents always come
  // before children in BONES, so one linear pass is enough — no recursion, no
  // sort, no allocation.
  pose() {
    const t = this._tmpM;
    for (let i = 0; i < BONE_COUNT; i++) {
      if (this.parent[i] < 0) {
        // The root bone carries both: where the fighter is (rootRot) and what
        // their pelvis is doing inside that (local). Dropping the second is
        // what quietly made every `hips:` line in the pose data a no-op.
        qMul(this._rootQ, this.rootRot, this.local[i]);
        m4compose(this.world[i], this._rootQ, this.rootPos);
      } else {
        m4compose(t, this.local[i], this.rest[i]);
        m4mul(this.world[i], this.world[this.parent[i]], t);
      }
    }
    for (let i = 0; i < BONE_COUNT; i++) {
      m4mul(t, this.world[i], this.invBind[i]);
      this.skin.set(t, i * 16);
    }
  }

  boneHead(out, name) {
    const m = this.world[BONE_INDEX[name]];
    return v3set(out, m[12], m[13], m[14]);
  }

  boneAxis(out, name) {
    const i = BONE_INDEX[name];
    return v3norm(out, m4dir(out, this.world[i], this.axis[i]));
  }
}

const IDENT_Q = quat();

/* ---------------------------------------------------------------- poses --- */

// A pose is a plain object: { bone: [x, y, z] } in degrees, plus `root`.
// Missing bones mean "rest", which keeps the data files readable — a mount
// pose only writes the joints that differ from standing.

export function poseToQuats(out, pose) {
  for (let i = 0; i < BONE_COUNT; i++) qIdent(out[i]);
  for (const name in pose.j) {
    const i = BONE_INDEX[name];
    if (i === undefined) continue;
    const e = pose.j[name];
    qEuler(out[i], e[0], e[1], e[2]);
  }
  return out;
}

export function blendQuats(out, a, b, t) {
  for (let i = 0; i < BONE_COUNT; i++) qSlerp(out[i], a[i], b[i], t);
  return out;
}

/* ------------------------------------------------------------------- IK --- */

const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _e = v3(), _f = v3();
const _q = quat(), _q2 = quat();

// Two-bone IK, solved analytically: place the end of a hand/foot chain on a
// world-space target by choosing the elbow (or knee) angle from the law of
// cosines and then swinging the whole chain to point at the goal.
//
// Working in world space and pushing the result back through the parent's
// inverse is more arithmetic than a local-space solve, but it is the only
// version that stays correct when the fighter's root is upside down, which on
// the bottom of side control it very often is.
const _g = v3(), _h = v3(), _i = v3();
// How bent, as the sine of the fold, a pose's limb must be for its side to count.
const FOLD_SURE = Math.sin(10 * Math.PI / 180);
const _kU = quat();
const _kL = quat();

export function solveTwoBone(sk, upper, lower, end, target, poleDir, weight = 1, poleDecides = false) {
  const iU = BONE_INDEX[upper];
  const iL = BONE_INDEX[lower];
  const iE = BONE_INDEX[end];

  sk.boneHead(_a, upper); // shoulder
  sk.boneHead(_b, lower); // elbow
  sk.boneHead(_c, end); // wrist

  const lenU = v3len(v3sub(_d, _b, _a));
  const lenL = v3len(v3sub(_d, _c, _b));

  v3sub(_d, target, _a);
  let dist = v3len(_d);
  const maxReach = (lenU + lenL) * 0.999;
  const minReach = Math.abs(lenU - lenL) * 1.001 + 1e-4;
  dist = clamp(dist, minReach, maxReach);
  v3norm(_d, _d);

  // Where the elbow has to sit for the chain to close on a target `dist` away.
  const cosU = clamp((lenU * lenU + dist * dist - lenL * lenL) / (2 * lenU * dist), -1, 1);
  const angU = Math.acos(cosU);

  // Bend plane: the goal direction crossed with the pole vector. With no pole
  // given, the pole is wherever the authored pose already put the elbow, which
  // is the behaviour you want almost always — the pose decides how the arm is
  // bent, and IK only decides where the hand ends up.
  if (poleDir) v3copy(_f, poleDir);
  else v3sub(_f, _b, _a);
  v3norm(_f, _f);
  v3cross(_e, _d, _f);
  if (v3len(_e) < 1e-4) {
    // Pole parallel to the goal: any perpendicular will do, and the arm was
    // straight anyway so nothing visible depends on the choice.
    v3set(_e, -_d[1], _d[0], _d[2]);
    v3cross(_e, _d, _e);
  }
  v3norm(_e, _e);

  // Upper-bone direction = goal direction rotated by angU about the bend axis.
  //
  // Two solutions, and the sign of the axis decides which. The plane normal was
  // taken as the goal crossed with the arm's current direction, and once the
  // first pass has swung the arm towards the target those two are nearly
  // parallel — so on the second and third pass the cross product is almost
  // nothing, its direction is noise, and the elbow lands on whichever side the
  // noise pointed. That is where the backwards elbows came from: authored at
  // -82 degrees, the back's right elbow came out of the IK at +155.
  //
  // Both candidates are computed and the one that leaves the elbow nearer to
  // where the pose put it wins. It needs no anatomy and no per-joint table, and
  // it is what the paragraph above always meant: the pose decides how the arm
  // is bent, IK decides where the hand ends up.
  //
  // Unless the caller says the pole decides, and then it does. The rule above
  // reads the side off the pose, and for an arm reaching a lapel that is
  // exactly right — the grips pass their pole precisely so that all three
  // passes solve the *same* shape of arm, and the side still comes from where
  // the pose put the elbow. For a leg swinging through a stride it is exactly
  // wrong: the pose's knee stays where the walk pose put it while the line from
  // hip to foot rotates past it, the two candidates become equally near half
  // way through the step, and the knee snaps twenty-eight centimetres backwards
  // once per pace. That is what the walkout's judge found on its first run.
  //
  // So it is a separate thing to ask for rather than a new meaning for the
  // pole: asking for it here changed one arc in the graph by a millimetre of
  // mat, which is a fight changing because a title card was written.
  rotAbout(_f, _d, _e, angU);
  rotAbout(_g, _d, _e, -angU);
  const near = (v) => {
    const ex = _a[0] + v[0] * lenU - _b[0];
    const ey = _a[1] + v[1] * lenU - _b[1];
    const ez = _a[2] + v[2] * lenU - _b[2];
    return ex * ex + ey * ey + ez * ez;
  };
  // Nearer is not the same as folded the same way, and where the two part it
  // is the fold that matters. The candidates are mirror images across the
  // line from the shoulder to the target, so when the target lies across the
  // upper arm from where the pose had the hand, the elbow nearer the pose's
  // is the one bent the other way round. That is where hinge-check's elbows
  // folded backwards came from: the poses had every one of them folded
  // forwards, 75 to 144 degrees, and the grips turned them to -90 and -178 —
  // the back's bottom man, the choking arm of the rear naked choke, the mount.
  // So the candidate that folds to the same side as the pose wins, read off
  // the plane both lie in; nearer decides only when the pose's own arm is too
  // straight, or bent too far out of that plane, to have a side.
  //
  // For a candidate v the fold is v × (target − elbow) = dist · v × d, which is
  // −e for the first and +e for the second, both times sin angU.
  v3sub(_h, _b, _a);
  v3sub(_i, _c, _b);
  v3cross(_h, _h, _i);
  const fold = v3dot(_e, _h) / Math.max(1e-6, lenU * lenL);
  if (poleDecides && poleDir) {
    // Which candidate puts the joint on the side the caller asked for.
    const side = (v) => v[0] * poleDir[0] + v[1] * poleDir[1] + v[2] * poleDir[2];
    if (side(_g) > side(_f)) v3copy(_f, _g);
  } else if (Math.abs(fold) > FOLD_SURE) {
    if (fold > 0) v3copy(_f, _g);
  } else if (near(_g) < near(_f)) v3copy(_f, _g);

  // Solved whole, then eased into — rather than each bone eased separately.
  //
  // The two aims used to take `weight` one at a time, and that is not the same
  // thing: the upper bone stops part of the way to its solution while the
  // forearm is aimed all the way at the target from wherever the elbow actually
  // ended up, so the joint between them has to make up the difference. At half
  // weight it made it up by folding past what an elbow does, and sometimes by
  // folding the other way — joint-check counted 3672 samples bending backwards
  // with the grips on against 288 with them off.
  //
  // Both ends of this interpolation are now poses that exist: the authored one
  // and the fully solved one. Sliding between them cannot invent a joint that
  // is in neither.
  qCopy(_kU, sk.local[iU]);
  qCopy(_kL, sk.local[iL]);

  applyWorldAim(sk, iU, _f, 1);
  sk.poseFrom(iU);
  // With the shoulder placed, the elbow's new world position is known; aim the
  // forearm straight at the target from there.
  sk.boneHead(_b, lower);
  v3sub(_f, target, _b);
  v3norm(_f, _f);
  applyWorldAim(sk, iL, _f, 1);

  if (weight < 0.999) {
    qSlerp(sk.local[iU], _kU, sk.local[iU], weight);
    qSlerp(sk.local[iL], _kL, sk.local[iL], weight);
  }
  sk.poseFrom(iU);
  unroll(sk, iU, iL, lower.startsWith('fore') ? ROLL_FORE : ROLL_SHIN);
  return iE;
}

// The roll a hinge does not have.
//
// Both aims above are shortest-arc turns, and a shortest arc adds no twist of
// its own — but two of them in a chain do, because the second bone's roll is
// read against a parent the first one has already turned. Nothing noticed,
// because nothing measured roll: `joint-check` asks how far a joint is folded
// and deliberately not which way. A player looking at an overhead mount noticed
// instead, and tools/twist-check.mjs put a number on it — 212 of 760 joints
// past what a person can do with the grips on, 2 of 120 with them off. The
// solver, not the author.
//
// A forearm's roll against the upper arm is pronation and a person has about
// eighty-five degrees of it either way; a shin has almost none. Past that, the
// excess is taken back out.
//
// This costs the chain nothing. Turning a bone about its own length leaves its
// direction alone, and the next joint's head sits on that length — so the hand
// ends up on the same lapel it was welded to, holding it the right way round.
const ROLL_FORE = (85 * Math.PI) / 180;
const ROLL_SHIN = (40 * Math.PI) / 180;
const _rAxis = v3(), _qRoll = quat();

// The four hinges, applied as the last word of a frame.
//
// Doing it inside the two-bone solve fixes what the solve did and nothing
// else, and the solve is not the only thing that rolls a bone: a blend between
// two poses whose forearms are rolled differently slerps straight through the
// middle, and the middle can be past the limit even when both ends are inside
// it. That took the count from 212 joints to 170 and left fifteen still
// reading as a break. Run last, over all four hinges, and it is the frame's
// answer that gets checked rather than one step of it.
const HINGES = [['armL', 'foreL', 1], ['armR', 'foreR', 1], ['thighL', 'shinL', 0], ['thighR', 'shinR', 0]];

export function clampHinges(sk) {
  for (const [up, lo, isArm] of HINGES) {
    unroll(sk, BONE_INDEX[up], BONE_INDEX[lo], isArm ? ROLL_FORE : ROLL_SHIN);
  }
}

// Which way a knee and an elbow fold, as the skin sees it.
//
// A two-bone solve puts the elbow and the wrist where they have to be and has
// no opinion about how the upper arm is turned about its own length — and the
// skin is carried in exactly that turn: the kneecap is on the front of the
// thigh bone's frame, the crook of the elbow on the front of the upper arm's.
// Left to chance, a third of the positions had a forearm folded backwards
// against its own upper arm, some by more than a right angle, and knees bent
// sideways by up to 72° (tools/hinge-check.mjs); a player called it limbs bent
// the way limbs do not bend.
//
// Every point of the limb is kept. The upper bone is turned about its own
// length — which moves neither end of it — until the lower bone lies in its
// front plane (an elbow folds forwards, a knee back), and the lower bone and
// the hand or foot at the end of it keep the world orientation they had, so a
// grip stays a grip and a planted foot stays planted. What changes is the turn
// in the shoulder and the hip, which is where a person makes that turn. A limb
// that is nearly straight has no fold to put anywhere and is left alone,
// fading in over the first few degrees so nothing snaps as it bends.
//
// `keep` names lower bones whose roll is left alone as well — a forearm whose
// sleeve, or a shin whose knee, is in somebody's hand: turned about its length
// it would carry the point out of the grip.
// Such a limb is only turned as far as its own twist allows: past that the
// elbow reads as wrung like a towel, which is worse than a fold slightly off.
//
// And the upper bone is only turned as far as its own socket turns — a hip
// about 45° either way, a shoulder about 90 — or, where the pose already had
// it past that, no further. Where a knee could only fold straight back with
// the thigh turned 160° in the hip (joint-check), it folds as far round as the
// hip allows and the rest is the pose's to fix, offline, where a pose is
// fixed (pose-relax, LIMB_W).
const SOCKET = { thighL: 50, thighR: 50, armL: 100, armR: 100 };
export function swivelHinges(sk, keep = null) {
  for (const [up, lo, isArm] of HINGES) {
    const limit = isArm ? ROLL_FORE : ROLL_SHIN;
    swivel(sk, BONE_INDEX[up], BONE_INDEX[lo], BONE_INDEX[SWIVEL_END[lo]],
      isArm ? 1 : -1, limit, !!(keep && keep.has(lo)), SOCKET[up] * Math.PI / 180);
  }
}
const SWIVEL_END = { foreL: 'handL', foreR: 'handR', shinL: 'footL', shinR: 'footR' };
// How far a hand or a foot turns from rest, radians — joint-check's ranges.
const END_TURN = {};
for (const [n, deg] of [['handL', 90], ['handR', 90], ['footL', 65], ['footR', 65]]) END_TURN[BONE_INDEX[n]] = deg * Math.PI / 180;
const localTurn = (sk, i) => 2 * Math.acos(Math.min(1, Math.abs(sk.local[i][3])));
const _sqC = [0, 0, 0, 1];
const _sa = v3(), _sw = v3(), _sd = v3(), _sx = v3();
const _sqU = quat(), _sqL = quat(), _sqE = quat(), _sqR = quat(), _sqP = quat(), _sqT = quat();

function setWorldQ(sk, i, q) {
  const p = sk.parent[i];
  if (p < 0) return;
  quatFromMat(_sqP, sk.world[p]);
  _sqP[0] = -_sqP[0]; _sqP[1] = -_sqP[1]; _sqP[2] = -_sqP[2];
  qMul(sk.local[i], _sqP, q);
  sk.poseFrom(i);
}

// The lower bone's twist about its own length relative to the upper, radians.
function twistOf(sk, iU, iL) {
  m4dir(_rAxis, sk.world[iL], sk.axis[iL]);
  v3norm(_rAxis, _rAxis);
  quatFromMat(_qU2, sk.world[iU]);
  quatFromMat(_qL2, sk.world[iL]);
  _qInv2[0] = -_qU2[0]; _qInv2[1] = -_qU2[1]; _qInv2[2] = -_qU2[2]; _qInv2[3] = _qU2[3];
  qMul(_qRel, _qL2, _qInv2);
  const d = _qRel[0] * _rAxis[0] + _qRel[1] * _rAxis[1] + _qRel[2] * _rAxis[2];
  const ang = 2 * Math.atan2(d, _qRel[3]);
  return Math.atan2(Math.sin(ang), Math.cos(ang));
}

function swivel(sk, iU, iL, iE, sign, limit, keep, socket) {
  v3norm(_sa, m4dir(_sa, sk.world[iU], sk.axis[iU]));
  v3norm(_sw, m4dir(_sw, sk.world[iL], sk.axis[iL]));
  const mU = sk.world[iU];
  // The front of the upper bone: its own +z, forwards for an elbow's fold and
  // backwards for a knee's.
  _sd[0] = mU[8] * sign; _sd[1] = mU[9] * sign; _sd[2] = mU[10] * sign;
  const wa = v3dot(_sw, _sa), da = v3dot(_sd, _sa);
  for (let k = 0; k < 3; k++) { _sw[k] -= _sa[k] * wa; _sd[k] -= _sa[k] * da; }
  const bent = Math.hypot(_sw[0], _sw[1], _sw[2]);
  if (bent < 0.1) return;
  v3cross(_sx, _sd, _sw);
  let rho = Math.atan2(v3dot(_sa, _sx), v3dot(_sd, _sw));
  const u = Math.min(1, (bent - 0.1) / 0.15);
  rho *= u * u * (3 - 2 * u);
  if (Math.abs(rho) < 0.005) return;
  quatFromMat(_sqL, sk.world[iL]);
  quatFromMat(_sqE, sk.world[iE]);
  quatFromMat(_sqU, mU);
  const iP = sk.parent[iU];
  // What turning the upper bone may cost: its own turn in its socket, and —
  // for a lower bone that is held still — the twist at the joint below, which
  // every radian of the turn adds to. Each stays inside its range or, where
  // the pose was already past it, no worse.
  const socketRoom = Math.max(socket, Math.abs(twistOf(sk, iP, iU)));
  const jointRoom = keep ? Math.max(limit, Math.abs(twistOf(sk, iU, iL))) : Infinity;
  const turn = (r) => {
    qFromAxisAngle(_sqR, _sa[0], _sa[1], _sa[2], r);
    qMul(_sqT, _sqR, _sqU);
    setWorldQ(sk, iU, _sqT);
    setWorldQ(sk, iL, _sqL);
  };
  const fits = () => Math.abs(twistOf(sk, iP, iU)) <= socketRoom &&
    (!keep || Math.abs(twistOf(sk, iU, iL)) <= jointRoom);
  turn(rho);
  if (!fits()) {
    // As much of the turn as fits, found by halving: a twist wraps at a half
    // turn, so it is not a straight line in the turn.
    let lo = 0, hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      turn(rho * mid);
      if (fits()) lo = mid; else hi = mid;
    }
    turn(rho * lo);
  }
  if (!keep) unroll(sk, iU, iL, limit);
  // The hand or foot back to where it faced — as far as the wrist or the ankle
  // turns (joint-check's ranges). What the forearm's turn carried it through
  // past that stays: a hand pointing a few degrees off is a hand, a wrist bent
  // past a wrist is not.
  const endRoom = END_TURN[iE];
  quatFromMat(_sqP, sk.world[iE]);
  const carried = _sqC; carried[0] = _sqP[0]; carried[1] = _sqP[1]; carried[2] = _sqP[2]; carried[3] = _sqP[3];
  const room = Math.max(endRoom, localTurn(sk, iE));
  setWorldQ(sk, iE, _sqE);
  if (localTurn(sk, iE) > room) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      qSlerp(_sqT, carried, _sqE, mid);
      setWorldQ(sk, iE, _sqT);
      if (localTurn(sk, iE) > room) hi = mid; else lo = mid;
    }
    qSlerp(_sqT, carried, _sqE, lo);
    setWorldQ(sk, iE, _sqT);
  }
}

function unroll(sk, iU, iL, limit) {
  m4dir(_rAxis, sk.world[iL], sk.axis[iL]);
  v3norm(_rAxis, _rAxis);
  // Swing and twist, separated properly.
  //
  // The first version took one column of each bone's world matrix, flattened
  // both across the lower bone's length and measured the angle between them.
  // That is not the roll: with the joint bent, the relative rotation carries
  // swing as well as twist, and different columns give different answers — X
  // said one thing and Z another about the same elbow. The decomposition below
  // is the standard one and has no such choice in it: the part of the relative
  // rotation that lies along the axis is the twist, and everything else is not.
  quatFromMat(_qU2, sk.world[iU]);
  quatFromMat(_qL2, sk.world[iL]);
  _qInv2[0] = -_qU2[0]; _qInv2[1] = -_qU2[1]; _qInv2[2] = -_qU2[2]; _qInv2[3] = _qU2[3];
  qMul(_qRel, _qL2, _qInv2);
  const d = _qRel[0] * _rAxis[0] + _qRel[1] * _rAxis[1] + _qRel[2] * _rAxis[2];
  const ang = 2 * Math.atan2(d, _qRel[3]);
  const wrapped = Math.atan2(Math.sin(ang), Math.cos(ang));
  if (Math.abs(wrapped) <= limit) return;
  const back = (Math.abs(wrapped) - limit) * (wrapped > 0 ? -1 : 1);
  qFromAxisAngle(_qRoll, _rAxis[0], _rAxis[1], _rAxis[2], back);
  const p = sk.parent[iL];
  if (p < 0) return;
  quatFromMat(_q2, sk.world[p]);
  const inv = _qInv;
  inv[0] = -_q2[0]; inv[1] = -_q2[1]; inv[2] = -_q2[2]; inv[3] = _q2[3];
  qMul(_qA, inv, _qRoll);
  qMul(_qB, _qA, _q2);
  qMul(sk.local[iL], _qB, sk.local[iL]);
  sk.poseFrom(iL);
}
const _qU2 = quat(), _qL2 = quat(), _qInv2 = quat(), _qRel = quat();

function rotAbout(out, v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dot = v3dot(axis, v);
  v3cross(_tmpCross, axis, v);
  out[0] = v[0] * c + _tmpCross[0] * s + axis[0] * dot * (1 - c);
  out[1] = v[1] * c + _tmpCross[1] * s + axis[1] * dot * (1 - c);
  out[2] = v[2] * c + _tmpCross[2] * s + axis[2] * dot * (1 - c);
  return out;
}
const _tmpCross = v3();

// Turn a bone so it points along `dir` in world space, expressed as a change to
// its local rotation. Exported because retargeting needs exactly this: aiming a
// bone at a direction taken from another rig is what makes the two rigs' rest
// poses stop mattering.
export function aimBone(sk, name, dir, weight = 1) {
  applyWorldAim(sk, BONE_INDEX[name], dir, weight);
  sk.poseFrom(BONE_INDEX[name]);
}

function applyWorldAim(sk, i, dir, weight) {
  m4dir(_aim, sk.world[i], sk.axis[i]); // where the bone currently points
  v3norm(_aim, _aim);
  qBetween(_q, _aim, dir);
  if (weight < 1) qSlerp(_q, IDENT_Q, _q, weight);

  // Move that world-space delta into the bone's local frame: local' =
  // parentWorldRot^-1 * delta * parentWorldRot * local.
  const p = sk.parent[i];
  if (p < 0) {
    qMul(sk.rootRot, _q, sk.rootRot);
    return;
  }
  quatFromMat(_q2, sk.world[p]);
  const inv = _qInv;
  inv[0] = -_q2[0]; inv[1] = -_q2[1]; inv[2] = -_q2[2]; inv[3] = _q2[3];
  qMul(_qA, inv, _q);
  qMul(_qB, _qA, _q2);
  qMul(sk.local[i], _qB, sk.local[i]);
}
const _aim = v3();
const _qInv = quat(), _qA = quat(), _qB = quat();

export function quatFromMat(out, m) {
  // Assumes an orthonormal 3x3; every matrix here is rigid.
  const m00 = m[0], m01 = m[4], m02 = m[8];
  const m10 = m[1], m11 = m[5], m12 = m[9];
  const m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[3] = 0.25 * s;
    out[0] = (m21 - m12) / s;
    out[1] = (m02 - m20) / s;
    out[2] = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[3] = (m21 - m12) / s;
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[3] = (m02 - m20) / s;
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[3] = (m10 - m01) / s;
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
  }
  return out;
}

// Re-run the hierarchy from one bone downwards. IK edits a shoulder and then
// immediately needs the elbow's new world position; recomputing all 24 bones
// twice per arm per fighter per frame is waste the phone can feel.
Skeleton.prototype.poseFrom = function (start) {
  const t = this._tmpM;
  for (let i = start; i < BONE_COUNT; i++) {
    if (this.parent[i] < 0) {
      qMul(this._rootQ, this.rootRot, this.local[i]);
      m4compose(this.world[i], this._rootQ, this.rootPos);
    } else if (i >= start) {
      m4compose(t, this.local[i], this.rest[i]);
      m4mul(this.world[i], this.world[this.parent[i]], t);
    }
  }
};

Skeleton.prototype.finishSkin = function () {
  const t = this._tmpM;
  for (let i = 0; i < BONE_COUNT; i++) {
    m4mul(t, this.world[i], this.invBind[i]);
    this.skin.set(t, i * 16);
  }
};
