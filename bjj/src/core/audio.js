// Sound.
//
// Two layers, and which one you hear depends on what has arrived. The room and
// every impact in the game are synthesised — no files, nothing to wait for,
// nothing to fail to load on a phone that has just lost signal — and on top of
// that, when the pack in `assets/audio` has finished downloading, the sampled
// version of the same event takes over. Loading happens after the first tap,
// in the background, and never blocks a frame; if it never finishes, the game
// sounds the way it did before the pack existed.
//
// That is not belt and braces, it is the honest shape of the problem. A gi
// slap and a referee's whistle are the one place in this project where a
// recording beats anything that can be built out of oscillators, and a first
// frame that waits on a megabyte of ogg is worse than any of it.
//
// The pack is measured by `tools/audio-check.mjs`, and two of its numbers are
// wired into this file: the loops are crossfaded rather than looped, because
// two of them do not join up (the final-minute track jumps almost half its own
// level at the seam), and every repeated one-shot is detuned a little, because
// three cloth samples on their own become a rhythm inside ten seconds.

const BASE = new URL('../../assets/audio/', import.meta.url).href;

// One-shots. Cheap enough to hold all of them: measured at 153 KB for the lot.
const SFX = {
  bell: 'sfx/round_bell.ogg',
  whistle: 'sfx/referee_whistle.ogg',
  tap: 'sfx/submission_tap.ogg',
  lock: 'sfx/submission_lock.ogg',
  cheerBig: 'sfx/crowd_cheer_big.ogg',
  cheerSmall: 'sfx/crowd_cheer_small.ogg',
  whoosh: 'sfx/arena_transition_whoosh.ogg',
  beepTimer: 'sfx/timer_beep.ogg',
  click: 'sfx/ui_click.ogg',
  confirm: 'sfx/ui_confirm.ogg',
  slamHeavy: 'sfx/mat_slam_heavy.ogg',
  slamLight: 'sfx/mat_slam_light.ogg',
  impact1: 'sfx/body_impact_1.ogg',
  impact2: 'sfx/body_impact_2.ogg',
  cloth1: 'sfx/gi_grapple_cloth_1.ogg',
  cloth2: 'sfx/gi_grapple_cloth_2.ogg',
  cloth3: 'sfx/gi_grapple_cloth_3.ogg',
  step1: 'sfx/tatami_step_1.ogg',
  step2: 'sfx/tatami_step_2.ogg',
  crowd: 'sfx/crowd_ambient_loop_10s.ogg',
};

// Music is fetched one track at a time and dropped when the track changes: a
// thirty-seven second stereo loop is thirteen megabytes once decoded, and
// three of those resident on a phone for the sake of an instant switch is a
// bad trade for a switch that happens twice a match.
const MUSIC = {
  menu: 'music/01_menu_dojo_loop.ogg',
  match: 'music/02_match_grapple_loop.ogg',
  final: 'music/03_final_minute_loop.ogg',
  victory: 'music/04_victory_sting.ogg',
  defeat: 'music/05_defeat_sting.ogg',
};

