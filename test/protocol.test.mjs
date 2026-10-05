import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePresence, readPresence, encodeSnapshot, readSnapshot, encodeHit, readHit, hitPlausible } from '../src/net/protocol.js';
import { makeCar, placeCar } from '../src/sim/car.js';
import { makeBall, placeBall } from '../src/sim/ball.js';
import { World } from '../src/sim/world.js';
import { HostSim } from '../src/sim/host.js';
import { Match, buildRoster } from '../src/sim/rules.js';
import { BALL_R } from '../src/sim/consts.js';

test('presence round trips compactly and survives junk', () => {
  const c = makeCar('a', 1, 'local');
  placeCar(c, 12.3456, -7.891, 1.23456);
  c.vx = 18.234;
  c.boosting = true;
  c.boost = 61.7;
  c.dodge = 0.31;
  c.dodgeA = 1.5708;
  const p = JSON.parse(JSON.stringify(encodePresence(c)));
  assert.ok(JSON.stringify(p).length < 160, `presence is ${JSON.stringify(p).length} bytes`);
  const out = {};
  assert.equal(readPresence(p, out), true);
  assert.equal(out.x, 12.35);
  assert.equal(out.z, -7.89);
  assert.equal(Math.round(out.boost), 62);
  assert.equal(out.bo, 1);
  assert.equal(readPresence(null, {}), false);
  assert.equal(readPresence({ x: 'a', y: 0, z: 0, h: 0 }, {}), false);
  assert.equal(readPresence({ x: NaN, y: 0, z: 0, h: 0 }, {}), false);
  const wild = {};
  assert.equal(readPresence({ x: 1e9, y: -50, z: -1e9, h: 0, vx: 1e9, b: 'x', bo: 99 }, wild), true);
  assert.ok(Math.abs(wild.x) <= 50 && wild.y === 0 && Math.abs(wild.z) <= 40 && wild.vx === 80 && wild.boost === 0 && wild.bo === 1);
});

test('snapshots round trip and bad ones are refused', () => {
  const w = new World(1);
  for (let i = 0; i < 3; i++) {
    const b = makeCar(`bot${i}`, 1 + (i % 2), 'bot');
    b.slot = i;
    w.addCar(b);
  }
  w.kickoff();
  w.ball.x = 3.14159;
  w.ball.vx = -22.22;
  const snap = JSON.parse(JSON.stringify(encodeSnapshot('m.2', 12345.6, w.ball, w.cars, 2)));
  assert.ok(JSON.stringify(snap).length < 600, `snapshot is ${JSON.stringify(snap).length} bytes`);
  const read = readSnapshot(snap, 3);
  assert.ok(read);
  assert.equal(read.rid, 'm.2');
  assert.equal(read.t, 12346);
  assert.equal(read.b[0], 3.14);
  assert.equal(read.k.length, 3);
  assert.equal(read.lt, 2);
  assert.equal(readSnapshot(snap, 2), null, 'more bots than the roster has');
  assert.equal(readSnapshot({ ...snap, b: [1, 2, 3] }, 3), null);
  assert.equal(readSnapshot({ ...snap, t: 'now' }, 3), null);
  assert.equal(readSnapshot({ ...snap, k: [[1, 2, 3]] }, 3), null);
  assert.equal(readSnapshot({ ...snap, rid: 5 }, 3), null);
  assert.equal(readSnapshot(null, 3), null);
  const loud = readSnapshot({ ...snap, b: [1e9, 1e9, 1e9, 1e9, 1e9, -1e9] }, 3);
  assert.ok(loud.b[0] <= 50 && loud.b[3] <= 90 && loud.b[5] >= -90);
});

test('hit messages are checked field by field', () => {
  const car = makeCar('a', 1, 'local');
  placeCar(car, 0, 0, 0);
  const ball = makeBall();
  placeBall(ball, 2, BALL_R, 0, 30, 2, 0);
  const msg = JSON.parse(JSON.stringify(encodeHit('m.1', 5000.4, ball, car)));
  const h = readHit(msg);
  assert.equal(h.rid, 'm.1');
  assert.equal(h.at, 5000);
  assert.equal(h.a, 0);
  for (const bad of [null, 5, {}, { ...msg, t: 'miss' }, { ...msg, b: [1, 2] }, { ...msg, c: 'x' }, { ...msg, at: NaN }, { ...msg, rid: {} }, { ...msg, b: [0, 0, 0, 0, 0, 'x'] }]) assert.equal(readHit(bad), null);
});

