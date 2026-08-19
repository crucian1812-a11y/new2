// The GPU stage.
//
// Everything up to this point is painted by Canvas2D, which is a good
// draughtsman and a hopeless colourist: it can lay down a shape but it cannot
// ask a question about a pixel. This takes the finished, *unlit* frame and
// does everything that happens to it afterwards in one pass:
//
//   relief      a normal recovered from the image itself, so surfaces catch
//               the light that is actually near them
//   light       the ambient sky, every torch and spell, and the roofs that
//               take the sky away — the whole light map, per pixel, at full
//               resolution rather than rasterised at half and stretched
//   air         fog multiplied by that light and added, so haze glows near a
//               fire and stays cold away from one
//   bloom       the emissive buffer, sharp and blurred, added on top
//   grade       contrast, the zone's colour wash and the vignette
//   palette     quantisation with an ordered dither, which is the 1999 look
//               the whole art direction is chasing
//
// Canvas2D still does all of it when this stage is unavailable — see
// `Renderer.compositeCPU`. The two paths are kept close enough that ?nogl on
// the URL is a fair comparison rather than a different game.
//
// If anything here fails — no WebGL, a driver that will not compile, a
// context lost on a backgrounded phone — `ok` goes false and the renderer
// silently falls back. This stage is an improvement, never a requirement.

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_frame;   // the world, unlit
uniform sampler2D u_fog;     // fog density and colour, unlit
uniform sampler2D u_emis;    // emissive only
uniform sampler2D u_bloom;   // emissive, blurred
uniform vec2 u_texel;        // 1/size, for sampling neighbours
uniform vec3 u_lights[16];   // xy = position in uv, z = radius in uv
uniform vec3 u_lightCol[16];
uniform int  u_lightCount;
uniform vec4 u_rooms[3];     // xy = centre in uv, zw = half size in uv
uniform int  u_roomCount;
uniform vec3 u_ambTop;       // ambient at the top of the frame
uniform vec3 u_ambBot;
uniform vec3 u_grade;
uniform vec3 u_gradeSky;
uniform float u_gradeAmount;
uniform float u_relief;      // how much the recovered normal bends the light
uniform float u_levels;      // colour steps per channel
uniform float u_overbright;
uniform float u_fogAmount;
uniform float u_bloomAmount;
uniform float u_bloomWide;
uniform float u_contrast;
uniform float u_time;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// A 4x4 Bayer matrix. Ordered dithering is what let a 256-colour palette
// look like more than 256 colours: instead of banding, neighbouring pixels
// alternate between the two nearest steps and the eye mixes them. Error
// diffusion would look cleaner and would also crawl horribly as the camera
// moves, because each pixel's error depends on its neighbours. A fixed
// threshold pattern is stable in screen space, which is why every sprite
// game of the era used one.
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return m[i] / 16.0 - 0.5;
}

// The overlay blend the frame used to be composited over itself with: an
// S-curve that pushes everything below mid-grey down and everything above it
// up. It is what stops the picture sitting in the middle of the range.
//
// The curve is only defined on 0..1. Canvas2D guaranteed that by clamping
// every blend; here the frame can legitimately arrive above 1 — a torch, a
// spell, an overbright highlight — and the upper branch turns over at 1.707
// and dives, so a channel at 2.0 came out *dimmer* than a channel at 1.0. On
// a white-hot spell the three channels crossed that point at different times,
// which is how a highlight became a saturated ring of the wrong colour. So the
// curve is applied to the part that fits in the range and the excess is
// carried over it, which keeps the response monotonic all the way up.
vec3 overlayCurve(vec3 c) {
  vec3 b = min(c, vec3(1.0));
  vec3 s = mix(b, mix(2.0 * b * b, 1.0 - 2.0 * (1.0 - b) * (1.0 - b), step(0.5, b)), u_contrast);
  return s + max(c - 1.0, 0.0);
}

