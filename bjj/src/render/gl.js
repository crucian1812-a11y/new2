// Thin WebGL2 helpers. Nothing clever — just the boilerplate that would
// otherwise be copied into every pass.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false, // we render to an offscreen target and resolve there
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  return gl;
}

export function program(gl, vsSrc, fsSrc, name = 'shader') {
  const vs = shader(gl, gl.VERTEX_SHADER, vsSrc, name + ':vs');
  const fs = shader(gl, gl.FRAGMENT_SHADER, fsSrc, name + ':fs');
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(name + ' link: ' + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  // Cache every uniform location once; getUniformLocation on a hot path is a
  // string lookup into the driver and it shows up in a profile.
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const base = info.name.replace(/\[0\]$/, '');
    u[base] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function shader(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`${name}: ${log}\n${numbered}`);
  }
  return s;
}

export function buffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}

// attribs: [{ name|loc, data, size, type?, normalized? }]
export function vao(gl, prog, attribs, indices) {
  const a = gl.createVertexArray();
  gl.bindVertexArray(a);
  for (const at of attribs) {
    const loc = at.loc !== undefined ? at.loc : gl.getAttribLocation(prog, at.name);
    if (loc < 0) continue;
    buffer(gl, at.data);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, at.size, at.type || gl.FLOAT, !!at.normalized, 0, 0);
  }
  if (indices) buffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER);
  gl.bindVertexArray(null);
  return a;
}

export function texture(gl, opts) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const {
    width, height, data = null, internalFormat = gl.RGBA8, format = gl.RGBA,
    type = gl.UNSIGNED_BYTE, filter = gl.LINEAR, wrap = gl.REPEAT, mips = false,
  } = opts;
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

export function framebuffer(gl, colorTex, depthTex) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  if (colorTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}

export const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3]);
