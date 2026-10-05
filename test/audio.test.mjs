// The sound code against a stand-in AudioContext that just counts what it is asked to build, to catch typos and bad
// calls (a missing method, a wrong argument order) in every effect and in the music sequencer.

import test from 'node:test';
import assert from 'node:assert/strict';

class Param {
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.frequency = new Param(440);
    this.gain = new Param(1);
    this.Q = new Param(1);
    this.playbackRate = new Param(1);
    ctx.made[kind] = (ctx.made[kind] || 0) + 1;
  }
  connect(n) {
    return n;
  }
  start() {
    this.ctx.started++;
  }
  stop() {}
}
class FakeAC {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.sampleRate = 8000;
    this.destination = {};
    this.made = {};
    this.started = 0;
  }
  resume() {
    this.state = 'running';
  }
  createGain() {
    return new Node(this, 'gain');
  }
  createOscillator() {
    return new Node(this, 'osc');
  }
  createBiquadFilter() {
    return new Node(this, 'filter');
  }
  createBufferSource() {
    return new Node(this, 'source');
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
}
globalThis.window = { AudioContext: FakeAC };
const { Sound } = await import('../src/audio.js');

test('every sound can be asked for before and after the first tap without throwing', () => {
  const s = new Sound();
  // before unlock: nothing happens, nothing throws
  s.hit(40);
  s.goal(true);
  s.setMusic('play');
  s.engine(0.5, 1, true);
  s.setBoost(true);
  s.unlock();
  clearInterval(s.timer);
  assert.ok(s.ctx);
  s.ctx.resume();
  s.hit(10);
  s.hit(60);
  s.wall(25);
  s.bump(12);
  s.jump();
  s.dodge();
  s.land(12);
  s.pad(false);
  s.pad(true);
  for (const n of [3, 2, 1]) s.beep(n);
  s.go();
  s.tick();
  s.save();
  s.goal(true);
  s.goal(false);
  s.swell(1, 3);
  s.finish(true);
  s.finish(false);
  s.whistle();
  s.setBoost(true);
  s.setBoost(false);
  s.engine(0.2, 0.5, true);
  s.engine(0, 0, false);
  assert.ok(s.ctx.started > 20);
});

test('the music steps through four bars of 16 steps and goes quiet when told', () => {
  const s = new Sound();
  s.unlock();
  clearInterval(s.timer);
  s.ctx.resume();
  s.setMusic('play');
  const before = s.ctx.made.osc || 0;
  for (let i = 0; i < 200; i++) {
    s.ctx.currentTime += 0.1;
    s.schedule();
  }
  assert.ok((s.ctx.made.osc || 0) - before > 100, 'notes were scheduled');
  assert.equal(s.step < 64 && s.step >= 0, true);
  s.setMusic('menu');
  for (let i = 0; i < 40; i++) {
    s.ctx.currentTime += 0.1;
    s.schedule();
  }
  const made = s.ctx.made.osc;
  s.setMusic('off');
  for (let i = 0; i < 40; i++) {
    s.ctx.currentTime += 0.1;
    s.schedule();
  }
  assert.equal(s.ctx.made.osc, made, 'no notes when off');
});

test('a browser with no audio, or one that refuses, just stays silent', () => {
  const none = new Sound();
  const saved = globalThis.window;
  globalThis.window = {};
  none.unlock();
  assert.equal(none.failed, true);
  none.hit(30);
  none.setMusic('play');
  globalThis.window = {
    AudioContext: class {
      constructor() {
        throw new Error('blocked');
      }
    },
  };
  const bad = new Sound();
  bad.unlock();
  assert.equal(bad.failed, true);
  bad.goal(true);
  globalThis.window = saved;
});
