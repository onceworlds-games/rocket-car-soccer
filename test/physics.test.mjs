import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCar, placeCar, stepCar } from '../src/sim/car.js';
import { makeBall, placeBall, stepBall, advanceBall, carBallHit } from '../src/sim/ball.js';
import { World } from '../src/sim/world.js';
import { CARP, BALLP, BALL_R, CAR_Y, STEP, PX, PZ } from '../src/sim/consts.js';
import { insideArena } from '../src/sim/arena.js';
import { mulberry32 } from '../src/sim/rng.js';
import { finiteWorld, inBounds } from './harness.mjs';

const sink = { ball: null, emitted: [], emit(type, car, a, b) { this.emitted.push({ type, a, b }); } };

// Steps a car for a while, keeping it in the middle of the pitch (a wall would end the run) with its speed intact.
function drive(c, seconds, setInput) {
  for (let i = 0; i < seconds / STEP; i++) {
    setInput?.(c, i * STEP);
    stepCar(c, STEP, sink);
    if (Math.abs(c.x) > 20 || Math.abs(c.z) > 12) {
      c.x = c.px = 0;
      c.z = c.pz = 0;
    }
  }
}

test('a car accelerates to its top speed, boost takes it higher, reverse is slower', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, -30, 0, 0, 100);
  drive(c, 4, (car) => { car.thr = 1; });
  assert.ok(Math.abs(c.vx - CARP.max) < 0.3, `top speed ${c.vx}`);
  drive(c, 1, (car) => { car.thr = 1; car.boostIn = true; });
  assert.ok(c.vx > 30 && c.vx <= CARP.boostMax + 0.01, `boosted ${c.vx}`);
  assert.ok(c.boost < 100 - 25, 'boost is spent');
  drive(c, 3, (car) => { car.thr = 0; car.boostIn = false; });
  assert.ok(c.vx < 12 && c.vx >= 0, `coasts down ${c.vx}`);
  const r = makeCar('r', 1, 'local');
  placeCar(r, 0, 0, 0);
  drive(r, 4, (car) => { car.thr = -1; });
  assert.ok(r.vx < -10 && r.vx >= -CARP.reverseMax - 0.01, `reverse ${r.vx}`);
});

test('boost refills slowly by itself and never passes 100', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, 0, 0, 0, 0);
  drive(c, 5, () => {});
  assert.ok(Math.abs(c.boost - 20) < 0.5, `got ${c.boost}`);
  drive(c, 60, () => {});
  assert.equal(c.boost, 100);
});

test('steering turns the car, slower when fast, and the car grips', () => {
  const slow = makeCar('s', 1, 'local');
  placeCar(slow, 0, 0, 0);
  slow.vx = 6;
  drive(slow, 1, (car) => { car.thr = 0.3; car.steer = 1; });
  const fast = makeCar('f', 1, 'local');
  placeCar(fast, 0, 0, 0);
  fast.vx = 23;
  drive(fast, 1, (car) => { car.thr = 1; car.steer = 1; });
  assert.ok(Math.abs(slow.h) > Math.abs(fast.h), `slow ${slow.h} fast ${fast.h}`);
  assert.ok(fast.h > 1.3, 'a right turn raises the heading');
  // sideways speed fades: no endless sliding
  const v = Math.hypot(fast.vx, fast.vz);
  drive(fast, 1, (car) => { car.thr = 1; car.steer = 0; });
  const lateral = Math.abs(-fast.vx * Math.sin(fast.h) + fast.vz * Math.cos(fast.h));
  assert.ok(lateral < 0.6 && v > 10, `lateral ${lateral}`);
  // a car that isn't moving doesn't spin on the spot
  const still = makeCar('t', 1, 'local');
  placeCar(still, 0, 0, 0);
  drive(still, 1, (car) => { car.steer = 1; });
  assert.equal(still.h, 0);
});

test('a jump reaches about 1.4 m and lands again; a second press dodges or hops', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, 0, 0, 0);
  let peak = 0;
  let airTicks = 0;
  c.jumpIn = true;
  for (let i = 0; i < 120; i++) {
    stepCar(c, STEP, sink);
    if (!c.ground) airTicks++;
    peak = Math.max(peak, c.y - CAR_Y);
  }
  assert.ok(peak > 1.2 && peak < 1.45, `peak ${peak}`);
  assert.ok(airTicks > 30 && airTicks < 45, `airtime ${airTicks}`);
  assert.ok(c.ground && Math.abs(c.y - CAR_Y) < 1e-9);

  // dodge: direction held
  const d = makeCar('d', 1, 'local');
  placeCar(d, 0, 0, 0);
  d.jumpIn = true;
  for (let i = 0; i < 10; i++) stepCar(d, STEP, sink);
  d.thr = 1;
  d.jumpIn = true;
  const before = d.vx;
  stepCar(d, STEP, sink);
  assert.ok(d.vx - before > CARP.dodgeV - 0.5, 'horizontal kick');
  assert.ok(d.dodge > 0.4 && d.canAir === false);
  assert.ok(sink.emitted.some((e) => e.type === 'dodge'));
  // a third press does nothing
  d.jumpIn = true;
  const v2 = d.vx;
  stepCar(d, STEP, sink);
  assert.ok(Math.abs(d.vx - v2) < 0.5);

  // no direction: a hop
  const e = makeCar('e', 1, 'local');
  placeCar(e, 0, 0, 0);
  e.jumpIn = true;
  for (let i = 0; i < 20; i++) stepCar(e, STEP, sink);
  e.jumpIn = true;
  stepCar(e, STEP, sink);
  assert.ok(e.vy > 6, `second jump ${e.vy}`);

  // too late for a second press
  const f = makeCar('f', 1, 'local');
  placeCar(f, 0, 0, 0);
  f.jumpIn = true;
  f.jumpT = 0;
  stepCar(f, STEP, sink);
  f.jumpT = 5;
  f.vy = 4;
  f.jumpIn = true;
  const vy = f.vy;
  stepCar(f, STEP, sink);
  assert.ok(f.vy < vy, 'no second jump after the window');
});

