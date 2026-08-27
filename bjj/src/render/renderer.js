// The frame.
//
// Three passes: a shadow map from the key light, a forward pass into a
// half-to-full resolution HDR target, and a finishing pass that does bloom,
// tone mapping and the grade. The scene is small — two fighters and a room —
// so there is budget to spend on how it is lit rather than on how much of it
// there is.
//
// The lighting is a television lighting plan, not a physics one: one hard key
// on the truss, a broad cool fill from the room, and two rim lights that exist
// purely so a white gi against a dark hall still has an edge.

import { createGL, program, vao, texture, framebuffer, QUAD } from './gl.js';
import { giWeave, skinTex, tatamiTex, uploadPacked } from './textures.js';
import { buildArena } from './arena.js';
import { BONE_COUNT } from './skeleton.js';
import { m4, m4mul, m4perspective, m4ortho, m4lookAt, clamp } from '../core/m4.js';

const COMMON = `#version 300 es
precision highp float;
`;

const LIGHTING = `
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_skyCol;
uniform vec3 u_gndCol;
uniform vec3 u_rimA;
uniform vec3 u_rimB;
uniform sampler2D u_shadow;
uniform mat4 u_lightVP;
uniform vec2 u_shadowTexel;

float shadowAt(vec3 world, float ndl) {
  vec4 lp = u_lightVP * vec4(world, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.001 || p.x > 0.999 || p.y < 0.001 || p.y > 0.999 || p.z > 1.0) return 1.0;
  // Slope-scaled bias: a surface nearly edge-on to the light needs far more
  // slack than one facing it, and a single constant bias either peters or
  // detaches the contact shadow that sells a knee pressing into the mat.
  float bias = mix(0.0016, 0.00025, ndl);
  // 5x5, rotated per pixel so the sample pattern does not print itself onto
  // the shadow as a grid. At this frustum size the penumbra is small enough
  // that a 3x3 was visibly stepped.
  float a = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  vec2 rot = vec2(cos(a), sin(a));
  float sum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 o = vec2(float(x), float(y));
      o = vec2(o.x * rot.x - o.y * rot.y, o.x * rot.y + o.y * rot.x);
      float d = texture(u_shadow, p.xy + o * u_shadowTexel).r;
      sum += p.z - bias > d ? 0.0 : 1.0;
    }
  }
  return sum / 25.0;
}

// Wrapped diffuse. Skin and a thick cotton gi both carry light around the
// terminator; a hard lambert makes both look like painted metal.
float wrapDiffuse(float ndl, float w) {
  return clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
}

// Quantise a lit value into a few steps with soft edges between them.
//
// Not a stylistic flourish. A smooth ramp shows every wobble a generated mesh
// has in its normals; three flat steps show the form and nothing else, so the
// figure reads as a figure instead of as a lumpy approximation of one.
float band(float v) {
  float s = v * 3.0;
  float f = floor(s);
  float r = s - f;
  return (f + smoothstep(0.42, 0.58, r)) / 3.0;
}

vec3 shade(vec3 world, vec3 N, vec3 albedo, float rough, float spec, float wrap, float ao) {
  vec3 V = normalize(u_camPos - world);
  vec3 L = u_sunDir;
  float ndl = dot(N, L);
  float sh = shadowAt(world, max(ndl, 0.0));

  vec3 diff = u_sunCol * band(wrapDiffuse(ndl, wrap)) * sh;

  // Hemispheric ambient: the ceiling is bright, the floor throws back the
  // mat's own colour. This is the whole of the indirect lighting and it is
  // enough because the room is dark on purpose.
  float hemi = N.y * 0.5 + 0.5;
  diff += mix(u_gndCol, u_skyCol, hemi) * ao;

  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float gloss = mix(140.0, 6.0, rough);
  // A hard highlight rather than a soft falloff, for the same reason.
  float s = smoothstep(0.35, 0.55, pow(ndh, gloss)) * spec * sh * (1.0 - rough * 0.7);

  // Rims. Deliberately not physical: they come from behind the camera's
  // shoulders in world space and their only job is separation.
  float rimA = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  float rimB = pow(clamp(dot(N, normalize(vec3(-0.6, 0.25, -0.75))), 0.0, 1.0), 2.5);
  vec3 rim = u_rimA * rimA * 0.6 + u_rimB * rimB * 0.5;

  // Both the highlight and the rims are tinted by what they are landing on.
  //
  // They were not, and a black belt came out pale grey: a broad band facing the
  // camera picked up the full specular and the full rim regardless of having
  // almost no albedo, and the two together washed it to the colour of the gi.
  // A separation rim on black cotton is still a rim, it is just a dark one.
  float tone = 0.22 + 0.78 * clamp(dot(albedo, vec3(0.3, 0.6, 0.1)) * 1.6, 0.0, 1.0);

  return albedo * diff + vec3(s) * u_sunCol * tone + rim * ao * tone;
}

// Perturb the interpolated normal by a tangent-space map without a real
// tangent frame. Screen-space derivatives give a frame that is correct enough
// for cloth weave and skin pores, and it costs nothing to store.
// The folds in a gi.
//
// The weave texture is right and it is not enough: at three metres a basket
// weave averages out to a flat tone, and a gi at three metres is not flat — it
// is a stiff cotton jacket with a fold at every elbow, a gathering at the belt
// and a hang down the back. That large scale is what was missing and it is why
// the cloth read as painted plastic.
//
// Three stretched waves whose frequencies do not divide each other, so nothing
// repeats visibly down a sleeve, and no texture to upload. The v coordinate
// runs along the limb in both bakers, so the creases come out across it, which
// is the way cloth actually gathers.
float giFold(vec2 uv) {
  float a = sin(uv.y * 5.3 + sin(uv.x * 2.1) * 1.7);
  float b = sin(uv.y * 8.9 - uv.x * 1.3 + 2.2);
  float c = sin(uv.x * 3.7 - uv.y * 1.9 + 0.7);
  return a * 0.5 + b * 0.3 + c * 0.2;
}

// Tilt a normal by the screen-space slope of a height field. No tangent frame
// needed, which is what makes it worth doing for something procedural.
vec3 bumpFromHeight(vec3 N, vec3 world, float h, float amount) {
  vec3 dpx = dFdx(world), dpy = dFdy(world);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 g = cross(dpy, N) * hx + cross(N, dpx) * hy;
  float inv = inversesqrt(max(dot(dpx, dpx), dot(dpy, dpy)) + 1e-9);
  return normalize(N - g * inv * amount);
}

vec3 applyBump(vec3 N, vec3 world, vec2 uv, vec3 tn, float amount) {
  vec3 dp1 = dFdx(world), dp2 = dFdy(world);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2p = cross(dp2, N), dp1p = cross(N, dp1);
  vec3 T = dp2p * duv1.x + dp1p * duv2.x;
  vec3 B = dp2p * duv1.y + dp1p * duv2.y;
  float inv = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
  vec3 m = normalize(vec3(tn.xy * amount, tn.z));
  return normalize(mat3(T * inv, B * inv, N) * m);
}
`;

