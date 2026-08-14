// All sound is synthesised in the browser — no audio files anywhere.
// Impacts are filtered noise bursts, spells are swept oscillators, and the
// score is a slow drone in D minor with a war drum that only wakes up when
// something is trying to kill you.
//
// Three things beyond the sound set make it a place rather than a soundboard:
//
//   * every sound that happens somewhere is played there. A blow landing at
//     the left edge of the screen arrives from the left and quieter, and a
//     wolf howling off in the dark is barely there at all.
//   * each act carries its own bed — surf and gulls on the Haff, wind through
//     needles in the Rominte, drips and frogs in the bog, embers and iron in
//     the Ordensburg, rain and far-off thunder in the grove — built from the
//     same three oscillators and one noise buffer as everything else.
//   * when the hero is nearly dead the whole mix goes underwater and a heart
//     starts up in it. Nobody has to read the health bar to know.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// What the ground sounds like underfoot, keyed by the material an act lays
// down as its base. Sand is a soft hiss, flagstone a hard slap with a knock
// under it, bog a wet suck that swallows the tail.
const FOOT = {
  sand: { freq: 420, q: 1.1, dur: 0.1, gain: 0.06, sweep: 0.55 },
  snow: { freq: 620, q: 0.9, dur: 0.09, gain: 0.05, sweep: 0.4 },
  moss: { freq: 300, q: 1.3, dur: 0.11, gain: 0.05, sweep: 0.5, body: 120 },
  forestFloor: { freq: 340, q: 1.5, dur: 0.12, gain: 0.055, sweep: 0.45, body: 130 },
  mud: { freq: 210, q: 2.2, dur: 0.16, gain: 0.07, sweep: 0.3, body: 90 },
  bogWater: { freq: 240, q: 2.6, dur: 0.2, gain: 0.08, sweep: 0.25, body: 80 },
  peat: { freq: 250, q: 2, dur: 0.15, gain: 0.06, sweep: 0.32, body: 95 },
  flagstone: { freq: 1500, q: 2.6, dur: 0.07, gain: 0.06, sweep: 0.35, body: 230 },
  cobble: { freq: 1300, q: 2.2, dur: 0.08, gain: 0.06, sweep: 0.4, body: 210 },
  ash: { freq: 520, q: 1, dur: 0.11, gain: 0.05, sweep: 0.5 },
  grove: { freq: 320, q: 1.4, dur: 0.12, gain: 0.05, sweep: 0.5, body: 125 },
};

/**
 * The bed each act breathes through.
 *
 * `layers` are looping filtered noise — the constant part, the surf and the
 * wind and the rain. `swell` gives a layer a slow tide in its gain so it
 * never sits still. `drone` is a held oscillator under everything. `events`
 * are the one-shots that make a place feel inhabited: they fire at random
 * intervals between `every` seconds, and because they are ordinary sounds
 * from the set above they can be placed off to one side of the hero.
 */
