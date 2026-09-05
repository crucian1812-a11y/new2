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
//
// On top of the two layers there are two more, and both are pure code. The
// master bus is a gentle compressor and a soft ceiling, so the bell, a swell
// and a slam landing together are one mix and not three crackles. And the
// hall is a generated convolution reverb: every sound that has a place on the
// mat is sent into it, so the room the renderer drew is also the room you
// hear. `tools/sound-check.mjs` measures the tail of a slam to prove the hall
// is there and collapses when it is switched off.

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
// What the fight does to the music. The quiet end is a track under a mat with
// nothing happening on it; the loud end is the same track with the lid off.
const MUSIC_QUIET = 0.62, MUSIC_LOUD = 1.0;
const TONE_QUIET = 900, TONE_LOUD = 16000;

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
    this.music = null;        // { key, gain, timer } — what is playing
    this.wanted = null;       // and what was last asked for, which may still be downloading
    this.musicVol = 0.34;
    this.loaded = false;
    // The listener, until a frame tells it otherwise: three metres back, which
    // is where the ground shot sits, looking at the middle of the mat.
    this.ear = new Float32Array([0, 1.2, 3]);
    this.right = new Float32Array([1, 0, 0]);
    // One breath cycle per fighter: when the next one is due on the audio
    // clock, and whether the last one was an inhale.
    this.breathAt = [0, 0];
    this.breathIn = [true, true];
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
    // The master bus, and the room the mat sits in. Both are built once here
    // and both are pure code — see _bus and _hall.
    this._bus();
    this._hall();
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol;
    // The music listens to the fight.
    //
    // Three tracks, switched by state — menu, match, last minute — and inside a
    // match the same loop played at the same level whether the two of them were
    // tangled and heaving or lying still while the referee counted. A film
    // scores the scene it is over; this scores nothing.
    //
    // So a second gain and a filter sit under the music, driven by the one
    // number the sim already computes about how hard the fight is working. Not
    // a switch: the loop never changes, it leans in and sits back. The mute and
    // volume knobs are upstream of both and behave exactly as they did.
    this.musicDrive = this.ctx.createGain();
    this.musicDrive.gain.value = MUSIC_QUIET;
    this.musicTone = this.ctx.createBiquadFilter();
    this.musicTone.type = 'lowpass';
    this.musicTone.frequency.value = TONE_QUIET;
    this.musicTone.Q.value = 0.7;
    this.musicGain.connect(this.musicTone).connect(this.musicDrive).connect(this.master);
    // What was last asked for, so a measurement can read the intent rather
    // than chase a ramp. See tools/sound-check.mjs.
    this.driveWant = MUSIC_QUIET;
    this.toneWant = TONE_QUIET;
    this._crowd();
    this._load();
  }

  // ------------------------------------------------------------- the bus

  // The master bus: a glue compressor and a soft ceiling in front of the
  // speaker. Everything is gain-staged to sit in its own band, but the bell,
  // a crowd swell and a slam are three independent events and they do land on
  // the same instant; a compressor welds them into one mix and the tanh
  // ceiling keeps the sum off a phone speaker's clip. The numbers are gentle
  // on purpose — the levels are already right, this only has to catch the
  // overlaps. It sits *after* master so the volume and mute knobs still do
  // exactly what they always did.
  _bus() {
    const ctx = this.ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.24;
    const limiter = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }
    limiter.curve = curve;
    limiter.oversample = '2x';
    this.master.connect(this.compressor);
    this.compressor.connect(limiter);
    limiter.connect(ctx.destination);
  }

  // ------------------------------------------------------------- the hall

  // The room the fight happens in. The renderer built a jumbotron, a podium,
  // four speakers and an LED ribbon, and every sound came out dry — a mat in
  // an anechoic chamber. A convolution reverb gives the room back, and the
  // impulse it convolves with is generated, not recorded: two seconds of
  // low-passed noise with a hall's decay, so it costs nothing to load and
  // nothing to fail on a phone that has lost signal. Only the sounds that have
  // a place on the mat go through it (_place wires the send); the bell, the
  // clock, the UI and the music stay dry, the way a produced track should.
  _hall() {
    const ctx = this.ctx;
    const secs = 1.8;
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    let peak = 0;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let low = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        // One-pole low-pass on the noise: the air in a hall eats treble faster
        // than it eats bass, so the tail darkens as it dies.
        low += 0.18 * (w - low);
        const t = i / ctx.sampleRate;
        // Dense early reflections, then an exponential fall. RT60 ≈ 1.5 s.
        const env = Math.exp(-t / 0.22) * (1 - 0.72 * Math.exp(-t / 0.011));
        d[i] = low * env;
        if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
      }
    }
    // The decay is authored, so it is scaled to a peak of one and left alone —
    // the convolver's own normalisation would flatten the tail right back up.
    const ir = ctx.createConvolver();
    ir.normalize = false;
    const s = peak > 1e-6 ? 1 / peak : 1;
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] *= s;
    }
    ir.buffer = buf;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.4;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.6;
    this.reverbSend.connect(ir);
    ir.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);
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

  // ------------------------------------------------------------- the place

  // Where the ear is. The camera orbits the pair and pushes in on intensity,
  // so a grip taken on the far side of the tangle is genuinely further away and
  // genuinely to one side, and until now every sound in the game came out of
  // the middle at the same volume.
  //
  // Called once a frame with the camera's own eye and aim. Nothing else about
  // the camera reaches this file: a listener is a point and a direction, and
  // the shots, the drift and the shake are already baked into those two.
  listen(eye, at) {
    this.ear[0] = eye[0]; this.ear[1] = eye[1]; this.ear[2] = eye[2];
    // Forward crossed with world up, normalised in the plane — a camera looking
    // down at the mat should still pan left and right.
    //
    // cross(f, up) with f = (fx, 0, fz) and up = (0, 1, 0) is (-fz, 0, fx), and
    // the first version of this line had both signs the other way round. It
    // panned perfectly and backwards: a slam two metres to the left came out
    // nine to one in the right ear. Worth saying because it is invisible from
    // inside — every sound had a place, every place had a pan, the mix moved
    // when the camera moved, and all of it was mirrored.
    const fx = at[0] - eye[0], fz = at[2] - eye[2];
    const fl = Math.hypot(fx, fz) || 1;
    this.right[0] = -fz / fl;
    this.right[2] = fx / fl;
  }

  // The node an event at (x, y, z) should connect to, and the gain it has
  // earned by being there. Returns null for a sound with no place — the bell,
  // the clock, everything the player hears rather than the mat.
  //
  // The rolloff is gentle on purpose. The camera sits between 2.3 and 4.1
  // metres from the pair and never leaves; a physical inverse square over that
  // range is a two-decibel difference nobody can hear, and anything steeper
  // starts making a grip on the far side of the tangle vanish. What carries the
  // information here is the pan, and the distance term only has to keep a
  // referee at the edge of the mat behind the two men in front of him.
  _place(x, y, z, reverb = true) {
    if (!this.ctx) return null;
    const dx = x - this.ear[0], dy = y - this.ear[1], dz = z - this.ear[2];
    const d = Math.hypot(dx, dy, dz) || 0.001;
    const pan = Math.max(-1, Math.min(1, (dx * this.right[0] + dz * this.right[2]) / d * 1.6));
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    const g = this.ctx.createGain();
    g.gain.value = 2.4 / (2.4 + d);
    p.connect(g).connect(this.master);
    // A sound with a place in the match has a place in the room: the panner
    // also feeds the hall, so a slam two metres left rings out of the left of
    // the space rather than out of nowhere. The send is taken *after* the
    // distance gain, so a far sound sends a far-sized splash of reverb and the
    // room fades with the sound instead of floating up to meet it.
    if (reverb && this.reverbSend) g.connect(this.reverbSend);
    return p;
  }

  // ------------------------------------------------------------- one-shots

  // Play a sample if it is here. Returns false when it is not, which is what
  // lets every method below read as "the recording, or the old synthesis".
  _play(name, gain = 1, detune = 0, at = null) {
    const buf = this.sfx[name];
    if (!buf || !this.ctx || this.muted) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // A hundredth of a semitone is nothing; three percent of pitch is the
    // difference between three cloth samples and a loop.
    if (detune) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * detune;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect((at && this._place(at[0], at[1], at[2])) || this.master);
    src.start(this._at());
    return true;
  }

  _pick(...names) {
    const have = names.filter((n) => this.sfx[n]);
    return have.length ? have[(Math.random() * have.length) | 0] : null;
  }

  // A body landing.
  thud(force = 1, at = null) {
    if (!this.ctx || this.muted) return;
    const heavy = force > 0.75;
    const name = this._pick(...(heavy ? ['slamHeavy', 'impact1'] : ['slamLight', 'impact2']));
    if (name && this._play(name, 0.9 * force, 0.03, at)) return;
    // Low sine drop plus a noise slap; the ratio between the two is the
    // difference between a mat and a boxing ring.
    const t = this._at();
    const dest = at && this._place(at[0], at[1], at[2]);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 * (0.8 + force * 0.4), t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    this._env(o, t, 0.006, 0.24, 0.5 * force, dest);
    o.start(t);
    o.stop(t + 0.3);
    this.noise(t, 1400, 0.09, 0.16 * force, 'lowpass', dest);
  }

  // Cloth. A gi is loud, and the sound of a grip being taken is most of what
  // tells you the two of them are actually touching.
  cloth(force = 1, at = null) {
    if (!this.ctx || this.muted) return;
    const name = this._pick('cloth1', 'cloth2', 'cloth3');
    if (name && this._play(name, 0.95 * force, 0.03, at)) return;
    // Measured, not guessed: at 2.6 kHz and a peak of 0.1 the synthesised gi
    // slap came out at -57 dBFS against a room at -32, which is not quiet, it
    // is inaudible. A gi has body as well as hiss.
    this.noise(this._at(), 1800, 0.16, 0.34 * force, 'highpass',
      at && this._place(at[0], at[1], at[2]));
  }

  // A foot moving on tatami. The pack has this and the synth never did.
  step(force = 0.6, at = null) {
    const name = this._pick('step1', 'step2');
    if (name) this._play(name, 0.9 * force, 0.04, at);
  }

  whistle(at = null) {
    if (!this.ctx || this.muted) return;
    if (this._play('whistle', 0.45, 0, at)) return;
    const t = this._at();
    const dest = at && this._place(at[0], at[1], at[2]);
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
    this._env(o, t, 0.02, 0.34, 0.32, dest);
    o.start(t);
    o.stop(t + 0.4);
  }

  // The gains are not taste: every one is measured at match volume by
  // `tools/sound-check.mjs`, which puts a tap on the master output and reads
  // the peak. They all sit in a band a few decibels wide, above the crowd bed
  // at -29 dBFS and clear of the top of the scale — because the bed, the music
  // and two or three of these play at once.
  //
  // The tap and the UI click were once at 2.2, on the strength of a meter that
  // was reading twenty decibels low: a ScriptProcessor runs on the main thread
  // and starves behind a WebGL loop, so measuring the game's own page under-
  // reported everything short. On a page that renders nothing they came out at
  // +1 dBFS, which is not loud, it is clipping.
  bell() { if (!this._play('bell', 0.55)) this.beep(1180, 0.5, 'sine', 0.34); }
  tap(force = 1, at = null) { if (!this._play('tap', 0.8 * force, 0, at)) this.beep(300, 0.08, 'square', 0.2); }
  lock(at = null) { if (!this._play('lock', 0.85, 0, at)) this.cloth(1, at); }
  whoosh() { this._play('whoosh', 0.5); }
  click() { if (!this._play('click', 0.9)) this.beep(760, 0.05, 'square', 0.1); }
  confirm() { if (!this._play('confirm', 0.9)) this.beep(980, 0.1, 'triangle', 0.14); }
  timer() { if (!this._play('beepTimer', 0.8)) this.beep(880, 0.08, 'square', 0.12); }

  // Breathing.
  //
  // The one continuous sound two people grappling actually make, and there was
  // none of it — the pack has no breath in it and the synthesiser never had
  // one, so between a slam and the next grip the mat was silent and the music
  // carried the whole of it.
  //
  // Synthesised rather than sampled on purpose. A breath is filtered noise with
  // an envelope, which is the one thing oscillators do better than a recording:
  // a recorded breath repeated every two seconds becomes a metronome inside ten
  // of them, and this one is never the same twice — the rate, the pitch of the
  // filter and the length all move with how hard he is working.
  //
  // It also says something no other sound in the game says. The fighter's tank
  // is on the rig as `gas`, and nothing on screen shows it: the HUD has effort
  // and posture and not this. A man who is breathing through his mouth on the
  // far side of a tangle is telling the player to push, and that is a HUD bar
  // that does not have to be drawn.
  //
  // Called every frame with where he is and how he is doing; this decides when
  // the next one is due. `work` is what he is doing this second and `gas` is
  // what three minutes have done to him — the first sets how deep, the second
  // how often and how ragged.
  // Returns the peak it scheduled, or 0 if this frame was not its turn — see
  // the note in sound-check about why that number, and not the output, is what
  // the depth of a breath is judged on.
  breathe(i, work, gas, at = null) {
    if (!this.ctx || this.muted) return 0;
    const now = this.ctx.currentTime;
    if (now < this.breathAt[i]) return 0;
    const inhale = this.breathIn[i];
    this.breathIn[i] = !inhale;
    // Eighteen breaths a minute at rest, fifty flat out. The half-cycle is what
    // is scheduled, because an inhale and an exhale are two different sounds.
    const rate = 18 + work * 14 + gas * 18;
    const half = 30 / rate;
    // Never quite regular: a body that breathes on a grid is a machine.
    this.breathAt[i] = now + half * (0.82 + Math.random() * 0.36);
    if (this.breathAt[i] < now + 0.2) this.breathAt[i] = now + 0.2;

    const t = this._at();
    // Breath keeps its place (it pans with the chest) but not the hall: it is
    // the closest sound in the game, air moving a hand's width from the mic,
    // and a wash of reverb would turn a cue meant to sit under the room into a
    // hiss that sits beside it.
    const dest = at ? this._place(at[0], at[1], at[2], false) : null;
    // An inhale is higher, shorter and thinner — it is air through a gap. An
    // exhale is lower and longer, and it is the one that carries when a man is
    // tired, which is why the gas term is on its length and not on the inhale's.
    const dur = inhale ? 0.24 + gas * 0.10 : 0.34 + gas * 0.26;
    const freq = inhale ? 900 + gas * 250 : 430 + gas * 140;
    // Quiet. This runs continuously under everything else, and the whole of it
    // is meant to sit below the room rather than beside it: measured against
    // the crowd bed at -29 dBFS, a peak of 0.06 puts a hard-working breath a
    // few decibels under it and a resting one well beneath.
    const peak = (0.012 + work * 0.026 + gas * 0.030) * (inhale ? 0.8 : 1);
    this.noise(t, freq, dur, peak, 'bandpass', dest, inhale ? 0.09 : 0.05);
    return peak;
  }

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

  // `attack` is how long it takes to get there. Four milliseconds is a slap and
  // is what everything here wanted until a breath needed one: air through a
  // throat swells over a tenth of a second, and at four milliseconds it is a
  // hiss of static instead.
  noise(t, freq, dur, peak, type = 'lowpass', dest = null, attack = 0.004) {
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
    this._env(f, t, attack, dur, peak, dest);
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

  _env(node, t, a, d, peak, dest = null) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    node.connect(g).connect(dest || this.master);
    return g;
  }

  // How hard the fight is working, 0 to 1, once a frame.
  //
  // The map is deliberately shallow at the bottom: a quiet moment is not
  // silence, it is a track sitting back, and the difference between "nothing is
  // happening" and "they are working" should be felt rather than noticed. The
  // filter carries most of it — the brightness of a track is what the ear reads
  // as effort, and a level change of the same size is heard as somebody turning
  // a knob.
  drive(x) {
    if (!this.ctx || !this.musicDrive) return;
    const k = Math.max(0, Math.min(1, x));
    this.driveWant = MUSIC_QUIET + (MUSIC_LOUD - MUSIC_QUIET) * k;
    this.toneWant = TONE_QUIET * Math.pow(TONE_LOUD / TONE_QUIET, k);
    const t = this.ctx.currentTime;
    // A second and a half of smoothing: the intensity itself moves fast — it
    // spikes on every attempt — and a mix that followed it exactly would pump.
    this.musicDrive.gain.setTargetAtTime(this.driveWant, t, 1.5);
    this.musicTone.frequency.setTargetAtTime(this.toneWant, t, 1.5);
  }

  // ---------------------------------------------------------------- music

  // Ask for a track by name. Asking for the one already playing does nothing,
  // which is what lets the caller say `music('final')` on every frame of the
  // last minute without thinking about it.
  async track(key) {
    if (!this.ctx || !MUSIC[key]) return;
    if (this.wanted === key) return;
    this.wanted = key;
    // The old track keeps playing while the new one downloads.
    //
    // Stopping first and fetching afterwards left half a second of nothing
    // between the match theme and the last minute — and it is the last minute,
    // which is the one moment in a match where a hole in the sound is heard.
    // What arrives fades in over what is already there; what was there fades
    // out under it.
    let buf;
    try {
      const res = await fetch(BASE + MUSIC[key]);
      if (!res.ok) return;
      buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch { return; }
    // It may have been asked for something else again while this downloaded.
    if (this.wanted !== key) return;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + SEAM);
    gain.connect(this.musicGain);
    const next = { key, gain, timer: this._loopCrossfaded(buf, gain) };
    this._stopMusic(SEAM);
    this.music = next;
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

  _stopMusic(over = 0.5) {
    if (!this.music) return;
    if (this.music.timer) clearInterval(this.music.timer);
    if (this.music.gain) {
      const t = this.ctx.currentTime;
      const node = this.music.gain;
      const g = node.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + over);
      // Unplugged after the fade, not during it: disconnecting now would cut
      // the very ramp that is there to stop it clicking.
      setTimeout(() => node.disconnect(), (over + 0.2) * 1000);
    }
    this.music = null;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
}