// The outline pass. Draw the character again, slightly fatter, inside out, in
// near-black: the front faces are culled, so all that survives is the rim where
// the expanded hull pokes past the real silhouette.
//
// It is the oldest trick there is and it is the right one here. A hand-drawn
// edge does more for a figure than any amount of specular, and unlike specular
// it does not care that the mesh under it came out of a generator.
const OUTLINE_VS = COMMON + `
in vec3 a_pos;
in vec3 a_nrm;
in vec2 a_bone;
in vec2 a_wt;
in float a_mat;
uniform mat4 u_viewProj;
uniform mat4 u_bones[${BONE_COUNT}];
uniform float u_width;   // half-height of the viewport, in pixels
void main() {
  // Only the big shapes get an outline.
  //
  // An inverted hull is a copy of the mesh grown along its normals, and it only
  // works on geometry thicker than the growth. A closed sphere inside a head
  // grows straight out through the face — the eyeballs came out as two black
  // discs on the eyelids. Hair strands and eyelashes are two triangles thick
  // and came out as a smear down the cheek. The head's silhouette is drawn by
  // the skin and the jacket underneath them, so nothing is lost by leaving
  // everything above the lapel out of it.
  if (a_mat > 4.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  mat4 s = u_bones[int(a_bone.x)] * a_wt.x + u_bones[int(a_bone.y)] * a_wt.y;
  vec4 p = s * vec4(a_pos, 1.0);
  vec3 n = normalize(mat3(s) * a_nrm);

  // Grown in screen space, not in metres.
  //
  // A fixed world width is a different line at every distance: seven
  // millimetres is a clean edge on a fighter three metres away and a black
  // stripe on one at arm's length. Worse, on a face it is thicker than the
  // features — the hull closed the gap between the fingers and drew a smear
  // from the corner of the eye to the chin, and both of those were the outline
  // rather than the shading they looked like.
  //
  // Projecting the normal and stepping a fixed number of pixels along it makes
  // the line the same weight wherever the camera is, which is what a drawn
  // outline does.
  vec4 clip = u_viewProj * vec4(p.xyz, 1.0);
  vec4 clipN = u_viewProj * vec4(p.xyz + n * 0.02, 1.0);
  vec2 d = clipN.xy / max(clipN.w, 1e-4) - clip.xy / max(clip.w, 1e-4);
  float l = length(d);
  if (l > 1e-6) clip.xy += (d / l) * u_width * clip.w;
  gl_Position = clip;
}`;

const OUTLINE_FS = COMMON + `
out vec4 o;
void main() { o = vec4(0.012, 0.014, 0.022, 1.0); }`;

const SKIN_VS = COMMON + `
in vec3 a_pos;
in vec3 a_nrm;
in vec2 a_uv;
in vec2 a_bone;
in vec2 a_wt;
in float a_mat;

uniform mat4 u_viewProj;
uniform mat4 u_bones[${BONE_COUNT}];

out vec3 v_world;
out vec3 v_nrm;
out vec2 v_uv;
// Flat, and it matters. A material id is a name, not a quantity: interpolate
// between hair (5) and jacket (1) and the fragments in between round to belt
// and lapel, which paints a rainbow seam along every hem on the body.
flat out float v_mat;

void main() {
  mat4 s = u_bones[int(a_bone.x)] * a_wt.x + u_bones[int(a_bone.y)] * a_wt.y;
  vec4 p = s * vec4(a_pos, 1.0);
  v_world = p.xyz;
  // Guarded normalise. A zero-length normal — which a decimated mesh can carry
  // where two opposing faces cancelled — would otherwise become NaN here, and
  // NaN does not stay local: it goes into the HDR target and the bloom blur
  // spreads it into black rectangles several times its size.
  vec3 nn = mat3(s) * a_nrm;
  float nl = length(nn);
  v_nrm = nl > 1e-6 ? nn / nl : vec3(0.0, 1.0, 0.0);
  v_uv = a_uv;
  v_mat = a_mat;
  gl_Position = u_viewProj * p;
}`;