test('in the air boost climbs along the nose; without boost a car cannot fly', () => {
  const up = makeCar('u', 1, 'local');
  placeCar(up, -10, 0, 0, 100);
  up.jumpIn = true;
  let top = 0;
  for (let i = 0; i < 150; i++) {
    up.pitchIn = 1;
    up.boostIn = true;
    stepCar(up, STEP, sink);
    top = Math.max(top, up.y);
    assert.ok(Math.hypot(up.vx, up.vy, up.vz) <= CARP.airMax + 0.01);
  }
  assert.ok(top > 6, `aerial height ${top}`);
  const dud = makeCar('d', 1, 'local');
  placeCar(dud, -10, 0, 0, 0);
  dud.jumpIn = true;
  let top2 = 0;
  for (let i = 0; i < 150; i++) {
    dud.pitchIn = 1;
    stepCar(dud, STEP, sink);
    top2 = Math.max(top2, dud.y);
  }
  assert.ok(top2 < 3);
});

test('cars stay inside the walls whatever the player does', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed);
    const w = new World(seed);
    const c = makeCar('a', 1 + (seed % 2), 'local');
    w.addCar(c);
    placeCar(c, (rng() - 0.5) * 60, (rng() - 0.5) * 40, rng() * 6.28, 100);
    let hold = 0;
    for (let i = 0; i < 60 * 30; i++) {
      if (hold <= 0) {
        hold = 10 + rng() * 50;
        c.thr = Math.round(rng() * 2 - 1);
        c.steer = rng() < 0.3 ? 0 : rng() * 2 - 1;
        c.boostIn = rng() < 0.5;
        c.pitchIn = Math.round(rng() * 2 - 1);
        if (rng() < 0.3) c.jumpIn = true;
      }
      hold--;
      w.step(STEP);
      if (i % 10 === 0) {
        assert.ok(finiteWorld(w), `NaN seed ${seed} tick ${i}`);
        assert.ok(inBounds(w), `out of bounds seed ${seed} tick ${i}: ${c.x} ${c.y} ${c.z}`);
      }
    }
  }
});

test('a dropped ball bounces at 0.7 and comes to rest on the floor', () => {
  const b = makeBall();
  placeBall(b, 0, 11.9, 0);
  let firstImpact = 0;
  let afterBounceVy = 0;
  let seen = false;
  for (let i = 0; i < 60 * 20; i++) {
    const vyBefore = b.vy;
    const impact = stepBall(b, STEP);
    if (impact > 1 && !seen) {
      seen = true;
      firstImpact = impact;
      afterBounceVy = b.vy;
      assert.ok(Math.abs(afterBounceVy / -vyBefore - BALLP.rest) < 0.06, `rest ${afterBounceVy / -vyBefore}`);
    }
  }
  assert.ok(seen && firstImpact > 10);
  assert.ok(Math.abs(b.y - BALL_R) < 0.05 && Math.abs(b.vy) < 0.3, `settled ${b.y} ${b.vy}`);
});

test('the ball never exceeds its top speed and stays in the arena, goals included', () => {
  const rng = mulberry32(9);
  for (let n = 0; n < 40; n++) {
    const b = makeBall();
    placeBall(b, (rng() - 0.5) * 70, 2 + rng() * 10, (rng() - 0.5) * 40, (rng() - 0.5) * 200, (rng() - 0.5) * 80, (rng() - 0.5) * 200);
    for (let i = 0; i < 60 * 12; i++) {
      stepBall(b, STEP);
      assert.ok(Math.hypot(b.vx, b.vy, b.vz) <= BALLP.max + 1e-6);
      assert.ok(insideArena(b.x, b.y, b.z, 0.1), `ball out at (${b.x}, ${b.y}, ${b.z})`);
    }
  }
});