void main() {
  vec3 base = texture(u_frame, v_uv).rgb;

  // Recover a surface normal from the picture's own shading. This is not a
  // real normal — nothing here knows the geometry — but the art is drawn with
  // a consistent light, so brightness gradients do follow form: the lit side
  // of an arm is brighter than its shadow side, a crack in the ground is
  // darker than the stone beside it. Sobel over luminance turns that into a
  // slope, and a slope is enough for light to catch on.
  float l  = luma(texture(u_frame, v_uv + vec2(-u_texel.x, 0.0)).rgb);
  float r  = luma(texture(u_frame, v_uv + vec2( u_texel.x, 0.0)).rgb);
  float d  = luma(texture(u_frame, v_uv + vec2(0.0, -u_texel.y)).rgb);
  float u  = luma(texture(u_frame, v_uv + vec2(0.0,  u_texel.y)).rgb);
  vec3 n = normalize(vec3((l - r) * u_relief, (d - u) * u_relief, 1.0));

  // --- the light map, per pixel -------------------------------------------
  // Ambient first, graded top to bottom the way the sky is.
  vec3 light = mix(u_ambTop, u_ambBot, v_uv.y);

  // Roofs take the sky out of a room before any lamp is added to it, so what
  // is left indoors is exactly what is burning indoors.
  for (int i = 0; i < 3; i++) {
    if (i >= u_roomCount) break;
    vec2 dr = abs(v_uv - u_rooms[i].xy) - u_rooms[i].zw;
    // A soft edge on the footprint: eaves shade rather than cut.
    float inside = (1.0 - smoothstep(-0.012, 0.006, dr.x)) * (1.0 - smoothstep(-0.012, 0.006, dr.y));
    light *= mix(1.0, 0.16, inside);
  }

  // Every light in range, raking across the recovered slope. The falloff is
  // squared and the vertical axis squashed, the same as the projection, so a
  // torch twenty paces north reaches as far as the eye expects it to.
  for (int i = 0; i < 16; i++) {
    if (i >= u_lightCount) break;
    vec2 dv = u_lights[i].xy - v_uv;
    dv.y *= 0.5;
    float dist = length(dv);
    float rad = u_lights[i].z;
    if (dist > rad) continue;
    // The Canvas2D path accumulates a soft radial sprite; a squared linear
    // falloff is far hotter in the middle of it. This profile is close to the
    // sprite's, so the two paths sit at the same exposure.
    float f = 1.0 - dist / rad;
    float att = f * f * (0.55 + 0.45 * f) * 0.9;
    vec3 ldir = normalize(vec3(dv, 0.55));
    float ndl = max(dot(n, ldir), 0.0);
    // A tight specular on top of the diffuse term. This is the highlight that
    // travels across armour as you walk past a fire.
    float s2 = ndl * ndl;
    s2 *= s2;
    s2 *= s2;
    float spec = s2 * ndl * 0.5;
    light += u_lightCol[i] * att * (0.62 + ndl * 0.45 + spec);
  }

  // --- composite -----------------------------------------------------------
  vec3 col = base * light;
  // A little overbright so a torch feels hot rather than merely revealing.
  col += light * u_overbright;

  // Fog you can see is fog with light in it: the sheet is multiplied by the
  // same light and added, so haze near a brazier glows and haze out in the
  // dark stays a cold suggestion.
  vec4 fog = texture(u_fog, v_uv);
  col += fog.rgb * fog.a * light * u_fogAmount;

  // Bloom: the emissive buffer sharp, and again blurred, and once more wider.
  //
  // Both buffers are alpha-backed Canvas2D surfaces, and a canvas uploaded
  // with UNPACK_PREMULTIPLY_ALPHA off arrives *un*-premultiplied: a spark
  // painted at one tenth coverage hands over its colour at full strength with
  // the tenth living in the alpha channel alone. Reading .rgb and ignoring .a
  // therefore turned every soft radial dot into a flat saturated disc at full
  // power — the flares that were drowning the lighting. Canvas2D adds these
  // buffers with the lighter blend, which is exactly rgb*a — so does this.
  vec4 emis = texture(u_emis, v_uv);
  vec4 glow = texture(u_bloom, v_uv);
  col += emis.rgb * emis.a * u_bloomAmount * 0.6;
  col += glow.rgb * glow.a * u_bloomAmount * 0.72;
  if (u_bloomWide > 0.0) {
    vec4 wide = texture(u_bloom, (v_uv - 0.5) / 1.06 + 0.5);
    col += wide.rgb * wide.a * u_bloomAmount * u_bloomWide;
  }

  col = overlayCurve(max(col, vec3(0.0)));

  // The zone's wash, poured from the top.
  vec3 wash = mix(mix(u_grade, u_gradeSky, 0.45), mix(u_gradeSky, u_grade, 0.3), v_uv.y);
  col = mix(col, wash, u_gradeAmount * mix(0.85, 0.55, v_uv.y));

  // Vignette.
  vec2 vc = (v_uv - vec2(0.5, 0.46)) * vec2(1.0, 0.8);
  float vig = smoothstep(0.24, 0.72, length(vc));
  col *= 1.0 - vig * 0.52;

  vec2 px = v_uv / u_texel;

  // Film grain. The Canvas2D path lays a baked noise tile over the frame at
  // the very end; here it is two lines of hash, animated so it crawls the way
  // grain does rather than sitting on the glass.
  float grain = fract(dot(px, vec2(0.06711056, 0.00583715)) * 52.9829189 + u_time * 7.13);
  col += (grain - 0.5) * 0.03;

  // Quantise, dithered. The threshold is offset per channel so the three do
  // not band on the same pixels, which is what turns dithering into visible
  // colour fringing.
  float steps = max(u_levels, 2.0);
  float dth = bayer(px) / steps;
  col += vec3(dth, dth * 0.92, dth * 1.08);
  col = floor(col * steps + 0.5) / steps;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const MAX_LIGHTS = 16;

export class GLStage {
  constructor(canvas) {
    this.ok = false;
    this.canvas = canvas;
    try {
      this.gl =
        canvas.getContext('webgl2', {
          alpha: false,
          antialias: false,
          depth: false,
          premultipliedAlpha: false,
          // Without this the drawing buffer's contents are undefined after
          // the browser composites, which makes the surface flicker or come
          // back empty on some drivers — and makes it impossible to screenshot.
          preserveDrawingBuffer: true,
        }) ||
        null;
      if (!this.gl) return;
      this._build();
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
    // A phone that backgrounds the tab can lose the context. Rather than
    // trying to rebuild mid-frame, drop back to Canvas2D and stay there.
    if (this.ok) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.ok = false;
      });
    }
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
    }
    return sh;
  }

  _texture(unit) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    // The frame is pixel art and must not be resampled; the fog and the bloom
    // are low-resolution by design and want smoothing on the way up.
    const filter = unit === 0 ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _build() {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this._compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this._compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
    }
    gl.useProgram(prog);
    this.prog = prog;

    // One oversized triangle covers the screen with no vertex waste and no
    // seam down the middle where two triangles would meet.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // A canvas has its origin at the top left and GL has its at the bottom,
    // so without this the world arrives upside down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.tex = [this._texture(0), this._texture(1), this._texture(2), this._texture(3)];

    const u = (name) => gl.getUniformLocation(prog, name);
    this.u = {
      frame: u('u_frame'),
      fog: u('u_fog'),
      emis: u('u_emis'),
      bloom: u('u_bloom'),
      texel: u('u_texel'),
      lights: u('u_lights'),
      lightCol: u('u_lightCol'),
      lightCount: u('u_lightCount'),
      rooms: u('u_rooms'),
      roomCount: u('u_roomCount'),
      ambTop: u('u_ambTop'),
      ambBot: u('u_ambBot'),
      grade: u('u_grade'),
      gradeSky: u('u_gradeSky'),
      gradeAmount: u('u_gradeAmount'),
      relief: u('u_relief'),
      levels: u('u_levels'),
      overbright: u('u_overbright'),
      fogAmount: u('u_fogAmount'),
      bloomAmount: u('u_bloomAmount'),
      bloomWide: u('u_bloomWide'),
      contrast: u('u_contrast'),
      time: u('u_time'),
    };
    gl.uniform1i(this.u.frame, 0);
    gl.uniform1i(this.u.fog, 1);
    gl.uniform1i(this.u.emis, 2);
    gl.uniform1i(this.u.bloom, 3);
    this._lightBuf = new Float32Array(MAX_LIGHTS * 3);
    this._colBuf = new Float32Array(MAX_LIGHTS * 3);
    this._roomBuf = new Float32Array(12);
  }

  /**
   * Lights, grades and presents the finished world buffer.
   * `lights` are in world-buffer pixel space; so are `rooms`.
   */
  present(world, sw, sh, lights, opts = {}) {
    if (!this.ok) return false;
    const gl = this.gl;
    try {
      if (this.canvas.width !== sw || this.canvas.height !== sh) {
        this.canvas.width = sw;
        this.canvas.height = sh;
      }
      gl.viewport(0, 0, sw, sh);
      gl.useProgram(this.prog);

      const upload = (unit, source) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      };
      upload(0, world);
      upload(1, opts.fog || world);
      upload(2, opts.emissive || world);
      upload(3, opts.bloom || world);

      gl.uniform2f(this.u.texel, 1 / world.width, 1 / world.height);

      const n = Math.min(lights.length, MAX_LIGHTS);
      for (let i = 0; i < n; i++) {
        const L = lights[i];
        this._lightBuf[i * 3] = L.x / world.width;
        this._lightBuf[i * 3 + 1] = 1 - L.y / world.height; // gl is y-up
        this._lightBuf[i * 3 + 2] = L.r / world.width;
        this._colBuf[i * 3] = (L.color[0] / 255) * L.i;
        this._colBuf[i * 3 + 1] = (L.color[1] / 255) * L.i;
        this._colBuf[i * 3 + 2] = (L.color[2] / 255) * L.i;
      }
      gl.uniform3fv(this.u.lights, this._lightBuf);
      gl.uniform3fv(this.u.lightCol, this._colBuf);
      gl.uniform1i(this.u.lightCount, n);

      const rooms = opts.rooms || [];
      const rn = Math.min(rooms.length, 3);
      for (let i = 0; i < rn; i++) {
        const R = rooms[i];
        this._roomBuf[i * 4] = R.x / world.width;
        this._roomBuf[i * 4 + 1] = 1 - R.y / world.height;
        this._roomBuf[i * 4 + 2] = R.hw / world.width;
        this._roomBuf[i * 4 + 3] = R.hh / world.height;
      }
      gl.uniform4fv(this.u.rooms, this._roomBuf);
      gl.uniform1i(this.u.roomCount, rn);

      const amb = opts.ambient || [[0.3, 0.3, 0.35], [0.2, 0.2, 0.25]];
      gl.uniform3fv(this.u.ambTop, amb[0]);
      gl.uniform3fv(this.u.ambBot, amb[1]);
      gl.uniform3fv(this.u.grade, opts.grade || [0.5, 0.45, 0.35]);
      gl.uniform3fv(this.u.gradeSky, opts.gradeSky || [0.2, 0.22, 0.3]);
      gl.uniform1f(this.u.gradeAmount, opts.gradeAmount ?? 0.2);
      gl.uniform1f(this.u.relief, opts.relief ?? 1.8);
      gl.uniform1f(this.u.levels, opts.levels ?? 26);
      gl.uniform1f(this.u.overbright, opts.overbright ?? 0.07);
      gl.uniform1f(this.u.fogAmount, opts.fogAmount ?? 1);
      gl.uniform1f(this.u.bloomAmount, opts.bloomAmount ?? 1);
      gl.uniform1f(this.u.bloomWide, opts.bloomWide ?? 0.42);
      gl.uniform1f(this.u.contrast, opts.contrast ?? 0.42);
      gl.uniform1f(this.u.time, opts.time ?? 0);

      // Self-check, once, before the real draw.
      //
      // This stage could not be verified visually where it was written — a
      // headless browser does not composite a WebGL canvas into its
      // screenshots, so the picture looked black while readPixels showed a
      // correct frame. So the first frame is read back on the real device
      // instead: if the shader produces nothing from a frame that clearly has
      // content, the stage retires itself and Canvas2D takes over. A wrong
      // guess here costs a black screen, and that is not a thing to leave to
      // optimism.
      //
      // The test is run with the lighting forced wide open rather than on the
      // scene as it stands. Now that this pass *is* the lighting, a legitimate
      // frame can be almost black — a moonless bog with the torch off screen —
      // and the old check read that as a dead driver and retired a stage that
      // was working perfectly.
      if (!this._checked) {
        this._checked = true;
        gl.uniform3fv(this.u.ambTop, [1, 1, 1]);
        gl.uniform3fv(this.u.ambBot, [1, 1, 1]);
        gl.uniform1f(this.u.gradeAmount, 0);
        gl.uniform1f(this.u.fogAmount, 0);
        gl.uniform1f(this.u.bloomAmount, 0);
        gl.uniform1f(this.u.contrast, 0);
        gl.uniform1i(this.u.lightCount, 0);
        gl.uniform1i(this.u.roomCount, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const px = new Uint8Array(4);
        let bright = 0;
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.6], [0.7, 0.4], [0.5, 0.25]]) {
          gl.readPixels((sw * fx) | 0, (sh * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          bright = Math.max(bright, px[0] + px[1] + px[2]);
        }
        if (bright < 6) {
          this.ok = false;
          return false;
        }
        // Put the real values back for the frame the player actually sees.
        gl.uniform3fv(this.u.ambTop, amb[0]);
        gl.uniform3fv(this.u.ambBot, amb[1]);
        gl.uniform1f(this.u.gradeAmount, opts.gradeAmount ?? 0.2);
        gl.uniform1f(this.u.fogAmount, opts.fogAmount ?? 1);
        gl.uniform1f(this.u.bloomAmount, opts.bloomAmount ?? 1);
        gl.uniform1f(this.u.contrast, opts.contrast ?? 0.42);
        gl.uniform1i(this.u.lightCount, n);
        gl.uniform1i(this.u.roomCount, rn);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      return true;
    } catch (e) {
      this.ok = false;
      return false;
    }
  }
}
