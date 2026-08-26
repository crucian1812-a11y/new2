// Sound, synthesised. No files, so nothing to wait for and nothing to fail to
// load on a phone that has just lost signal.
//
// The mix is mostly the room: a hall of a few hundred people is a wide band of
// noise that swells and settles, and getting that one layer right does more for
// the feel of a competition than any number of impact samples would.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.crowdGain = null;
    this.master = null;
  }

  // Browsers will not start an audio context until a gesture, so this is called
  // from the first tap rather than at load.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._crowd();
  }

  _crowd() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Brown-ish noise: a crowd has far more energy low down than white noise
    // does, and white noise over a speaker just sounds like rain.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 0.55;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.1;
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
    this.crowdSrc = src;
  }

  // The room reacts. A swell is a short lift in the crowd bed, which is all a
  // cheer is when you are standing on the mat and not in the seats.
  swell(amount = 0.5, dur = 1.6) {
    if (!this.ctx || this.muted) return;
    const g = this.crowdGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.1 + amount * 0.5, t + 0.12);
    g.exponentialRampToValueAtTime(0.1, t + dur);
  }

  _env(node, t, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(this.master);
    return g;
  }

  // A body landing. Low sine drop plus a noise slap; the ratio between the two
  // is the difference between a mat and a boxing ring.
  thud(force = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 * (0.8 + force * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    this._env(o, t, 0.006, 0.24, 0.5 * force);
    o.start(t);
    o.stop(t + 0.3);
    this.noise(t, 1400, 0.09, 0.16 * force);
  }

  // Cloth. A gi is loud, and the sound of a grip being taken is most of what
  // tells you the two of them are actually touching.
  cloth(force = 1) {
    if (!this.ctx || this.muted) return;
    this.noise(this.ctx.currentTime, 2600, 0.13, 0.1 * force, 'highpass');
  }

  noise(t, freq, dur, peak, type = 'lowpass') {
    const ctx = this.ctx;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    s.connect(f);
    this._env(f, t, 0.004, dur, peak);
    s.start(t);
  }

  beep(freq, dur = 0.12, type = 'square', peak = 0.18) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this._env(o, t, 0.005, dur, peak);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  whistle() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2100, t);
    o.frequency.linearRampToValueAtTime(2450, t + 0.28);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 34;
    const lg = this.ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.4);
    this._env(o, t, 0.02, 0.34, 0.16);
    o.start(t);
    o.stop(t + 0.4);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}
