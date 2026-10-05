// Sound, all synthesised with Web Audio: punchy impacts (a noise burst over a low thump), whooshes, a boost roar, an engine
// hum, countdown beeps, a crowd that swells on goals, and a driving electronic loop at 128 BPM in A minor. Nothing is loaded
// from files. The platform applies volume and mute to everything here. Every call is safe to make before the first tap
// (it does nothing) and never throws into the game.

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const BPM = 128;
const STEP_S = 60 / BPM / 4;
// Am F C G, one bar each: bass root, and the chord's notes for the arpeggio
const BARS = [
  { root: 45, chord: [57, 60, 64] },
  { root: 41, chord: [53, 57, 60] },
  { root: 48, chord: [55, 60, 64] },
  { root: 43, chord: [55, 59, 62] },
];
const ARP = [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 2, 1];

export class Sound {
  constructor() {
    this.ctx = null;
    this.level = 'off';
    this.step = 0;
    this.nextTime = 0;
    this.timer = 0;
    this.boostOn = false;
    this.failed = false;
  }

  /** Starts the audio engine. Call from a tap or key press inside the game. */
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        this.ctx = new AC();
        this.build();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      this.failed = true;
    }
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);
    this.music = c.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.master);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous voices: crowd, boost roar, engine
    this.crowd = this.loop(this.noiseSrc(), 'lowpass', 520, 0.55, 0.035);
    this.crowdBand = this.loop(this.noiseSrc(), 'bandpass', 900, 0.8, 0.0);
    this.roar = this.loop(this.noiseSrc(), 'bandpass', 1100, 0.6, 0);
    this.rumble = c.createOscillator();
    this.rumble.type = 'sawtooth';
    this.rumble.frequency.value = 52;
    const rf = c.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 260;
    this.rumbleGain = c.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(rf).connect(this.rumbleGain).connect(this.sfx);
    this.rumble.start();
    this.eng = c.createOscillator();
    this.eng.type = 'sawtooth';
    this.eng.frequency.value = 70;
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 300;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.eng.connect(this.engFilter).connect(this.engGain).connect(this.sfx);
    this.eng.start();
    this.timer = setInterval(() => this.schedule(), 25);
    this.nextTime = c.currentTime + 0.1;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  loop(src, type, freq, q, gain) {
    const c = this.ctx;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.sfx);
    return { f, g };
  }

  // ------------------------------------------------------------ building blocks

  tone(type, f0, f1, t0, dur, peak, dest = this.sfx) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  burst(type, freq, q, t0, dur, peak, dest = this.sfx, rate = 1, sweepTo = 0) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.01, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }

  ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------ one-shot effects

  /** The ball is hit: power 0..60 (the ball's speed away from the car). */
  hit(power) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const k = clamp(power / 38, 0.25, 1.3);
      this.tone('sine', 170, 48, t, 0.16, 0.7 * k);
      this.burst('bandpass', 1700, 0.9, t, 0.09, 0.45 * k);
      this.burst('lowpass', 400, 0.7, t, 0.18, 0.4 * k);
      if (power > 30) this.tone('triangle', 1100, 700, t, 0.1, 0.12 * k);
    } catch (e) {}
  }

  wall(power) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const k = clamp(power / 30, 0.2, 1);
      this.tone('sine', 110, 55, t, 0.12, 0.35 * k);
      this.burst('lowpass', 700, 0.7, t, 0.1, 0.22 * k);
    } catch (e) {}
  }

  bump(power) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const k = clamp(power / 18, 0.2, 1);
      this.tone('square', 130, 60, t, 0.1, 0.18 * k);
      this.burst('bandpass', 900, 1, t, 0.07, 0.25 * k);
    } catch (e) {}
  }

  jump() {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.tone('triangle', 200, 420, t, 0.14, 0.16);
      this.burst('bandpass', 900, 0.8, t, 0.16, 0.12, this.sfx, 1.2, 1800);
    } catch (e) {}
  }

  dodge() {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.burst('bandpass', 500, 1.1, t, 0.3, 0.28, this.sfx, 1.4, 2800);
      this.tone('sawtooth', 160, 640, t, 0.18, 0.08);
    } catch (e) {}
  }

  land(v) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const k = clamp(v / 14, 0.2, 1);
      this.tone('sine', 100, 42, t, 0.14, 0.4 * k);
      this.burst('lowpass', 500, 0.6, t, 0.1, 0.18 * k);
    } catch (e) {}
  }

  pad(big) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const notes = big ? [523, 659, 784, 1047] : [880, 1319];
      notes.forEach((f, i) => this.tone('triangle', f, f, t + i * 0.055, 0.16, big ? 0.2 : 0.13));
    } catch (e) {}
  }

  /** Countdown beep for 3, 2, 1. */
  beep(n) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.tone('square', 440 + (3 - n) * 40, 440 + (3 - n) * 40, t, 0.16, 0.22);
      this.tone('sine', 220, 220, t, 0.16, 0.2);
    } catch (e) {}
  }

  go() {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.tone('square', 880, 880, t, 0.4, 0.22);
      this.tone('sawtooth', 440, 440, t, 0.4, 0.12);
      this.burst('bandpass', 1500, 0.8, t, 0.3, 0.22, this.sfx, 1, 4000);
    } catch (e) {}
  }

  tick() {
    if (!this.ready()) return;
    try {
      this.tone('square', 1300, 1300, this.ctx.currentTime, 0.03, 0.08);
    } catch (e) {}
  }

  save() {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.tone('triangle', 660, 990, t, 0.12, 0.2);
      this.tone('triangle', 990, 1320, t + 0.08, 0.18, 0.2);
    } catch (e) {}
  }

  /** A goal: a horn, a rising stinger and the crowd's roar. */
  goal(mine) {
    if (!this.ready()) return;
    try {
      const c = this.ctx;
      const t = c.currentTime;
      for (const f of [220, 277.2, 330]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * 1.02, t + 1);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(500, t);
        lp.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
        g.gain.setValueAtTime(0.09, t + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        o.connect(lp).connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + 1.4);
      }
      [57, 60, 64, 69, 72].forEach((m, i) => this.tone('square', hz(m), hz(m), t + 0.08 * i, 0.22, mine ? 0.12 : 0.07));
      this.tone('sine', 120, 38, t, 0.5, 0.7);
      this.burst('lowpass', 900, 0.7, t, 0.5, 0.5);
      this.swell(mine ? 1 : 0.7, 2.8);
    } catch (e) {}
  }

  /** The crowd rises and falls over `dur` seconds. */
  swell(amount, dur) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const g = this.crowdBand.g.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.5 * amount, t + dur * 0.25);
      g.linearRampToValueAtTime(0, t + dur);
      const f = this.crowdBand.f.frequency;
      f.cancelScheduledValues(t);
      f.setValueAtTime(600, t);
      f.linearRampToValueAtTime(1300, t + dur * 0.3);
      f.linearRampToValueAtTime(800, t + dur);
    } catch (e) {}
  }

  /** A short rising stinger for a win, or a falling one for a loss. */
  finish(win) {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      const notes = win ? [60, 64, 67, 72, 76] : [67, 63, 60, 55];
      notes.forEach((m, i) => {
        this.tone('square', hz(m), hz(m), t + i * 0.13, 0.3, 0.13);
        this.tone('triangle', hz(m - 12), hz(m - 12), t + i * 0.13, 0.4, 0.16);
      });
      if (win) this.swell(1, 3.5);
      this.burst('lowpass', 800, 0.7, t, 0.6, 0.3);
    } catch (e) {}
  }

  whistle() {
    if (!this.ready()) return;
    try {
      const t = this.ctx.currentTime;
      this.tone('sine', 2900, 2700, t, 0.35, 0.12);
      this.tone('sine', 3000, 2800, t + 0.45, 0.5, 0.12);
    } catch (e) {}
  }

  // ------------------------------------------------------------ continuous voices

  /** The boost roar on or off. */
  setBoost(on) {
    if (!this.ctx || on === this.boostOn) return;
    this.boostOn = on;
    try {
      const t = this.ctx.currentTime;
      this.roar.g.gain.setTargetAtTime(on ? 0.16 : 0, t, 0.05);
      this.rumbleGain.gain.setTargetAtTime(on ? 0.14 : 0, t, 0.06);
    } catch (e) {}
  }

  /** The engine hum of your own car: speed 0..1 of its top speed, throttle 0..1. */
  engine(speed, throttle, on) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      this.eng.frequency.setTargetAtTime(58 + speed * 150, t, 0.08);
      this.engFilter.frequency.setTargetAtTime(240 + speed * 700 + throttle * 300, t, 0.08);
      this.engGain.gain.setTargetAtTime(on ? 0.035 + throttle * 0.035 + speed * 0.02 : 0, t, 0.1);
    } catch (e) {}
  }

  // ------------------------------------------------------------ music

  /** 'off' | 'menu' (soft) | 'play' (driving). */
  setMusic(level) {
    this.level = level;
    if (!this.ctx) return;
    try {
      const v = level === 'play' ? 0.36 : level === 'menu' ? 0.17 : 0;
      this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
    } catch (e) {}
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    try {
      if (this.nextTime < c.currentTime - 0.5) this.nextTime = c.currentTime + 0.05;
      while (this.nextTime < c.currentTime + 0.12) {
        this.playStep(this.step, this.nextTime);
        this.step = (this.step + 1) % (16 * BARS.length);
        this.nextTime += STEP_S;
      }
    } catch (e) {}
  }

  playStep(step, t) {
    if (this.level === 'off') return;
    const bar = BARS[Math.floor(step / 16) % BARS.length];
    const s = step % 16;
    const play = this.level === 'play';
    const m = this.music;
    // bass: eighth notes with an octave jump
    if (s % 2 === 0) {
      const note = bar.root + (s === 6 || s === 14 ? 12 : 0);
      this.musicNote('sawtooth', hz(note), t, STEP_S * 1.7, play ? 0.2 : 0.14, 380, m);
    }
    if (play) {
      // four on the floor, a clap on 2 and 4, hats between
      if (s % 4 === 0) {
        this.tone('sine', 150, 42, t, 0.18, 0.55, m);
        this.burst('lowpass', 200, 0.7, t, 0.05, 0.3, m);
      }
      if (s === 4 || s === 12) {
        this.burst('bandpass', 1800, 0.8, t, 0.13, 0.28, m);
        this.tone('triangle', 200, 150, t, 0.1, 0.12, m);
      }
      if (s % 4 === 2) this.burst('highpass', 7000, 0.7, t, 0.05, 0.12, m);
      // the arpeggio
      const n = bar.chord[ARP[s]] + 12 + (s === 8 ? 12 : 0);
      this.musicNote('square', hz(n), t, STEP_S * 0.9, 0.07, 3000, m);
    } else if (s === 0) {
      for (const n of bar.chord) this.musicNote('triangle', hz(n), t, STEP_S * 15, 0.06, 1200, m);
    }
  }

  musicNote(type, f, t, dur, peak, cutoff, dest) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.35), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
