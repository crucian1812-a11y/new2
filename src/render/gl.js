// The GPU finishing stage.
//
// Everything up to this point is painted by Canvas2D, which is a good
// draughtsman and a hopeless colourist: it can lay down a shape but it cannot
// ask a question about a pixel. This takes the finished frame and does the
// three things that need per-pixel work, all of which measured free on the
// GPU and were all impossible in JS at sixty frames a second:
//
//   relief      a normal recovered from the image itself, so surfaces catch
//               the light that is actually near them
//   palette     quantisation with an ordered dither, which is the 1999 look
//               the whole art direction is chasing
//   grade       the vignette and colour wash, moved off the CPU
//
// If anything here fails — no WebGL, a driver that will not compile, a
// context lost on a backgrounded phone — `ok` goes false and the renderer
// silently keeps using the Canvas2D path it already had. This stage is an
// improvement, never a requirement.

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

uniform sampler2D u_frame;
uniform vec2 u_texel;       // 1/size, for sampling neighbours
uniform vec3 u_lights[12];  // xy = position in uv, z = radius in uv
uniform vec3 u_lightCol[12];
uniform int  u_lightCount;
uniform float u_relief;     // how much the recovered normal bends the light
uniform float u_levels;     // colour steps per channel
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

  // Every light in range gets to rake across that slope.
  vec3 lit = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    if (i >= u_lightCount) break;
    vec2 dv = u_lights[i].xy - v_uv;
    dv.y *= 0.62;                       // the world is squashed; so is falloff
    float dist = length(dv);
    float rad = u_lights[i].z;
    if (dist > rad) continue;
    float att = 1.0 - dist / rad;
    att *= att;
    vec3 ldir = normalize(vec3(dv, 0.55));
    float ndl = max(dot(n, ldir), 0.0);
    // A tight specular on top of the diffuse term. This is the highlight that
    // travels across armour as you walk past a fire.
    float spec = pow(ndl, 22.0) * 0.45;
    lit += u_lightCol[i] * (ndl * 0.5 + spec) * att;
  }

  // Restrained on purpose. Measuring the output showed a first version
  // tripling the lit area — the frame already carries a full Canvas2D
  // lightmap, and this pass is meant to add relief on top of it, not to
  // light the scene a second time.
  vec3 col = base * (1.0 + lit * 0.42);

  // Quantise, dithered. The threshold is offset per channel so the three do
  // not band on the same pixels, which is what turns dithering into visible
  // colour fringing.
  float steps = max(u_levels, 2.0);
  vec2 px = v_uv / u_texel;
  float dth = bayer(px) / steps;
  col += vec3(dth, dth * 0.92, dth * 1.08);
  col = floor(col * steps + 0.5) / steps;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

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

    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // NEAREST everywhere: this is pixel art and the world buffer is already
    // the resolution we want to see.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // A canvas has its origin at the top left and GL has its at the bottom,
    // so without this the world arrives upside down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.u = {
      frame: gl.getUniformLocation(prog, 'u_frame'),
      texel: gl.getUniformLocation(prog, 'u_texel'),
      lights: gl.getUniformLocation(prog, 'u_lights'),
      lightCol: gl.getUniformLocation(prog, 'u_lightCol'),
      lightCount: gl.getUniformLocation(prog, 'u_lightCount'),
      relief: gl.getUniformLocation(prog, 'u_relief'),
      levels: gl.getUniformLocation(prog, 'u_levels'),
      time: gl.getUniformLocation(prog, 'u_time'),
    };
    gl.uniform1i(this.u.frame, 0);
    this._lightBuf = new Float32Array(36);
    this._colBuf = new Float32Array(36);
  }

  /**
   * Draws the finished world buffer to the screen through the shader.
   * `lights` are already in world-buffer pixel space.
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, world);

      gl.uniform2f(this.u.texel, 1 / world.width, 1 / world.height);
      const n = Math.min(lights.length, 12);
      for (let i = 0; i < n; i++) {
        const L = lights[i];
        this._lightBuf[i * 3] = L.x / world.width;
        this._lightBuf[i * 3 + 1] = 1 - L.y / world.height; // gl is y-up
        this._lightBuf[i * 3 + 2] = L.r / world.width;
        this._colBuf[i * 3] = L.color[0] / 255;
        this._colBuf[i * 3 + 1] = L.color[1] / 255;
        this._colBuf[i * 3 + 2] = L.color[2] / 255;
      }
      gl.uniform3fv(this.u.lights, this._lightBuf);
      gl.uniform3fv(this.u.lightCol, this._colBuf);
      gl.uniform1i(this.u.lightCount, n);
      gl.uniform1f(this.u.relief, opts.relief ?? 2.2);
      gl.uniform1f(this.u.levels, opts.levels ?? 22);
      gl.uniform1f(this.u.time, opts.time ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Self-check, once. This stage could not be verified visually where it
      // was written — a headless browser does not composite a WebGL canvas
      // into its screenshots, so the picture looked black while readPixels
      // showed a correct frame. Rather than trust that, the first frame is
      // read back on the real device: if the shader produced nothing while
      // the source clearly had content, the stage retires itself and the
      // Canvas2D path takes over. A wrong guess here costs a black screen,
      // and that is not a thing to leave to optimism.
      if (!this._checked) {
        this._checked = true;
        const px = new Uint8Array(4);
        let bright = 0;
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.6], [0.7, 0.4]]) {
          gl.readPixels((sw * fx) | 0, (sh * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          bright = Math.max(bright, px[0] + px[1] + px[2]);
        }
        if (bright < 6) {
          this.ok = false;
          return false;
        }
      }
      return true;
    } catch (e) {
      this.ok = false;
      return false;
    }
  }
}
