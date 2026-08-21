// All sound is synthesised in the browser — no audio files anywhere.
// Impacts are filtered noise bursts, spells are swept oscillators, and the
// score is a slow drone in D minor with a war drum that only wakes up when
// something is trying to kill you.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

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

    this.sfxBus.connect(this.comp);
    this.sfxBus.connect(this.verbGain);
    this.verbGain.connect(this.verb);
    this.verb.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);

    this._noise = this.makeNoise(2);
    this.ready = true;
    this.startMusic();
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
    g.connect(this.sfxBus);
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
    g.connect(this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // -- the sound set --------------------------------------------------------

  play(name, opts = {}) {
    if (!this.ready) return;
    const v = opts.vol ?? 1;
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
      case 'step':
        if (!this.throttle('step', 130)) return;
        this.noiseHit({ freq: 260 + Math.random() * 160, q: 1.4, dur: 0.09, gain: 0.06 * v, sweep: 0.5 });
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
