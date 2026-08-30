// Minimal 3D maths: column-major mat4, quaternion, vec3.
//
// Column-major to match WebGL's uniformMatrix4fv without a transpose. Every
// function that returns a matrix writes into an `out` you hand it, because the
// pose solver runs over ~30 bones every frame for two fighters and allocating
// there is the difference between a steady 60 and a sawtooth.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (a, b, t) => smooth(clamp((t - a) / (b - a), 0, 1));

/* ---------------------------------------------------------------- vec3 --- */

export const v3 = (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]);

export function v3set(o, x, y, z) {
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
}
export function v3copy(o, a) {
  o[0] = a[0];
  o[1] = a[1];
  o[2] = a[2];
  return o;
}
export function v3add(o, a, b) {
  o[0] = a[0] + b[0];
  o[1] = a[1] + b[1];
  o[2] = a[2] + b[2];
  return o;
}
export function v3sub(o, a, b) {
  o[0] = a[0] - b[0];
  o[1] = a[1] - b[1];
  o[2] = a[2] - b[2];
  return o;
}
export function v3scale(o, a, s) {
  o[0] = a[0] * s;
  o[1] = a[1] * s;
  o[2] = a[2] * s;
  return o;
}
export function v3lerp(o, a, b, t) {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3len = (a) => Math.hypot(a[0], a[1], a[2]);
export function v3norm(o, a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  o[0] = a[0] / l;
  o[1] = a[1] / l;
  o[2] = a[2] / l;
  return o;
}
export function v3cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
}
export const v3dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ------------------------------------------------------------ quaternion - */

export const quat = (x = 0, y = 0, z = 0, w = 1) => new Float32Array([x, y, z, w]);

export function qIdent(o) {
  o[0] = o[1] = o[2] = 0;
  o[3] = 1;
  return o;
}

export function qCopy(o, a) {
  o[0] = a[0];
  o[1] = a[1];
  o[2] = a[2];
  o[3] = a[3];
  return o;
}

// YXZ intrinsic, in degrees. That order is the one that reads like a human
// joint: X is flexion (elbow bends, hip folds), Y is the twist down the limb,
// Z is the sideways spread. Pose data is written by hand, so it has to be an
// order a person can hold in their head.
export function qEuler(o, x, y, z) {
  const cx = Math.cos(x * DEG * 0.5),
    sx = Math.sin(x * DEG * 0.5);
  const cy = Math.cos(y * DEG * 0.5),
    sy = Math.sin(y * DEG * 0.5);
  const cz = Math.cos(z * DEG * 0.5),
    sz = Math.sin(z * DEG * 0.5);
  o[0] = sx * cy * cz + cx * sy * sz;
  o[1] = cx * sy * cz - sx * cy * sz;
  o[2] = cx * cy * sz - sx * sy * cz;
  o[3] = cx * cy * cz + sx * sy * sz;
  return o;
}

export function qMul(o, a, b) {
  const ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3];
  const bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}

export function qSlerp(o, a, b, t) {
  let ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3];
  let bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];
  let d = ax * bx + ay * by + az * bz + aw * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0, s1;
  if (d > 0.9995) {
    s0 = 1 - t;
    s1 = t;
  } else {
    const th = Math.acos(d);
    const st = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / st;
    s1 = Math.sin(t * th) / st;
  }
  o[0] = s0 * ax + s1 * bx;
  o[1] = s0 * ay + s1 * by;
  o[2] = s0 * az + s1 * bz;
  o[3] = s0 * aw + s1 * bw;
  return o;
}

export function qFromAxisAngle(o, ax, ay, az, ang) {
  const h = ang * 0.5;
  const s = Math.sin(h);
  o[0] = ax * s;
  o[1] = ay * s;
  o[2] = az * s;
  o[3] = Math.cos(h);
  return o;
}