const SKIN_FS = COMMON + LIGHTING + `
in vec3 v_world;
in vec3 v_nrm;
in vec2 v_uv;
flat in float v_mat;
out vec4 outColor;

uniform sampler2D u_cloth;
uniform sampler2D u_skin;
uniform vec3 u_giCol;
uniform vec3 u_beltCol;
uniform vec3 u_skinCol;
uniform float u_flash;   // hit flash, 0..1

void main() {
  int m = int(v_mat + 0.5);
  vec3 N = normalize(v_nrm);
  vec3 albedo; float rough; float spec; float wrap;

  if (m == 0) {
    vec4 t = texture(u_skin, v_uv * 1.6);
    N = applyBump(N, v_world, v_uv * 1.6, t.rgb * 2.0 - 1.0, 0.35);
    albedo = u_skinCol * t.a;
    rough = 0.55; spec = 0.45; wrap = 0.55;   // sweat, and a lot of translucency
  } else if (m == 7) {
    // An eyeball. The baker stored where on the sphere each vertex sits
    // relative to the way the face looks, so the iris is a cap on the front and
    // stays there when the head turns.
    float fwd = clamp(v_uv.y, -1.0, 1.0);
    float across = clamp(v_uv.x, -1.0, 1.0);
    float ring = length(vec2(across, clamp(v_uv.y * 0.0, -1.0, 1.0)));
    // A sclera is never white on a lit face; it sits in the shadow of a brow.
    albedo = vec3(0.55, 0.54, 0.52);
    float iris = smoothstep(0.42, 0.62, fwd);
    albedo = mix(albedo, vec3(0.17, 0.115, 0.075), iris);
    float pupil = smoothstep(0.80, 0.93, fwd);
    albedo = mix(albedo, vec3(0.02, 0.018, 0.016), pupil);
    // The corners of the eye are in shadow no matter where the light is.
    albedo *= 1.0 - smoothstep(0.55, 1.0, abs(across)) * 0.5;
    rough = 0.14; spec = 0.85; wrap = 0.1;
  } else if (m == 6) {
    // The face.
    //
    // The sculpt has a nose and a brow and a jaw, and from three metres away
    // none of that reads without eyes: a head with correct geometry and no
    // features is a mannequin, and a mannequin is the thing that makes a game
    // look unfinished no matter what else is right. So the features are drawn.
    //
    // The baker gives face vertices a different kind of UV — u runs -1 to +1
    // temple to temple, v runs 0 at the chin to 1 at the hairline — so this can
    // work in centimetres on an actual face and put an eye three centimetres
    // off the middle and seven up, which is where an eye is.
    vec2 F = vec2(v_uv.x * 6.5, v_uv.y * 8.8);
    vec4 t = texture(u_skin, v_uv * 1.1);
    N = applyBump(N, v_world, v_uv * 1.1, t.rgb * 2.0 - 1.0, 0.3);
    albedo = u_skinCol * t.a;

    float ax = abs(F.x);
    // Features fade out towards the temples, where the surface turns away and a
    // drawn feature would smear round the side of the head instead of sitting
    // on the face.
    float on = smoothstep(6.2, 4.6, ax) * smoothstep(0.2, 0.9, F.y) * smoothstep(8.8, 8.2, F.y);

    // Eye socket: a soft darkening, which is most of what makes a face read.
    float socket = exp(-(pow((ax - 3.0) / 2.0, 2.0) + pow((F.y - 6.85) / 1.0, 2.0)));
    albedo *= 1.0 - socket * 0.34 * on;

    // Brow.
    float brow = 1.0 - smoothstep(0.55, 1.0, length(vec2((ax - 3.1) / 1.75, (F.y - 7.85 + (ax - 3.1) * 0.10) / 0.34)));
    albedo *= 1.0 - brow * 0.55 * on;

    // The eye itself: a sclera that is never white — an eye painted white on a
    // shaded face reads as a doll — and a pupil that is nearly black.
    float eye = 1.0 - smoothstep(0.75, 1.0, length(vec2((ax - 3.0) / 1.35, (F.y - 6.9) / 0.52)));
    float pupil = 1.0 - smoothstep(0.7, 1.0, length(vec2((ax - 3.0) / 0.58, (F.y - 6.9) / 0.58)));
    albedo = mix(albedo, vec3(0.34, 0.31, 0.29), eye * on);
    albedo = mix(albedo, vec3(0.045, 0.038, 0.035), pupil * on);
    // A lid line along the top, which is what stops the eye reading as a hole.
    float lid = (1.0 - smoothstep(0.8, 1.0, length(vec2((ax - 3.0) / 1.5, (F.y - 7.36) / 0.3)))) * step(F.y, 7.5);
    albedo *= 1.0 - lid * 0.4 * on;

    // Nostrils and the shadow under the nose.
    float nose = exp(-(pow((ax - 0.8) / 0.45, 2.0) + pow((F.y - 4.35) / 0.35, 2.0)));
    albedo *= 1.0 - nose * 0.45 * on;

    // Mouth. A line, not a shape: at this distance a drawn mouth with lips on
    // it looks like a wound.
    float mouth = 1.0 - smoothstep(0.6, 1.0, length(vec2(F.x / 2.1, (F.y - 2.45) / 0.22)));
    albedo *= 1.0 - mouth * 0.42 * on;
    // The lower lip catches light just under it.
    float lipLit = 1.0 - smoothstep(0.6, 1.0, length(vec2(F.x / 1.7, (F.y - 1.95) / 0.3)));
    albedo *= 1.0 + lipLit * 0.10 * on;

    rough = 0.55; spec = 0.42; wrap = 0.55;
  } else if (m == 5 || m == 8) {
    // Hair, and the eyelashes and brows that came as their own thin sheets.
    // A dark shell with a sharp sheen along it — the specular is what makes it
    // read as hair rather than as a helmet.
    vec4 t = texture(u_skin, v_uv * 3.0);
    N = applyBump(N, v_world, v_uv * 3.0, t.rgb * 2.0 - 1.0, 0.6);
    albedo = vec3(0.035, 0.028, 0.026) * (0.7 + t.a * 0.6);
    rough = 0.34; spec = 0.5; wrap = 0.2;
  } else {
    vec4 t = texture(u_cloth, v_uv);
    N = applyBump(N, v_world, v_uv, t.rgb * 2.0 - 1.0, 0.9);

    // Folds, on top of the weave. A belt is a tight roll and does not fold;
    // everything else does.
    float fold = m == 3 ? 0.0 : giFold(v_uv);
    N = bumpFromHeight(N, v_world, fold, 0.0075);

    vec3 base = m == 3 ? u_beltCol : u_giCol;
    if (m == 2) base *= 0.97;                  // trousers, very slightly duller
    // The collar is a doubled and quilted strip and it reads darker than the
    // jacket, not lighter. Painted brighter it vanished into the chest, and the
    // V is most of what says gi rather than pyjamas at any distance.
    if (m == 4) base *= 0.86;
    albedo = base * t.a;
    // Light does not reach the bottom of a crease. This is the half of a fold
    // that survives at distance, after the normal has stopped being resolvable.
    albedo *= 1.0 - max(0.0, -fold) * 0.055;
    rough = m == 3 ? 0.74 : 0.88; spec = m == 3 ? 0.14 : 0.12; wrap = 0.32;
  }

  // Ground proximity. Grappling happens with bodies pressed into the mat, so
  // the few centimetres nearest it are where contact reads — this is stronger
  // and tighter than a generic ambient term would be.
  float ao = clamp(0.24 + v_world.y * 1.9, 0.0, 1.0);
  vec3 c = shade(v_world, N, albedo, rough, spec, wrap, ao);
  c += vec3(1.0, 0.45, 0.3) * u_flash * 0.6;
  // Belt and braces: anything that is not a sane positive number never reaches
  // the bloom buffer.
  c = mix(vec3(0.0), min(c, vec3(64.0)), vec3(greaterThanEqual(c, vec3(0.0))));
  outColor = vec4(c, 1.0);
}`;

