import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
globalThis.window = {
  addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
  removeEventListener: (t, fn) => (listeners[t] = (listeners[t] || []).filter((f) => f !== fn)),
};
let now = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const { Input } = await import('../src/input.js');

const press = (code, extra = {}) => listeners.keydown.forEach((fn) => fn({ code, repeat: false, preventDefault() { this.prevented = true; }, ...extra }));
const release = (code) => listeners.keyup.forEach((fn) => fn({ code }));

function make(controls) {
  const ow = { controls: controls ?? { stick: { x: 0, y: 0 }, pressed: () => false } };
  return new Input(ow);
}

test('keys drive: W A S D and arrows, both at once cancel, the stick adds in and everything stays in -1..1', () => {
  const ow = { controls: { stick: { x: 0, y: 0 }, pressed: () => false } };
  const inp = new Input(ow);
  press('KeyW');
  press('KeyD');
  inp.poll();
  assert.deepEqual([inp.thr, inp.steer], [1, 1]);
  press('KeyS');
  inp.poll();
  assert.equal(inp.thr, 0);
  release('KeyS');
  release('KeyW');
  release('KeyD');
  press('ArrowUp');
  press('ArrowLeft');
  inp.poll();
  assert.deepEqual([inp.thr, inp.steer], [1, -1]);
  ow.controls.stick.x = 0.8;
  ow.controls.stick.y = -1;
  inp.poll();
  assert.equal(inp.thr, 1, 'clamped');
  assert.ok(Math.abs(inp.steer - -0.2) < 1e-9, 'left key and right stick add up');
  release('ArrowUp');
  release('ArrowLeft');
  ow.controls.stick.x = 0.05;
  ow.controls.stick.y = 0.05;
  inp.poll();
  assert.deepEqual([inp.thr, inp.steer], [0, 0], 'a small stick movement is ignored');
  assert.equal(inp.used.drive, true);
  inp.dispose();
});

test('jump is one press, boost is held, repeats are ignored, and a key and a touch button for one press count once', () => {
  const ow = { controls: { stick: { x: 0, y: 0 }, held: new Set(), pressed(id) { return this.held.has(id); } } };
  const inp = new Input(ow);
  press('Space');
  press('Space', { repeat: true });
  assert.equal(inp.takeJump(), true);
  assert.equal(inp.takeJump(), false, 'taken once');
  now += 200;
  release('Space');
  press('ShiftLeft');
  inp.poll();
  assert.equal(inp.boost, true);
  release('ShiftLeft');
  inp.poll();
  assert.equal(inp.boost, false);
  ow.controls.held.add('boost');
  inp.poll();
  assert.equal(inp.boost, true, 'the touch button boosts too');
  ow.controls.held.delete('boost');
  // a touch press arrives as a key event and as a button state: one jump
  now += 500;
  ow.controls.held.add('jump');
  press('Space');
  inp.poll();
  assert.equal(inp.takeJump(), true);
  now += 30;
  inp.poll();
  assert.equal(inp.takeJump(), false);
  ow.controls.held.delete('jump');
  now += 100;
  inp.poll();
  // two quick, real taps still make a dodge
  now += 300;
  press('Space');
  assert.equal(inp.takeJump(), true);
  now += 160;
  release('Space');
  press('Space');
  assert.equal(inp.takeJump(), true);
  assert.equal(inp.used.jump && inp.used.boost, true);
  inp.dispose();
});

test('C toggles the camera once per press, R held puts a stuck car back, Space and arrows never scroll the page, blur lets go', () => {
  const inp = make();
  press('KeyC');
  assert.equal(inp.takeCam(), true);
  assert.equal(inp.takeCam(), false);
  now += 400;
  press('KeyC');
  assert.equal(inp.takeCam(), true);
  press('KeyR');
  now += 300;
  inp.poll();
  assert.equal(inp.takeReset(), false, 'a tap is not enough');
  now += 700;
  inp.poll();
  assert.equal(inp.takeReset(), true, 'held for a moment');
  inp.poll();
  assert.equal(inp.takeReset(), false, 'once per hold');
  release('KeyR');
  const ev = { code: 'Space', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  listeners.keydown.forEach((fn) => fn(ev));
  assert.equal(ev.prevented, true);
  const arrow = { code: 'ArrowDown', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  listeners.keydown.forEach((fn) => fn(arrow));
  assert.equal(arrow.prevented, true);
  press('KeyW');
  listeners.blur.forEach((fn) => fn());
  inp.poll();
  assert.equal(inp.thr, 0);
  press('Enter');
  assert.equal(inp.takeEnter(), true);
  inp.flush();
  assert.equal(inp.takeJump(), false);
});

test('a page with no touch controls object, or one that throws, still drives from the keyboard', () => {
  const inp = new Input({ controls: undefined });
  press('KeyW');
  inp.poll();
  assert.equal(inp.thr, 1);
  const bad = new Input({
    controls: {
      get stick() {
        throw new Error('nope');
      },
    },
  });
  press('KeyD');
  assert.doesNotThrow(() => bad.poll());
  assert.equal(bad.steer, 1);
});