test('the host believes a plausible touch and refuses the rest', () => {
  const hostBall = makeBall();
  placeBall(hostBall, 2.5, BALL_R, 0.5, 0, 0, 0);
  const car = { x: 0, z: 0 };
  const ok = readHit(encodeHit('r', 5000, { x: 2.5, y: BALL_R, z: 0.5, vx: 30, vy: 2, vz: 0 }, car));
  assert.equal(hitPlausible(ok, 5100, hostBall, { x: 0, z: 0 }, 0), true);
  assert.equal(hitPlausible(ok, 5600, hostBall, null, 0), false, 'too old');
  assert.equal(hitPlausible({ ...ok, at: 5400 }, 5000, hostBall, null, 0), false, 'from the future');
  assert.equal(hitPlausible(ok, 5100, hostBall, null, 5050), false, 'an older touch than the last taken');
  assert.equal(hitPlausible({ ...ok, c: [30, 0] }, 5100, hostBall, null, 0), false, 'car nowhere near the ball');
  assert.equal(hitPlausible(ok, 5100, hostBall, { x: 30, z: 20 }, 0), false, 'not where its presence says');
  assert.equal(hitPlausible({ ...ok, b: [2.5, BALL_R, 0.5, 90, 0, 0] }, 5100, hostBall, null, 0), false, 'faster than the ball can go');
  assert.equal(hitPlausible({ ...ok, b: [60, 2, 0.5, 5, 0, 0], c: [58, 0] }, 5100, hostBall, null, 0), false, 'outside the arena');
  const far = makeBall();
  placeBall(far, -30, BALL_R, 10);
  assert.equal(hitPlausible(ok, 5100, far, null, 0), false, 'the host ball is elsewhere: no teleporting the ball');
});

function hostWith(humanId) {
  const { roster } = buildRoster([{ id: humanId, team: 1 }], 1, 2);
  const world = new World(2);
  for (const r of roster) {
    const c = makeCar(r.id, r.tm, r.id === humanId ? 'remote' : 'bot');
    c.slot = r.sl;
    world.addCar(c);
  }
  world.kickoff();
  const match = new Match({ mid: 'm', by: 'h', roster, dur: 120, size: 1 });
  match.start(0);
  const host = new HostSim(world, match);
  return { world, match, host, car: world.car(humanId) };
}

test('HostSim: a remote touch becomes the ball, flown on to now, and counts for the toucher', () => {
  const { world, match, host, car } = hostWith('human');
  world.ball.x = 5;
  world.ball.z = 0;
  car.x = 2;
  const hit = readHit(encodeHit('m.1', 1000, { x: 5, y: BALL_R, z: 0, vx: 30, vy: 0, vz: 0 }, car));
  assert.equal(host.remoteHit(car, hit, 1100, { x: 2, z: 0 }), 1);
  assert.ok(world.ball.x > 5 + 30 * 0.1 - 0.5 && world.ball.vx > 29, `ball ${world.ball.x} ${world.ball.vx}`);
  assert.equal(match.st.human[3], 1);
  assert.equal(host.lastTeam, 1);
  const again = readHit(encodeHit('m.1', 900, { x: 5, y: BALL_R, z: 0, vx: -30, vy: 0, vz: 0 }, car));
  assert.equal(host.remoteHit(car, again, 1100, { x: 2, z: 0 }), 0, 'an older touch loses to the newer');
  match.phase = 'goal';
  const late = readHit(encodeHit('m.1', 1200, { x: world.ball.x, y: BALL_R, z: 0, vx: 1, vy: 0, vz: 0 }, car));
  assert.equal(host.remoteHit(car, late, 1250, { x: 2, z: 0 }), 0, 'no touches count during a celebration');
});

test('HostSim: a goal is decided once and the whole cycle follows', () => {
  const { world, match, host } = hostWith('human');
  const seen = [];
  world.ball.x = 38;
  world.ball.vx = 40;
  for (let i = 0, now = 100; i < 60 * 7; i++, now += 17) for (const e of host.step(now)) seen.push(e.type);
  assert.deepEqual(seen.slice(0, 2), ['goal', 'kick']);
  assert.equal(match.sc[0] + match.sc[1], 1);
  assert.ok(seen.includes('play'));
  assert.ok(Math.abs(world.ball.x) < 45, 'the ball was reset to the kickoff');
});