test('advanceBall flies a ball on exactly like stepping it', () => {
  const a = makeBall();
  placeBall(a, 5, 4, -3, 20, 8, 5);
  const out = makeBall();
  advanceBall(a, 0.5, out);
  const m = makeBall();
  placeBall(m, 5, 4, -3, 20, 8, 5);
  let left = 0.5;
  while (left > 1e-6) {
    const dt = Math.min(STEP, left);
    stepBall(m, dt);
    left -= dt;
  }
  assert.ok(Math.abs(out.x - m.x) < 1e-9 && Math.abs(out.y - m.y) < 1e-9 && Math.abs(out.z - m.z) < 1e-9);
  assert.equal(advanceBall(a, NaN, out).x, 5);
});

test('a car hitting the ball throws it 1.6 times faster, forward, and the car keeps most of its speed', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, -3, 0, 0);
  c.vx = 20;
  const b = makeBall();
  placeBall(b, 0.2, BALL_R, 0);
  let hits = 0;
  const w = { emit(type) { if (type === 'hit') hits++; } };
  assert.equal(carBallHit(c, b, w), true);
  assert.equal(hits, 1);
  assert.ok(b.vx > 30 && b.vx < 45, `ball ${b.vx}`);
  assert.ok(Math.abs(b.vz) < 1e-6);
  assert.ok(c.vx > 14 && c.vx < 20, `car ${c.vx}`);
  // pushed clear of the box
  assert.ok(b.x - c.x >= 1.6 + BALL_R - 0.001);
  // separating: no second impulse
  const vx = b.vx;
  assert.equal(carBallHit(c, b, w), false);
  assert.equal(b.vx, vx);
});

test('a dodge hits harder; a glancing hit sends the ball sideways; a ball far away is untouched', () => {
  const mk = (dodge) => {
    const c = makeCar('a', 1, 'local');
    placeCar(c, -3, 0, 0);
    c.vx = 15;
    c.dodge = dodge;
    const b = makeBall();
    placeBall(b, 0.2, BALL_R, 0);
    carBallHit(c, b, null);
    return b.vx;
  };
  assert.ok(mk(0.3) > mk(0) + 4);
  const c = makeCar('a', 1, 'local');
  placeCar(c, 0, 0, 0);
  c.vx = 20;
  const b = makeBall();
  placeBall(b, 2.5, BALL_R, 1.4);
  carBallHit(c, b, null);
  assert.ok(b.vz > 3, `sideways ${b.vz}`);
  const far = makeBall();
  placeBall(far, 20, BALL_R, 0);
  assert.equal(carBallHit(c, far, null), false);
});

test('a ball inside the car box is pushed out, never stuck', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, 0, 0, 0);
  const b = makeBall();
  placeBall(b, 0, 1, 0);
  carBallHit(c, b, null);
  assert.ok(Math.hypot(b.x - c.x, b.z - c.z) > 0.8 || b.y > 2);
  for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz]) assert.ok(Number.isFinite(v));
});

test('cars bump into each other without sticking or passing through', () => {
  const w = new World(3);
  const a = makeCar('a', 1, 'local');
  const b = makeCar('b', 2, 'local');
  w.addCar(a);
  w.addCar(b);
  placeCar(a, -5, 0, 0);
  placeCar(b, 5, 0, Math.PI);
  for (let i = 0; i < 90; i++) {
    a.thr = 1;
    b.thr = 1;
    w.step(STEP);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2.4, `overlap at tick ${i}`);
  }
  assert.ok(a.vx < 15 && b.vx > -15, 'head-on collision slows both');
});

test('boost pads give boost and then rest', () => {
  const w = new World(4);
  const c = makeCar('a', 1, 'local');
  w.addCar(c);
  placeCar(c, 33, 20, 0, 10);
  w.step(STEP);
  assert.ok(c.boost > 100 - 1e-9 || c.boost >= 100, 'big pad fills');
  const pad = w.pads.find((p) => p.big && p.x === 33 && p.z === 20);
  assert.ok(pad.cd > 9);
  assert.ok(w.ev.slice(0, w.nev).some((e) => e.type === 'pad'));
  c.boost = 5;
  w.step(STEP);
  assert.ok(c.boost < 6, 'a pad in cooldown gives nothing');
  const rem = makeCar('r', 2, 'remote');
  w.addCar(rem);
  placeCar(rem, 0, 19, 0, 7);
  w.step(STEP);
  assert.equal(rem.boost, 7, 'a remote car\'s boost is its own page\'s business');
  assert.ok(w.pads.find((p) => !p.big && p.x === 0 && p.z === 19).cd > 3);
});

test('everything stays finite in a crowd: 8 cars and a ball for a minute', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rng = mulberry32(seed * 7);
    const w = new World(seed);
    for (let i = 0; i < 8; i++) {
      const c = makeCar(`c${i}`, 1 + (i % 2), 'local');
      c.slot = i >> 1;
      w.addCar(c);
    }
    w.kickoff();
    for (let i = 0; i < 3600; i++) {
      if (i % 20 === 0) for (const c of w.cars) { c.thr = 1; c.steer = rng() * 2 - 1; c.boostIn = rng() < 0.4; if (rng() < 0.1) c.jumpIn = true; c.pitchIn = Math.round(rng() * 2 - 1); }
      w.step(STEP);
    }
    assert.ok(finiteWorld(w) && inBounds(w));
  }
});