// Shortest rotation taking unit vector `from` onto unit vector `to`. This is
// the whole of the IK solver's final twist, so it has to survive the
// degenerate case where the two are opposite.
export function qBetween(o, from, to) {
  const d = v3dot(from, to);
  if (d > 0.999999) return qIdent(o);
  if (d < -0.999999) {
    // Any perpendicular axis will do; pick the one furthest from `from`.
    let ax = 0,
      ay = 0,
      az = 0;
    if (Math.abs(from[0]) < 0.9) ax = 1;
    else ay = 1;
    const cx = from[1] * az - from[2] * ay;
    const cy = from[2] * ax - from[0] * az;
    const cz = from[0] * ay - from[1] * ax;
    const l = Math.hypot(cx, cy, cz) || 1;
    o[0] = cx / l;
    o[1] = cy / l;
    o[2] = cz / l;
    o[3] = 0;
    return o;
  }
  const cx = from[1] * to[2] - from[2] * to[1];
  const cy = from[2] * to[0] - from[0] * to[2];
  const cz = from[0] * to[1] - from[1] * to[0];
  o[0] = cx;
  o[1] = cy;
  o[2] = cz;
  o[3] = 1 + d;
  const l = Math.hypot(o[0], o[1], o[2], o[3]) || 1;
  o[0] /= l;
  o[1] /= l;
  o[2] /= l;
  o[3] /= l;
  return o;
}

/* ----------------------------------------------------------------- mat4 --- */

export const m4 = () => new Float32Array(16);

export function m4ident(o) {
  o.fill(0);
  o[0] = o[5] = o[10] = o[15] = 1;
  return o;
}

export function m4copy(o, a) {
  o.set(a);
  return o;
}

export function m4compose(o, q, t) {
  const x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  o[0] = 1 - (yy + zz);
  o[1] = xy + wz;
  o[2] = xz - wy;
  o[3] = 0;
  o[4] = xy - wz;
  o[5] = 1 - (xx + zz);
  o[6] = yz + wx;
  o[7] = 0;
  o[8] = xz + wy;
  o[9] = yz - wx;
  o[10] = 1 - (xx + yy);
  o[11] = 0;
  o[12] = t[0];
  o[13] = t[1];
  o[14] = t[2];
  o[15] = 1;
  return o;
}

export function m4mul(o, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return o;
}

export function m4point(o, m, p) {
  const x = p[0], y = p[1], z = p[2];
  o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return o;
}

export function m4dir(o, m, p) {
  const x = p[0], y = p[1], z = p[2];
  o[0] = m[0] * x + m[4] * y + m[8] * z;
  o[1] = m[1] * x + m[5] * y + m[9] * z;
  o[2] = m[2] * x + m[6] * y + m[10] * z;
  return o;
}

export function m4invRigid(o, m) {
  // Inverse of a rotation+translation matrix: transpose the 3x3, negate the
  // rotated translation. Bind matrices are all rigid, so the general inverse
  // never has to exist.
  o[0] = m[0]; o[1] = m[4]; o[2] = m[8]; o[3] = 0;
  o[4] = m[1]; o[5] = m[5]; o[6] = m[9]; o[7] = 0;
  o[8] = m[2]; o[9] = m[6]; o[10] = m[10]; o[11] = 0;
  const tx = m[12], ty = m[13], tz = m[14];
  o[12] = -(o[0] * tx + o[4] * ty + o[8] * tz);
  o[13] = -(o[1] * tx + o[5] * ty + o[9] * tz);
  o[14] = -(o[2] * tx + o[6] * ty + o[10] * tz);
  o[15] = 1;
  return o;
}

export function m4perspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  o.fill(0);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function m4ortho(o, l, r, b, t, n, f) {
  o.fill(0);
  o[0] = 2 / (r - l);
  o[5] = 2 / (t - b);
  o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l);
  o[13] = -(t + b) / (t - b);
  o[14] = -(f + n) / (f - n);
  o[15] = 1;
  return o;
}

export function m4lookAt(o, eye, at, up) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}