// How long the tail of a loop is faded into its own head. Long enough to hide
// a seam that does not join, short enough that a bar is not heard twice.
const SEAM = 0.6;

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.crowdGain = null;
    this.master = null;
    this.sfx = {};            // name -> AudioBuffer, as they arrive
    this.music = null;        // { key, gain, sources, timer }
    this.musicVol = 0.34;
    this.loaded = false;
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
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol;
    this.musicGain.connect(this.master);
    this._crowd();
    this._load();
  }

  // ------------------------------------------------------------- loading

  async _load() {
    const one = async (name, path) => {
      try {
        const res = await fetch(BASE + path);
        if (!res.ok) return;
        this.sfx[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* the synth is still there; that is the whole point */ }
    };
    // Sequentially, not all twenty at once: this is running behind a game that
    // is already drawing, and twenty parallel fetches on a phone is how you
    // lose a second of frames to the network stack.
    for (const [name, path] of Object.entries(SFX)) await one(name, path);
    this.loaded = true;
    // The sampled room replaces the synthesised one the moment it is here.
    if (this.sfx.crowd) this._crowdFromSample();
  }

  // -------------------------------------------------------------- the room

  // Synthesised until the recording lands. Brown-ish noise: a crowd has far
  // more energy low down than white noise does, and white noise over a phone
  // speaker just sounds like rain.
  _crowd() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
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
    this.crowdGain.connect(this.master);
    // The synthesised bed hangs off its own gain under the shared one, so it
    // can be faded out from under the recording without taking the swell
    // automation — which lives on crowdGain — with it.
    this.synthCrowd = ctx.createGain();
    this.synthCrowd.gain.value = 1;
    src.connect(bp).connect(this.synthCrowd).connect(this.crowdGain);
    src.start();
    this.crowdSrc = src;
  }

  // The ten-second recording, laid over itself so its seam is never heard.
  // Measured at 0.09 of its own level — small, but a tick every ten seconds
  // for a five minute match is thirty ticks.
  _crowdFromSample() {
    const t = this.ctx.currentTime;
    // Hand the bed over rather than cutting: the synth fades out under the
    // recording fading in, and nothing in the room jumps.
    this.crowdTimer = this._loopCrossfaded(this.sfx.crowd, this.crowdGain);
    const g = this.synthCrowd.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 1.2);
    try { this.crowdSrc.stop(t + 1.4); } catch { /* already stopped */ }
    this.crowdSrc = null;
  }

  // A buffer looped by starting the next lap before the current one ends and
  // crossfading between them. `loop = true` on a source cannot do this, and
  // two of the pack's loops need it.
  _loopCrossfaded(buf, dest) {
    const ctx = this.ctx;
    const lap = Math.max(SEAM * 2, buf.duration - SEAM);
    let when = ctx.currentTime + 0.02;
    const fire = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(1, when + SEAM);
      g.gain.setValueAtTime(1, when + lap);
      g.gain.linearRampToValueAtTime(0.0001, when + lap + SEAM);
      src.connect(g).connect(dest);
      src.start(when);
      src.stop(when + lap + SEAM + 0.05);
      when += lap;
      return src;
    };
    fire();
    // One lap ahead, forever, on the audio clock rather than on a frame.
    const timer = setInterval(() => {
      if (!this.ctx) return clearInterval(timer);
      while (when < ctx.currentTime + lap) fire();
    }, Math.max(200, lap * 250));
    return timer;
  }

  // The room reacts. A swell is a short lift in the crowd bed, which is all a
  // cheer is when you are standing on the mat and not in the seats — and on
  // top of it, when the recording is here, an actual crowd.
  swell(amount = 0.5, dur = 1.6) {
    if (!this.ctx || this.muted) return;
    const g = this.crowdGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.1 + amount * 0.5, t + 0.12);
    g.exponentialRampToValueAtTime(0.1, t + dur);
    if (amount >= 0.5) this._play(amount >= 0.75 ? 'cheerBig' : 'cheerSmall', 0.45 * amount);
  }

  // ------------------------------------------------------------- one-shots

  // Play a sample if it is here. Returns false when it is not, which is what
  // lets every method below read as "the recording, or the old synthesis".
  _play(name, gain = 1, detune = 0) {
    const buf = this.sfx[name];
    if (!buf || !this.ctx || this.muted) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // A hundredth of a semitone is nothing; three percent of pitch is the
    // difference between three cloth samples and a loop.
    if (detune) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * detune;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start(this._at());
    return true;
  }

  _pick(...names) {
    const have = names.filter((n) => this.sfx[n]);
    return have.length ? have[(Math.random() * have.length) | 0] : null;
  }

  // A body landing.
  thud(force = 1) {
    if (!this.ctx || this.muted) return;
    const heavy = force > 0.75;
    const name = this._pick(...(heavy ? ['slamHeavy', 'impact1'] : ['slamLight', 'impact2']));
    if (name && this._play(name, 0.9 * force, 0.03)) return;
    // Low sine drop plus a noise slap; the ratio between the two is the
    // difference between a mat and a boxing ring.
    const t = this._at();
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
    const name = this._pick('cloth1', 'cloth2', 'cloth3');
    if (name && this._play(name, 0.95 * force, 0.03)) return;
    // Measured, not guessed: at 2.6 kHz and a peak of 0.1 the synthesised gi
    // slap came out at -57 dBFS against a room at -32, which is not quiet, it
    // is inaudible. A gi has body as well as hiss.
    this.noise(this._at(), 1800, 0.16, 0.34 * force, 'highpass');
  }

  // A foot moving on tatami. The pack has this and the synth never did.
  step(force = 0.6) {
    const name = this._pick('step1', 'step2');
    if (name) this._play(name, 0.9 * force, 0.04);
  }

  whistle() {
    if (!this.ctx || this.muted) return;
    if (this._play('whistle', 0.8)) return;
    const t = this._at();
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
    this._env(o, t, 0.02, 0.34, 0.32);
    o.start(t);
    o.stop(t + 0.4);
  }

  // The gains are not taste. Every one of these was measured at match volume
  // against the crowd bed by `tools/sound-check.mjs`, and the two short dry
  // ones — the tap and the UI click — came in three decibels *under* the room
  // at the level their own files suggest. A finish nobody hears is not a
  // finish.
  bell() { if (!this._play('bell', 0.75)) this.beep(1180, 0.5, 'sine', 0.34); }
  tap(force = 1) { if (!this._play('tap', 2.2 * force)) this.beep(300, 0.08, 'square', 0.2); }
  lock() { if (!this._play('lock', 0.85)) this.cloth(1); }
  whoosh() { this._play('whoosh', 0.5); }
  click() { if (!this._play('click', 2.2)) this.beep(760, 0.05, 'square', 0.1); }
  confirm() { if (!this._play('confirm', 0.6)) this.beep(980, 0.1, 'triangle', 0.14); }
  timer() { if (!this._play('beepTimer', 0.6)) this.beep(880, 0.08, 'square', 0.12); }

  beep(freq, dur = 0.12, type = 'square', peak = 0.18) {
    if (!this.ctx || this.muted) return;
    const t = this._at();
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this._env(o, t, 0.005, dur, peak);
    o.start(t);
    o.stop(t + dur + 0.05);
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

  // A hair of lookahead on everything scheduled.
  //
  // An envelope that starts at `currentTime` starts in the past: the context
  // has already rendered a block or two beyond the clock the main thread can
  // read, so the attack lands inside audio that has been mixed and the sound
  // comes out as its own tail. On a phone that is an occasional soft note; in
  // a headless browser, which renders in long bursts, it is twenty to forty
  // decibels and it made the synthesised fallback look inaudible when it was
  // not. Twenty milliseconds is under the threshold where a hit feels late.
  _at() { return this.ctx.currentTime + 0.02; }

  _env(node, t, a, d, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(this.master);
    return g;
  }

  // ---------------------------------------------------------------- music

  // Ask for a track by name. Asking for the one already playing does nothing,
  // which is what lets the caller say `music('final')` on every frame of the
  // last minute without thinking about it.
  async track(key) {
    if (!this.ctx || !MUSIC[key]) return;
    if (this.music && this.music.key === key) return;
    this._stopMusic();
    this.music = { key, loading: true };
    let buf;
    try {
      const res = await fetch(BASE + MUSIC[key]);
      if (!res.ok) return;
      buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch { return; }
    // The track may have been changed again while this was downloading.
    if (!this.music || this.music.key !== key) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    gain.connect(this.musicGain);
    this.music = { key, gain, timer: this._loopCrossfaded(buf, gain) };
  }

  // The two stings are not tracks: they play once, over whatever is there,
  // and the loop underneath ducks out of the way rather than stopping dead.
  async sting(win) {
    if (!this.ctx || this.muted) return;
    const key = win ? 'victory' : 'defeat';
    this.duck(0.25, 5);
    try {
      const res = await fetch(BASE + MUSIC[key]);
      if (!res.ok) return;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(this.master);
      src.start();
    } catch { /* nothing to play, and nothing broken */ }
  }

  // Pull the music down for a moment so a whistle or a bell is heard over it.
  duck(to = 0.35, dur = 1.4) {
    if (!this.ctx) return;
    const g = this.musicGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVol * to, t + 0.08);
    g.linearRampToValueAtTime(this.musicVol, t + dur);
  }

  _stopMusic() {
    if (!this.music) return;
    if (this.music.timer) clearInterval(this.music.timer);
    if (this.music.gain) {
      const t = this.ctx.currentTime;
      const node = this.music.gain;
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + 0.5);
      // Unplugged after the fade, not during it: disconnecting now would cut
      // the very ramp that is there to stop it clicking.
      setTimeout(() => node.disconnect(), 700);
    }
    this.music = null;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}
