// Kleine Mathematik-Bibliothek — small math helpers used across the engine.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed angular difference from a to b, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleTowards(a, b, maxStep) {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export function angleLerp(a, b, t) {
  return a + angleDelta(a, b) * t;
}

/** Normalises a vector in place-ish, returning {x,y,len}. */
export function norm(x, y) {
  const l = Math.hypot(x, y);
  if (l < 1e-6) return { x: 0, y: 0, len: 0 };
  return { x: x / l, y: y / l, len: l };
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** Circle vs circle overlap test. */
export const circlesOverlap = (ax, ay, ar, bx, by, br) =>
  dist2(ax, ay, bx, by) < (ar + br) * (ar + br);

/**
 * Is point p inside the cone with apex at (ox,oy), facing `facing`,
 * half-angle `halfArc`, of length `range`?
 */
export function inCone(ox, oy, facing, halfArc, range, px, py, pr = 0) {
  const dx = px - ox;
  const dy = py - oy;
  const d = Math.hypot(dx, dy);
  if (d > range + pr) return false;
  if (d < 1e-4) return true;
  const a = Math.atan2(dy, dx);
  const delta = Math.abs(angleDelta(facing, a));
  // Widen the arc for close targets so touching enemies are always hit.
  const widen = Math.atan2(pr, Math.max(d, 1));
  return delta <= halfArc + widen;
}

/** Distance from point p to segment ab. */
export function pointSegmentDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  const t = l2 < 1e-6 ? 0 : clamp01(((px - ax) * abx + (py - ay) * aby) / l2);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Formats large numbers compactly: 12345 -> "12.3k". */
export function fmtNum(n) {
  n = Math.round(n);
  if (n < 1000) return String(n);
  if (n < 100000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1e6) return Math.round(n / 1000) + 'k';
  return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
}