const STATIC_VS = COMMON + `
in vec3 a_pos;
in vec3 a_nrm;
in vec2 a_uv;
in float a_mat;
uniform mat4 u_viewProj;
out vec3 v_world;
out vec3 v_nrm;
out vec2 v_uv;
flat out float v_mat;
void main() {
  v_world = a_pos;
  v_nrm = a_nrm;
  v_uv = a_uv;
  v_mat = a_mat;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;

const STATIC_FS = COMMON + LIGHTING + `
in vec3 v_world;
in vec3 v_nrm;
in vec2 v_uv;
flat in float v_mat;
out vec4 outColor;

uniform sampler2D u_tatami;
uniform vec3 u_matInner;
uniform vec3 u_matOuter;
uniform float u_area;
uniform float u_time;

void main() {
  int m = int(v_mat + 0.5);
  vec3 N = normalize(v_nrm);
  vec3 albedo; float rough = 0.9; float spec = 0.05; float ao = 1.0;
  vec3 emis = vec3(0.0);

  if (m == 0) {
    // The mat. The competition square and its safety border are one mesh; the
    // boundary is decided here, which keeps the two surfaces coplanar and out
    // of a depth fight.
    vec4 t = texture(u_tatami, v_uv * 0.5);
    N = applyBump(N, v_world, v_uv * 0.5, t.rgb * 2.0 - 1.0, 1.15);
    float inArea = step(max(abs(v_world.x), abs(v_world.z)), u_area * 0.5);
    albedo = mix(u_matOuter, u_matInner, inArea) * t.a;
    // The white boundary line, painted on.
    float d = max(abs(v_world.x), abs(v_world.z));
    float line = smoothstep(0.06, 0.03, abs(d - u_area * 0.5));
    albedo = mix(albedo, vec3(0.86, 0.87, 0.86), line * 0.85);
    rough = 0.62; spec = 0.35;
  } else if (m == 1) {
    albedo = vec3(0.035, 0.037, 0.045); rough = 0.95; spec = 0.06;
  } else if (m == 2) {
    albedo = vec3(0.05, 0.055, 0.07); rough = 0.8; spec = 0.14;
  } else if (m == 3) {
    albedo = vec3(0.028, 0.03, 0.038); rough = 1.0; spec = 0.02; ao = 0.5;
  } else if (m == 4) {
    // The crowd. Barely lit, tinted all over the place, and the variation is
    // driven off world position so it is stable frame to frame.
    float h = fract(sin(dot(floor(v_world.xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    albedo = mix(vec3(0.052, 0.049, 0.058), vec3(0.086, 0.074, 0.076), h);
    // The far stands fall away entirely, which is what puts the mat in a pool
    // of light instead of in a lit box.
    albedo *= 0.5 + 0.5 * h;
    albedo *= smoothstep(28.0, 9.0, max(abs(v_world.x), abs(v_world.z)));
    rough = 1.0; spec = 0.0; ao = 0.26;

    // Catchlights. A dark crowd with nothing in it is a black wall; a dark
    // crowd with a hundred phone screens in it is four thousand people. The
    // cell is finer than a body so each one is a screen and not a whole torso,
    // and the hash is on world position so they do not crawl with the camera.
    vec3 cell = floor(v_world * 17.0);
    float sp = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float lit = smoothstep(0.9955, 0.9995, sp);
    float warm = fract(sp * 91.7);
    vec3 spark = mix(vec3(0.42, 0.52, 0.95), vec3(1.0, 0.78, 0.42), warm);
    // They breathe slightly, at their own rates, so the stands are not a still
    // photograph behind a moving fight.
    lit *= 0.65 + 0.35 * sin(u_time * (0.8 + warm * 2.2) + sp * 40.0);
    emis += spark * lit * 3.4 * smoothstep(34.0, 10.0, max(abs(v_world.x), abs(v_world.z)));
  } else if (m == 5) {
    // Lamp housings: emissive, and the only thing in frame allowed to blow out.
    outColor = vec4(vec3(2.6, 2.45, 2.2), 1.0);
    return;
  } else if (m == 7) {
    // The sponsor boards around the mat: internally lit panels, a new one every
    // two and a half metres, each a flat colour with a pale block across the
    // middle where the lettering would be. Read at this distance it is a ring
    // of colour separating a white mat from a black crowd, and that ring is
    // what makes the hall a hall.
    float run = abs(v_world.x) > abs(v_world.z) ? v_world.z : v_world.x;
    float board = floor(run / 2.5);
    float k = fract(sin(board * 91.7 + 3.1) * 43758.5453);
    vec3 face = k < 0.3 ? vec3(0.22, 0.055, 0.07)
              : k < 0.55 ? vec3(0.045, 0.10, 0.24)
              : k < 0.78 ? vec3(0.05, 0.15, 0.11)
              : vec3(0.19, 0.14, 0.03);
    // The lettering band, and a thin gap between one board and the next.
    float band = smoothstep(0.38, 0.44, fract(v_world.y / 0.9)) *
                 (1.0 - smoothstep(0.62, 0.68, fract(v_world.y / 0.9)));
    float seam = smoothstep(0.0, 0.03, fract(run / 2.5)) *
                 (1.0 - smoothstep(0.97, 1.0, fract(run / 2.5)));
    vec3 c = mix(face, face * 0.35 + vec3(0.55), band * 0.8) * seam;
    // Lit from inside, so it holds up when the key light is not on it. Only
    // the top face of the board takes the room's shading.
    emis += c * 0.8;
    albedo = c * 0.25; rough = 0.55; spec = 0.2; ao = 0.7;
  } else {
    // The jumbotron's screens. Bright enough to read as a display and to feed
    // the bloom, dim enough that they are not a second key light.
    float band = 0.5 + 0.5 * sin(v_world.y * 42.0 + u_time * 2.2);
    outColor = vec4(vec3(0.20, 0.34, 0.62) * (1.35 + band * 0.25), 1.0);
    return;
  }
  outColor = vec4(shade(v_world, N, albedo, rough, spec, 0.15, ao) + emis, 1.0);
}`;

const SHADOW_VS_SKIN = COMMON + `
in vec3 a_pos;
in vec2 a_bone;
in vec2 a_wt;
uniform mat4 u_lightVP;
uniform mat4 u_bones[${BONE_COUNT}];
void main() {
  mat4 s = u_bones[int(a_bone.x)] * a_wt.x + u_bones[int(a_bone.y)] * a_wt.y;
  gl_Position = u_lightVP * (s * vec4(a_pos, 1.0));
}`;

const SHADOW_VS_STATIC = COMMON + `
in vec3 a_pos;
uniform mat4 u_lightVP;
void main() { gl_Position = u_lightVP * vec4(a_pos, 1.0); }`;

const SHADOW_FS = COMMON + `
out vec4 o;
void main() { o = vec4(1.0); }`;

const POST_VS = COMMON + `
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const BRIGHT_FS = COMMON + `
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + vec2(-1.0, -1.0) * u_texel).rgb;
  c += texture(u_src, v_uv + vec2( 1.0, -1.0) * u_texel).rgb;
  c += texture(u_src, v_uv + vec2(-1.0,  1.0) * u_texel).rgb;
  c += texture(u_src, v_uv + vec2( 1.0,  1.0) * u_texel).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  o = vec4(c * smoothstep(0.75, 1.6, l), 1.0);
}`;

const BLUR_FS = COMMON + `
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_dir;
void main() {
  // Nine taps folded into five by sampling between texels — the linear filter
  // does the inner weights for free.
  vec3 c = texture(u_src, v_uv).rgb * 0.2270270270;
  c += texture(u_src, v_uv + u_dir * 1.3846153846).rgb * 0.3162162162;
  c += texture(u_src, v_uv - u_dir * 1.3846153846).rgb * 0.3162162162;
  c += texture(u_src, v_uv + u_dir * 3.2307692308).rgb * 0.0702702703;
  c += texture(u_src, v_uv - u_dir * 3.2307692308).rgb * 0.0702702703;
  o = vec4(c, 1.0);
}`;

const POST_FS = COMMON + `
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_bloom;
uniform float u_time;
uniform float u_shake;
uniform float u_flash;
uniform float u_desat;

// ACES, the Narkowicz fit. The cheap one; nobody is going to grade this in a
// suite, and it keeps the lamps from turning into flat white discs.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  vec3 c = texture(u_src, uv).rgb;
  c += texture(u_bloom, uv).rgb * 0.55;

  c = aces(c * 1.02);
  // A shoulder of contrast. Broadcast pictures are not linear ramps.
  c = clamp(c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65, 0.0, 1.0);

  // Grade: lift the shadows towards the hall's cold blue, warm the highlights
  // towards the lamps.
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, mix(vec3(0.05, 0.07, 0.12), vec3(1.02, 0.99, 0.93), l), 0.25);
  c = mix(vec3(l), c, 1.0 - u_desat);
  c += vec3(1.0, 0.9, 0.8) * u_flash;

  float vig = smoothstep(1.3, 0.28, length(uv - 0.5) * 1.5);
  c *= mix(0.38, 1.0, vig);

  // Broadcast grain. Fixed strength, screen-space, so it does not crawl with
  // the camera the way noise sampled in world space does.
  float g = fract(sin(dot(gl_FragCoord.xy + u_time * 60.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * 0.022;

  o = vec4(c, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = createGL(canvas);
    if (!this.gl) throw new Error('WebGL2 unavailable');
    const gl = this.gl;

    this.progSkin = program(gl, SKIN_VS, SKIN_FS, 'skin');
    this.progStatic = program(gl, STATIC_VS, STATIC_FS, 'static');
    this.progShadowSkin = program(gl, SHADOW_VS_SKIN, SHADOW_FS, 'shadowSkin');
    this.progShadowStatic = program(gl, SHADOW_VS_STATIC, SHADOW_FS, 'shadowStatic');
    this.progOutline = program(gl, OUTLINE_VS, OUTLINE_FS, 'outline');
    this.progBright = program(gl, POST_VS, BRIGHT_FS, 'bright');
    this.progBlur = program(gl, POST_VS, BLUR_FS, 'blur');
    this.progPost = program(gl, POST_VS, POST_FS, 'post');

    this.quadVAO = vao(gl, this.progPost.p, [{ name: 'a_pos', data: QUAD, size: 2 }]);

    this.texCloth = texture(gl, { width: 1, height: 1, mips: true });
    uploadPacked(gl, giWeave(256), this.texCloth);
    this.texSkin = texture(gl, { width: 1, height: 1, mips: true });
    uploadPacked(gl, skinTex(256), this.texSkin);
    this.texTatami = texture(gl, { width: 1, height: 1, mips: true });
    uploadPacked(gl, tatamiTex(512), this.texTatami);

    this.arena = buildArena();
    this.arenaVAO = vao(gl, this.progStatic.p, [
      { name: 'a_pos', data: this.arena.pos, size: 3 },
      { name: 'a_nrm', data: this.arena.nrm, size: 3 },
      { name: 'a_uv', data: this.arena.uv, size: 2 },
      { name: 'a_mat', data: this.arena.mat, size: 1 },
    ], this.arena.idx);
    this.arenaShadowVAO = vao(gl, this.progShadowStatic.p, [
      { name: 'a_pos', data: this.arena.pos, size: 3 },
    ], this.arena.idx);

    this.SHADOW = 2048;
    this.shadowTex = texture(gl, {
      width: this.SHADOW, height: this.SHADOW,
      internalFormat: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT,
      type: gl.UNSIGNED_INT, filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE,
    });
    this.shadowFB = framebuffer(gl, null, this.shadowTex);

    this.viewProj = m4();
    this.lightVP = m4();
    this.proj = m4();
    this.view = m4();
    this.sceneW = 0;
    this.sceneH = 0;
    this.scale = 1;
    this.shake = 0;
    this.flash = 0;
    this.desat = 0;
    this._buildTargets(2, 2);
  }

  _buildTargets(w, h) {
    const gl = this.gl;
    if (this.sceneTex) {
      gl.deleteTexture(this.sceneTex);
      gl.deleteTexture(this.depthTex);
      gl.deleteFramebuffer(this.sceneFB);
      for (const t of this.bloomTex) gl.deleteTexture(t);
      for (const f of this.bloomFB) gl.deleteFramebuffer(f);
    }
    this.sceneW = w;
    this.sceneH = h;
    const hdr = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    this.sceneTex = texture(gl, { width: w, height: h, wrap: gl.CLAMP_TO_EDGE, ...hdr });
    this.depthTex = texture(gl, {
      width: w, height: h, internalFormat: gl.DEPTH_COMPONENT24,
      format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT,
      filter: gl.NEAREST, wrap: gl.CLAMP_TO_EDGE,
    });
    this.sceneFB = framebuffer(gl, this.sceneTex, this.depthTex);

    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.bloomW = bw;
    this.bloomH = bh;
    this.bloomTex = [0, 1].map(() =>
      texture(gl, { width: bw, height: bh, wrap: gl.CLAMP_TO_EDGE, ...hdr })
    );
    this.bloomFB = this.bloomTex.map((t) => framebuffer(gl, t, null));
  }

  resize(cssW, cssH, dpr, quality) {
    const w = Math.max(2, Math.round(cssW * dpr * quality));
    const h = Math.max(2, Math.round(cssH * dpr * quality));
    if (w === this.sceneW && h === this.sceneH) return;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this._buildTargets(w, h);
  }

  // Upload a fighter. Takes any number of meshes sharing one skeleton: the
  // procedural body is two (skin and gi, which need different radii), a baked
  // one is a single mesh carrying its material id per vertex. Both end up as
  // the same thing here — a list of parts to draw.
  makeFighterGPU(meshes) {
    const gl = this.gl;
    const list = Array.isArray(meshes) ? meshes : [meshes.skin, meshes.gi].filter(Boolean);
    const mk = (m) => ({
      main: vao(gl, this.progSkin.p, [
        { name: 'a_pos', data: m.pos, size: 3 },
        { name: 'a_nrm', data: m.nrm, size: 3 },
        { name: 'a_uv', data: m.uv, size: 2 },
        { name: 'a_bone', data: m.bone, size: 2 },
        { name: 'a_wt', data: m.wt, size: 2 },
        { name: 'a_mat', data: m.mat, size: 1 },
      ], m.idx),
      shadow: vao(gl, this.progShadowSkin.p, [
        { name: 'a_pos', data: m.pos, size: 3 },
        { name: 'a_bone', data: m.bone, size: 2 },
        { name: 'a_wt', data: m.wt, size: 2 },
      ], m.idx),
      outline: vao(gl, this.progOutline.p, [
        { name: 'a_pos', data: m.pos, size: 3 },
        { name: 'a_nrm', data: m.nrm, size: 3 },
        { name: 'a_bone', data: m.bone, size: 2 },
        { name: 'a_wt', data: m.wt, size: 2 },
        { name: 'a_mat', data: m.mat, size: 1 },
      ], m.idx),
      count: m.count,
      type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    });
    return { parts: list.map(mk) };
  }

  render(scene) {
    const gl = this.gl;
    const { camera, fighters, time } = scene;

    // The light rides with the action so the shadow map spends its whole
    // resolution on the two people in it.
    const cx = clamp(scene.focus[0], -3, 3);
    const cz = clamp(scene.focus[2], -3, 3);
    const sunDir = [0.32, 0.9, 0.3];
    const eye = [cx + sunDir[0] * 9, sunDir[1] * 9, cz + sunDir[2] * 9];
    // The frustum used to cover seven metres of mat for two people who never
    // occupy more than two. Tightening it is free resolution: the same 2048
    // texels now fall on the bodies instead of on empty tatami, which is the
    // difference between a shadow under a knee and a grey smudge near it.
    const R = 1.9;
    const lproj = m4ortho(m4(), -R, R, -R, R, 0.5, 18);
    const lview = m4lookAt(m4(), eye, [cx, 0.4, cz], [0, 1, 0]);
    m4mul(this.lightVP, lproj, lview);

    /* ---- shadow ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.viewport(0, 0, this.SHADOW, this.SHADOW);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // Only the fighters cast. The room is flat and lit from overhead, so its
    // own shadows were never anything but artefacts crawling across the mat.
    gl.useProgram(this.progShadowSkin.p);
    gl.uniformMatrix4fv(this.progShadowSkin.u.u_lightVP, false, this.lightVP);
    for (const f of fighters) {
      gl.uniformMatrix4fv(this.progShadowSkin.u.u_bones, false, f.skeleton.skin);
      for (const part of f.gpu.parts) {
        gl.bindVertexArray(part.shadow);
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
      }
    }

    /* ---- scene ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, this.sceneW, this.sceneH);
    gl.clearColor(0.012, 0.014, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    m4perspective(this.proj, camera.fov, this.sceneW / this.sceneH, 0.08, 70);
    m4lookAt(this.view, camera.eye, camera.at, [0, 1, 0]);
    m4mul(this.viewProj, this.proj, this.view);

    const setLights = (pr) => {
      gl.uniform3fv(pr.u.u_camPos, camera.eye);
      gl.uniform3f(pr.u.u_sunDir, sunDir[0], sunDir[1], sunDir[2]);
      gl.uniform3f(pr.u.u_sunCol, 1.92, 1.84, 1.66);
      gl.uniform3f(pr.u.u_skyCol, 0.145, 0.17, 0.235);
      gl.uniform3f(pr.u.u_gndCol, 0.036, 0.04, 0.052);
      gl.uniform3f(pr.u.u_rimA, 0.34, 0.46, 0.72);
      gl.uniform3f(pr.u.u_rimB, 0.5, 0.38, 0.28);
      gl.uniformMatrix4fv(pr.u.u_lightVP, false, this.lightVP);
      gl.uniform2f(pr.u.u_shadowTexel, 1 / this.SHADOW, 1 / this.SHADOW);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(pr.u.u_shadow, 3);
      gl.uniformMatrix4fv(pr.u.u_viewProj, false, this.viewProj);
    };

    gl.useProgram(this.progStatic.p);
    setLights(this.progStatic);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texTatami);
    gl.uniform1i(this.progStatic.u.u_tatami, 0);
    gl.uniform3f(this.progStatic.u.u_matInner, 0.043, 0.105, 0.245);
    gl.uniform3f(this.progStatic.u.u_matOuter, 0.40, 0.235, 0.045);
    gl.uniform1f(this.progStatic.u.u_area, 8);
    gl.uniform1f(this.progStatic.u.u_time, time);
    gl.bindVertexArray(this.arenaVAO);
    gl.drawElements(gl.TRIANGLES, this.arena.count, gl.UNSIGNED_INT, 0);

    // Outlines first, culled to their back faces, so the lit pass draws over
    // everything except the rim.
    gl.useProgram(this.progOutline.p);
    gl.uniformMatrix4fv(this.progOutline.u.u_viewProj, false, this.viewProj);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    for (const f of fighters) {
      gl.uniformMatrix4fv(this.progOutline.u.u_bones, false, f.skeleton.skin);
      // Two and a bit pixels, in normalised device coordinates: the viewport is
      // two units tall, so a pixel is 2/height.
      gl.uniform1f(this.progOutline.u.u_width, (2.2 * 2) / Math.max(1, this.sceneH));
      for (const part of f.gpu.parts) {
        gl.bindVertexArray(part.outline);
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
      }
    }
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.progSkin.p);
    setLights(this.progSkin);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texCloth);
    gl.uniform1i(this.progSkin.u.u_cloth, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texSkin);
    gl.uniform1i(this.progSkin.u.u_skin, 1);
    for (const f of fighters) {
      gl.uniformMatrix4fv(this.progSkin.u.u_bones, false, f.skeleton.skin);
      gl.uniform3fv(this.progSkin.u.u_giCol, f.giCol);
      gl.uniform3fv(this.progSkin.u.u_beltCol, f.beltCol);
      gl.uniform3fv(this.progSkin.u.u_skinCol, f.skinCol);
      gl.uniform1f(this.progSkin.u.u_flash, f.flash || 0);
      for (const part of f.gpu.parts) {
        gl.bindVertexArray(part.main);
        gl.drawElements(gl.TRIANGLES, part.count, part.type, 0);
      }
    }

    // Tooling hook: look for NaN in the HDR buffer before anything spreads it.
    //
    // This is the check that would have saved an afternoon. A single NaN pixel
    // here — from a zero normal, a divide by a degenerate derivative, anything
    // — is invisible at this stage and then gets smeared by the bloom blur into
    // black rectangles the size of a limb, which look exactly like a broken
    // rasteriser and not at all like a bad vertex.
    if (this.probe) {
      const px = new Float32Array(4);
      let nan = 0, sampled = 0;
      for (let y = 1; y < 8; y++) {
        for (let x = 1; x < 8; x++) {
          gl.readPixels(
            Math.floor((this.sceneW * x) / 9), Math.floor((this.sceneH * y) / 9),
            1, 1, gl.RGBA, gl.FLOAT, px
          );
          sampled++;
          for (let k = 0; k < 3; k++) if (!(px[k] === px[k]) || !isFinite(px[k])) nan++;
        }
      }
      this.hdrNaN = { nan, sampled };
    }

    /* ---- bloom ---- */
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quadVAO);
    gl.viewport(0, 0, this.bloomW, this.bloomH);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFB[0]);
    gl.useProgram(this.progBright.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.progBright.u.u_src, 0);
    gl.uniform2f(this.progBright.u.u_texel, 1 / this.sceneW, 1 / this.sceneH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.progBlur.p);
    for (const [from, to, dx, dy] of [
      [0, 1, 1 / this.bloomW, 0],
      [1, 0, 0, 1 / this.bloomH],
    ]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFB[to]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[from]);
      gl.uniform1i(this.progBlur.u.u_src, 0);
      gl.uniform2f(this.progBlur.u.u_dir, dx, dy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ---- present ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.progPost.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.progPost.u.u_src, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
    gl.uniform1i(this.progPost.u.u_bloom, 1);
    gl.uniform1f(this.progPost.u.u_time, time);
    gl.uniform1f(this.progPost.u.u_shake, this.shake);
    gl.uniform1f(this.progPost.u.u_flash, this.flash);
    gl.uniform1f(this.progPost.u.u_desat, this.desat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Tooling hook: a frame can only be read back before it is presented, so
    // the brightness probe the smoke test needs has to live inside the frame.
    if (this.probe) {
      this.probe = false;
      const px = new Uint8Array(4);
      this.lum = [];
      for (let i = 0; i < 16; i++) {
        gl.readPixels(
          Math.floor(this.canvas.width * (0.16 + 0.045 * i)),
          Math.floor(this.canvas.height * 0.42),
          1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
        );
        this.lum.push((px[0] + px[1] + px[2]) / 3);
      }
    }

    gl.bindVertexArray(null);
  }
}