const BEDS = {
  coast: {
    verb: 0.26,
    layers: [
      { rate: 0.22, type: 'lowpass', freq: 420, q: 0.8, gain: 0.16, swell: [0.06, 0.55] },
      { rate: 0.7, type: 'bandpass', freq: 1500, q: 0.5, gain: 0.045, swell: [0.023, 0.4] },
    ],
    events: [
      { name: 'gull', every: [7, 20], vol: 0.8 },
      { name: 'iceGroan', every: [16, 40], vol: 0.9 },
      { name: 'creakWood', every: [14, 34], vol: 0.6 },
    ],
  },
  forest: {
    verb: 0.34,
    layers: [
      { rate: 0.4, type: 'bandpass', freq: 760, q: 0.55, gain: 0.1, swell: [0.05, 0.7] },
      { rate: 0.15, type: 'lowpass', freq: 240, q: 0.7, gain: 0.06 },
    ],
    events: [
      { name: 'crow', every: [9, 26], vol: 0.75 },
      { name: 'owl', every: [13, 34], vol: 0.7 },
      { name: 'creakWood', every: [10, 28], vol: 0.8 },
      { name: 'wolf', every: [26, 70], vol: 0.85 },
    ],
  },
  bog: {
    verb: 0.42,
    drone: { note: 26, type: 'sine', gain: 0.07 },
    layers: [
      { rate: 0.12, type: 'lowpass', freq: 300, q: 0.6, gain: 0.09, swell: [0.037, 0.5] },
      { rate: 0.9, type: 'bandpass', freq: 3200, q: 1.4, gain: 0.02, swell: [0.09, 0.6] },
    ],
    events: [
      { name: 'drip', every: [1.6, 5], vol: 0.9 },
      { name: 'frog', every: [4, 13], vol: 0.8 },
      { name: 'owl', every: [18, 48], vol: 0.5 },
    ],
  },
  castle: {
    verb: 0.55,
    drone: { note: 31, type: 'triangle', gain: 0.05 },
    layers: [
      { rate: 0.3, type: 'bandpass', freq: 340, q: 0.7, gain: 0.1, swell: [0.041, 0.65] },
      { rate: 1.6, type: 'bandpass', freq: 2600, q: 0.9, gain: 0.025, swell: [0.7, 0.5] },
    ],
    events: [
      { name: 'creakIron', every: [8, 22], vol: 0.8 },
      { name: 'crow', every: [14, 40], vol: 0.6 },
      { name: 'shatter', every: [20, 60], vol: 0.22 },
    ],
  },
  grove: {
    verb: 0.3,
    layers: [
      { rate: 1.8, type: 'highpass', freq: 2000, q: 0.5, gain: 0.055, swell: [0.13, 0.35] },
      { rate: 0.25, type: 'lowpass', freq: 380, q: 0.7, gain: 0.1, swell: [0.06, 0.5] },
    ],
    events: [
      { name: 'farThunder', every: [16, 38], vol: 0.8 },
      { name: 'crow', every: [16, 44], vol: 0.5 },
    ],
  },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVol = 0.8;
    this.musicVol = 0.34;
    this.sfxVol = 0.75;
    this.tension = 0;
    this._noise = null;
    this._lastPlay = new Map();

    // Where the ear is, in world units, and how far across the screen half a
    // view is — the scale that turns a world offset into a stereo image.
    this.lx = 0;
    this.ly = 0;
    this.lRange = 900;
    this.stress = 0;
    this.bedName = null;
    this.footMaterial = 'sand';
    this._nextBeat2 = 0;
    this._nextEvent = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVol;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;

    // A short plate-ish reverb baked from noise; gives the caves and forests
    // a bit of space without shipping an impulse response.
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.makeImpulse(2.4, 3.2);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.3;

    // The bed each act breathes through — its own bus so it can be swapped
    // and cross-faded without touching the score.
    this.bedBus = ctx.createGain();
    this.bedBus.gain.value = 0.9;

    // Everything passes through this on the way out. Open at 20kHz it is
    // inaudible; dropped to a few hundred hertz as the hero bleeds out, it
    // puts the whole world behind a wall — the oldest trick there is for
    // "you are about to die", and it needs no HUD.
    this.stressFilter = ctx.createBiquadFilter();
    this.stressFilter.type = 'lowpass';
    this.stressFilter.frequency.value = 20000;
    this.stressFilter.Q.value = 0.7;

    this.sfxBus.connect(this.comp);
    this.sfxBus.connect(this.verbGain);
    this.verbGain.connect(this.verb);
    this.verb.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.bedBus.connect(this.comp);
    this.bedBus.connect(this.verbGain);
    this.comp.connect(this.stressFilter);
    this.stressFilter.connect(this.master);
    this.master.connect(ctx.destination);

    this._noise = this.makeNoise(2);
    this.ready = true;
    this.startMusic();
    if (this.bedName) this.setAmbience(this.bedName, true);
  }

  makeImpulse(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.masterVol;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Where the ear is. The camera follows the hero, so this is called with the
   * hero's position every frame; `range` is half a screen in world units, and
   * everything else is measured against it.
   */
  setListener(x, y, range) {
    this.lx = x;
    this.ly = y;
    if (range > 1) this.lRange = range;
  }

  /**
   * Turns a world position into a stereo image and a volume.
   *
   * The world is drawn squashed two to one, so a monster twenty paces north
   * looks half as far away as one twenty paces east — and should sound it, or
   * the ear and the eye disagree. Falloff is inverse-square against half a
   * screen, floored so that nothing on screen ever vanishes entirely and
   * capped so nothing off it can shout.
   */
  place(x, y) {
    const dx = x - this.lx;
    const dy = (y - this.ly) * 0.5;
    const d = Math.sqrt(dx * dx + dy * dy) / this.lRange;
    const gain = 1 / (1 + d * d * 2.6);
    // Panning is deliberately short of hard left and right: a hit at the edge
    // of the screen is still in front of you, not behind your shoulder.
    const pan = clamp(dx / this.lRange, -1, 1) * 0.72;
    return { gain, pan };
  }

  /** A panner and gain for one sound, spliced in front of the sfx bus. */
  placedDest(gain, pan) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    return g;
  }

  /** Rate-limits a sound so twenty simultaneous hits don't clip. */
  throttle(key, ms) {
    const t = performance.now();
    const last = this._lastPlay.get(key) || 0;
    if (t - last < ms) return false;
    this._lastPlay.set(key, t);
    return true;
  }

  noiseSource(playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    return s;
  }

  /** Core helper: noise through a band-pass with an envelope. */
  noiseHit(opts) {
    if (!this.ready) return;
    const { freq = 800, q = 1.2, dur = 0.14, gain = 0.5, type = 'bandpass', sweep = 0, delay = 0 } = opts;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = this.noiseSource(opts.rate || 1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(opts.dest || this._dest || this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  tone(opts) {
    if (!this.ready) return;
    const {
      freq = 440,
      to = null,
      dur = 0.2,
      gain = 0.3,
      type = 'sine',
      delay = 0,
      detune = 0,
      attack = 0.005,
    } = opts;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(opts.dest || this._dest || this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // -- the sound set --------------------------------------------------------

  /**
   * `opts.x`/`opts.y` place the sound in the world. Everything the switch
   * below builds is routed through `_dest` while it runs, which is either the
   * plain sfx bus or a panned, attenuated tap on it — so no case has to know
   * or care where it is being heard from.
   */
  play(name, opts = {}) {
    if (!this.ready) return;
    let dest = null;
    if (opts.x !== undefined && opts.y !== undefined) {
      const p = this.place(opts.x, opts.y);
      // Far enough off screen that it would be inaudible anyway. Dropping it
      // here saves the oscillators as well as the ear.
      if (p.gain < 0.04) return;
      dest = this.placedDest(p.gain, p.pan);
    }
    this._dest = dest;
    this.emit(name, opts.vol ?? 1, opts);
    this._dest = null;
  }

  emit(name, v, opts = {}) {
    switch (name) {
      case 'swing':
        if (!this.throttle('swing', 60)) return;
        this.noiseHit({ freq: 2600, q: 0.8, dur: 0.17, gain: 0.14 * v, sweep: 0.22 });
        break;
      case 'hitFlesh':
        if (!this.throttle('hitFlesh', 40)) return;
        this.noiseHit({ freq: 320, q: 1.1, dur: 0.13, gain: 0.4 * v, sweep: 0.4 });
        this.tone({ freq: 90, to: 46, dur: 0.11, gain: 0.22 * v, type: 'triangle' });
        break;
      case 'hitArmor':
        if (!this.throttle('hitArmor', 40)) return;
        this.noiseHit({ freq: 3400, q: 2.4, dur: 0.19, gain: 0.24 * v, sweep: 0.3 });
        this.tone({ freq: 1200, to: 420, dur: 0.13, gain: 0.14 * v, type: 'square' });
        break;
      case 'hitBone':
        this.noiseHit({ freq: 1500, q: 3, dur: 0.11, gain: 0.3 * v, sweep: 0.25 });
        break;
      case 'crit':
        this.noiseHit({ freq: 900, q: 0.8, dur: 0.26, gain: 0.5 * v, sweep: 0.18 });
        this.tone({ freq: 160, to: 55, dur: 0.24, gain: 0.3 * v, type: 'sawtooth' });
        break;
      case 'hurt':
        this.tone({ freq: 220, to: 110, dur: 0.28, gain: 0.26 * v, type: 'sawtooth' });
        this.noiseHit({ freq: 500, q: 0.7, dur: 0.2, gain: 0.22 * v, sweep: 0.4 });
        break;
      case 'death':
        this.tone({ freq: 180, to: 42, dur: 0.7, gain: 0.3 * v, type: 'sawtooth' });
        this.noiseHit({ freq: 700, q: 0.6, dur: 0.6, gain: 0.24 * v, sweep: 0.15 });
        break;
      case 'monsterDie':
        if (!this.throttle('monsterDie', 50)) return;
        this.tone({ freq: 260 + Math.random() * 90, to: 60, dur: 0.42, gain: 0.2 * v, type: 'sawtooth' });
        this.noiseHit({ freq: 420, q: 0.8, dur: 0.35, gain: 0.2 * v, sweep: 0.25 });
        break;
      case 'growl':
        if (!this.throttle('growl', 400)) return;
        this.tone({ freq: 78, to: 52, dur: 0.6, gain: 0.2 * v, type: 'sawtooth' });
        this.noiseHit({ freq: 200, q: 1.6, dur: 0.55, gain: 0.14 * v, sweep: 0.7 });
        break;
      case 'fire':
        this.noiseHit({ freq: 900, q: 0.5, dur: 0.5, gain: 0.3 * v, sweep: 0.2 });
        this.tone({ freq: 320, to: 90, dur: 0.4, gain: 0.16 * v, type: 'sawtooth' });
        break;
      case 'frost':
        this.noiseHit({ freq: 5200, q: 4, dur: 0.4, gain: 0.2 * v, sweep: 0.35 });
        this.tone({ freq: 1400, to: 620, dur: 0.35, gain: 0.12 * v, type: 'triangle' });
        break;
      case 'thunder':
        this.noiseHit({ freq: 2400, q: 0.6, dur: 0.1, gain: 0.5 * v, sweep: 0.1 });
        this.tone({ freq: 70, to: 30, dur: 0.8, gain: 0.34 * v, type: 'sawtooth', delay: 0.02 });
        this.noiseHit({ freq: 400, q: 0.4, dur: 0.9, gain: 0.24 * v, sweep: 0.3, delay: 0.03 });
        break;
      case 'holy':
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: NOTE(74 + i * 5), dur: 0.9, gain: 0.1 * v, type: 'sine', delay: i * 0.04, attack: 0.08 });
        }
        break;
      case 'cast':
        this.tone({ freq: 300, to: 900, dur: 0.25, gain: 0.16 * v, type: 'triangle' });
        break;
      case 'dash':
        this.noiseHit({ freq: 1800, q: 0.6, dur: 0.24, gain: 0.2 * v, sweep: 0.2 });
        break;
      case 'potion':
        this.tone({ freq: 500, to: 1300, dur: 0.3, gain: 0.2 * v, type: 'sine' });
        this.noiseHit({ freq: 2600, q: 3, dur: 0.2, gain: 0.1 * v, sweep: 1.6 });
        break;
      case 'coin':
        if (!this.throttle('coin', 45)) return;
        this.tone({ freq: 1900 + Math.random() * 500, to: 2700, dur: 0.1, gain: 0.1 * v, type: 'square' });
        break;
      case 'loot':
        this.tone({ freq: NOTE(76), dur: 0.28, gain: 0.14 * v, type: 'sine' });
        this.tone({ freq: NOTE(83), dur: 0.36, gain: 0.11 * v, type: 'sine', delay: 0.07 });
        break;
      case 'legendary':
        for (let i = 0; i < 4; i++) {
          this.tone({ freq: NOTE(69 + i * 4), dur: 1.2, gain: 0.13 * v, type: 'triangle', delay: i * 0.09, attack: 0.02 });
        }
        this.noiseHit({ freq: 6000, q: 2, dur: 1.1, gain: 0.09 * v, sweep: 0.2 });
        break;
      case 'levelUp':
        for (let i = 0; i < 5; i++) {
          this.tone({ freq: NOTE(62 + i * 4), dur: 0.7, gain: 0.14 * v, type: 'triangle', delay: i * 0.075 });
        }
        break;
      case 'ui':
        this.tone({ freq: 620, to: 760, dur: 0.06, gain: 0.1 * v, type: 'square' });
        break;
      case 'uiBig':
        this.tone({ freq: 180, to: 300, dur: 0.24, gain: 0.16 * v, type: 'triangle' });
        break;
      case 'portal':
        this.tone({ freq: 120, to: 900, dur: 1.4, gain: 0.16 * v, type: 'sine', attack: 0.3 });
        this.noiseHit({ freq: 700, q: 1.2, dur: 1.4, gain: 0.14 * v, sweep: 3 });
        break;
      case 'bossRoar':
        this.tone({ freq: 62, to: 34, dur: 1.6, gain: 0.4 * v, type: 'sawtooth' });
        this.tone({ freq: 94, to: 52, dur: 1.5, gain: 0.24 * v, type: 'square', delay: 0.05 });
        this.noiseHit({ freq: 300, q: 0.8, dur: 1.7, gain: 0.26 * v, sweep: 0.4 });
        break;
      case 'chest':
        this.noiseHit({ freq: 1400, q: 1.4, dur: 0.3, gain: 0.24 * v, sweep: 0.3 });
        this.tone({ freq: 260, to: 520, dur: 0.4, gain: 0.14 * v, type: 'triangle' });
        break;
      case 'shatter':
        this.noiseHit({ freq: 4200, q: 1.8, dur: 0.4, gain: 0.28 * v, sweep: 0.25 });
        break;
      case 'step': {
        if (!this.throttle('step', 130)) return;
        // A boot in wet sand is not a boot on flagstone. The act tells the
        // mixer what the ground is made of when it loads, and one line of
        // table turns the same noise burst into five surfaces.
        const f = FOOT[this.footMaterial] || FOOT.sand;
        this.noiseHit({
          freq: f.freq * (0.85 + Math.random() * 0.3),
          q: f.q,
          dur: f.dur,
          gain: f.gain * v,
          sweep: f.sweep,
        });
        if (f.body) {
          this.tone({ freq: f.body, to: f.body * 0.6, dur: 0.07, gain: 0.05 * v, type: 'triangle' });
        }
        break;
      }
      case 'gull':
        this.tone({ freq: 1250, to: 900, dur: 0.16, gain: 0.09 * v, type: 'sawtooth', attack: 0.02 });
        this.tone({ freq: 1180, to: 820, dur: 0.2, gain: 0.07 * v, type: 'sawtooth', delay: 0.22, attack: 0.03 });
        break;
      case 'crow':
        for (let i = 0; i < 2; i++) {
          this.noiseHit({ freq: 1100, q: 5, dur: 0.13, gain: 0.1 * v, sweep: 0.55, delay: i * 0.21 });
          this.tone({ freq: 420, to: 300, dur: 0.12, gain: 0.06 * v, type: 'square', delay: i * 0.21 });
        }
        break;
      case 'owl':
        this.tone({ freq: 420, to: 380, dur: 0.34, gain: 0.07 * v, type: 'sine', attack: 0.09 });
        this.tone({ freq: 400, to: 350, dur: 0.4, gain: 0.06 * v, type: 'sine', delay: 0.42, attack: 0.1 });
        break;
      case 'wolf':
        this.tone({ freq: 300, to: 420, dur: 1.5, gain: 0.07 * v, type: 'sawtooth', attack: 0.5 });
        this.tone({ freq: 152, to: 210, dur: 1.6, gain: 0.05 * v, type: 'triangle', attack: 0.5 });
        break;
      case 'drip':
        this.tone({ freq: 900 + Math.random() * 700, to: 2200, dur: 0.09, gain: 0.07 * v, type: 'sine' });
        break;
      case 'frog':
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 190, to: 150, dur: 0.06, gain: 0.06 * v, type: 'square', delay: i * 0.085 });
        }
        break;
      case 'creakIron':
        this.noiseHit({ freq: 620, q: 12, dur: 0.75, gain: 0.06 * v, sweep: 1.7 });
        this.tone({ freq: 190, to: 240, dur: 0.7, gain: 0.03 * v, type: 'sawtooth', attack: 0.2 });
        break;
      case 'creakWood':
        this.noiseHit({ freq: 340, q: 9, dur: 0.6, gain: 0.07 * v, sweep: 1.5 });
        break;
      case 'iceGroan':
        this.tone({ freq: 88, to: 62, dur: 1.3, gain: 0.08 * v, type: 'sawtooth', attack: 0.35 });
        this.noiseHit({ freq: 260, q: 7, dur: 1.1, gain: 0.05 * v, sweep: 0.6 });
        break;
      case 'farThunder':
        this.noiseHit({ freq: 180, q: 0.5, dur: 2.2, gain: 0.16 * v, sweep: 0.35 });
        this.tone({ freq: 46, to: 28, dur: 1.9, gain: 0.12 * v, type: 'sine', attack: 0.25 });
        break;
      case 'heartbeat':
        this.tone({ freq: 62, to: 38, dur: 0.2, gain: 0.4 * v, type: 'sine', attack: 0.012 });
        this.tone({ freq: 54, to: 32, dur: 0.26, gain: 0.3 * v, type: 'sine', delay: 0.17, attack: 0.014 });
        break;
    }
  }

  // -- music ----------------------------------------------------------------

  startMusic() {
    const ctx = this.ctx;
    if (!ctx || this.musicStarted) return;
    this.musicStarted = true;

    // Two detuned saw drones an octave apart, gently filtered — the bed.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.5;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 420;
    this.droneFilter.Q.value = 1.1;
    this.droneGain.connect(this.droneFilter);
    this.droneFilter.connect(this.musicBus);

    this.droneOsc = [];
    const root = NOTE(38); // D2
    for (const [mult, det, g] of [
      [1, -7, 0.3],
      [1, 6, 0.28],
      [2, 3, 0.16],
      [3, -4, 0.08],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = root * mult;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(this.droneGain);
      o.start();
      this.droneOsc.push({ o, og, mult });
    }

    // Wind: filtered noise with a slowly wandering cutoff.
    const wind = this.noiseSource(0.35);
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 500;
    wf.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.1;
    wind.connect(wf);
    wf.connect(this.windGain);
    this.windGain.connect(this.musicBus);
    wind.start();
    this.windFilter = wf;

    // A choir-ish pad that fades in during boss fights.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.musicBus);
    for (const n of [50, 53, 57, 62]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = NOTE(n);
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain();
      g.gain.value = 0.08;
      o.connect(g);
      g.connect(this.padGain);
      o.start();
    }

    this.musicBus.gain.setTargetAtTime(this.musicVol, ctx.currentTime, 2.5);
    this.nextBeat = ctx.currentTime + 1;
    this.beat = 0;
  }

  /** Drives the drum and the harmonic drift. Call every frame. */
  update(dt, tension) {
    if (!this.ready) return;
    const ctx = this.ctx;
    this.tension += (tension - this.tension) * Math.min(1, dt * 1.5);
    const T = this.tension;

    this.updateAmbience(dt);

    // Bleeding out. Nothing happens until half health is gone, then the top
    // of the mix closes down and a heart starts, quickening as it gets worse.
    const S = Math.max(0, (this.stress - 0.45) / 0.55);
    if (this.stressFilter) {
      this.stressFilter.frequency.setTargetAtTime(20000 - S * S * 19200, ctx.currentTime, 0.35);
    }
    if (S > 0.05) {
      const period = 1.5 - S * 0.75;
      if (ctx.currentTime > this._nextBeat2) {
        this._nextBeat2 = ctx.currentTime + period;
        this.play('heartbeat', { vol: 0.35 + S * 0.75 });
      }
    } else {
      this._nextBeat2 = ctx.currentTime;
    }

    if (this.droneFilter) {
      this.droneFilter.frequency.setTargetAtTime(360 + T * 900, ctx.currentTime, 0.4);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(
        420 + Math.sin(ctx.currentTime * 0.13) * 260,
        ctx.currentTime,
        1.2
      );
    }
    if (this.padGain) {
      this.padGain.gain.setTargetAtTime(T > 0.75 ? 0.5 : 0, ctx.currentTime, 1.5);
    }

    // War drum, faster and louder the deeper the trouble.
    const bpm = 52 + T * 34;
    const interval = 60 / bpm;
    while (ctx.currentTime > this.nextBeat) {
      this.nextBeat += interval;
      this.beat++;
      if (T < 0.12 && this.beat % 4 !== 0) continue;
      const strong = this.beat % 4 === 0;
      const g = (strong ? 0.3 : 0.13) * (0.35 + T);
      this.tone({
        freq: strong ? 68 : 54,
        to: strong ? 34 : 30,
        dur: strong ? 0.36 : 0.2,
        gain: g * 0.55,
        type: 'sine',
      });
      this.noiseHit({ freq: 180, q: 1.1, dur: 0.16, gain: g * 0.28, sweep: 0.4 });
    }
  }

  // -- ambience -------------------------------------------------------------

  /**
   * Swaps the act's bed. The old one fades out over a second and a half and
   * is torn down after; the new one fades up over the same, so walking
   * through a portal is a crossfade rather than a cut.
   */
  setAmbience(name, force = false) {
    this.bedName = name;
    if (!this.ready) return;
    if (this.bed && this.bed.name === name && !force) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    if (this.bed) {
      const old = this.bed;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, 0.5);
      for (const s of old.sources) {
        try {
          s.stop(t + 2);
        } catch {
          // A source that never started, or one already stopped; either way
          // there is nothing to wind down.
        }
      }
      setTimeout(() => old.gain.disconnect(), 2600);
    }

    const cfg = BEDS[name];
    this.bed = null;
    if (!cfg) return;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.bedBus);
    const sources = [];
    const layers = [];

    for (const L of cfg.layers) {
      const src = this.noiseSource(L.rate);
      const f = ctx.createBiquadFilter();
      f.type = L.type;
      f.frequency.value = L.freq;
      f.Q.value = L.q;
      const g = ctx.createGain();
      g.gain.value = L.gain;
      src.connect(f);
      f.connect(g);
      g.connect(gain);
      src.start();
      sources.push(src);
      layers.push({ g, f, base: L.gain, swell: L.swell, phase: Math.random() * 6.28 });
    }

    if (cfg.drone) {
      const o = ctx.createOscillator();
      o.type = cfg.drone.type;
      o.frequency.value = NOTE(cfg.drone.note);
      const g = ctx.createGain();
      g.gain.value = cfg.drone.gain;
      o.connect(g);
      g.connect(gain);
      o.start();
      sources.push(o);
    }

    gain.gain.setTargetAtTime(1, t, 0.6);
    if (this.verbGain) this.verbGain.gain.setTargetAtTime(cfg.verb ?? 0.3, t, 1.2);

    this.bed = { name, gain, sources, layers, events: cfg.events || [] };
    this._eventDue = this.bed.events.map((e) => 1 + Math.random() * (e.every[1] - e.every[0]));
  }

  /** What the hero is walking on, so `step` can pick the right surface. */
  setFootMaterial(name) {
    this.footMaterial = name;
  }

  /**
   * How close to death the hero is, 0 to 1. Past halfway the mix starts going
   * under water and a heart comes up in it, both scaled so that the last
   * sliver of health is unmistakable.
   */
  setStress(s) {
    this.stress = clamp(s, 0, 1);
  }

  /** Drives the bed's slow swells and its one-shots. Called every frame. */
  updateAmbience(dt) {
    const bed = this.bed;
    if (!bed) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const L of bed.layers) {
      if (!L.swell) continue;
      const [rate, depth] = L.swell;
      const s = 1 + Math.sin(t * rate * 6.28 + L.phase) * depth;
      L.g.gain.setTargetAtTime(L.base * s, t, 0.3);
    }
    for (let i = 0; i < bed.events.length; i++) {
      this._eventDue[i] -= dt;
      if (this._eventDue[i] > 0) continue;
      const e = bed.events[i];
      this._eventDue[i] = e.every[0] + Math.random() * (e.every[1] - e.every[0]);
      // Somewhere out in the dark, off to one side. A gull directly on top of
      // the hero is a gull in the room with him.
      const a = Math.random() * 6.28;
      const d = this.lRange * (1.1 + Math.random() * 1.5);
      this.play(e.name, {
        vol: e.vol ?? 1,
        x: this.lx + Math.cos(a) * d,
        y: this.ly + Math.sin(a) * d * 2,
      });
    }
  }

  /** Shifts the drone to a new root for a new act. */
  setKey(semitone) {
    if (!this.droneOsc) return;
    const root = NOTE(semitone);
    for (const d of this.droneOsc) {
      d.o.frequency.setTargetAtTime(root * d.mult, this.ctx.currentTime, 1.5);
    }
  }
}

export const audio = new Audio();
