import test from 'node:test';
import assert from 'node:assert/strict';
import { botWorld, finiteWorld, inBounds } from './harness.mjs';
import { botThink } from '../src/sim/bots.js';
import { STEP, BALL_R } from '../src/sim/consts.js';

test('bots only ever set legal inputs', () => {
  const { world } = botWorld(11, 3);
  let jumps = 0;
  for (let i = 0; i < 60 * 60; i++) {
    world.step(STEP);
    for (const c of world.cars) {
      assert.ok(Number.isFinite(c.thr) && c.thr >= -1 && c.thr <= 1, `thr ${c.thr}`);
      assert.ok(Number.isFinite(c.steer) && c.steer >= -1 && c.steer <= 1, `steer ${c.steer}`);
      assert.ok(Number.isFinite(c.pitchIn));
      assert.equal(typeof c.boostIn, 'boolean');
    }
    jumps += world.ev.slice(0, world.nev).filter((e) => e.type === 'jump' || e.type === 'dodge').length;
  }
  assert.ok(finiteWorld(world) && inBounds(world));
  assert.ok(world.cars.every((c) => c.brain), 'every bot has a brain of its own');
  const reacts = new Set(world.cars.map((c) => c.brain.react.toFixed(3)));
  assert.equal(reacts.size, world.cars.length, 'each bot reacts at its own speed');
  assert.ok(world.cars.every((c) => c.brain.react >= 0.15 && c.brain.react <= 0.35));
  assert.ok(jumps >= 0);
});

test('bots never stand still and keep touching the ball', () => {
  const { world } = botWorld(5, 2);
  const slow = new Map(world.cars.map((c) => [c.id, 0]));
  let touches = 0;
  for (let i = 0; i < 60 * 90; i++) {
    world.step(STEP);
    for (let k = 0; k < world.nev; k++) if (world.ev[k].type === 'hit') touches++;
    if (i > 60 * 5) for (const c of world.cars) if (Math.hypot(c.vx, c.vz) < 0.5) slow.set(c.id, slow.get(c.id) + 1);
  }
  for (const [id, ticks] of slow) assert.ok(ticks < 60 * 20, `${id} stood still for ${ticks / 60} s`);
  assert.ok(touches >= 8, `touches ${touches}`);
});

test('a bot nearest the ball attacks and the other holds back', () => {
  const { world } = botWorld(2, 2);
  world.ball.x = -10;
  world.ball.z = 0;
  for (let i = 0; i < 30; i++) world.step(STEP);
  const blue = world.cars.filter((c) => c.team === 1);
  const roles = blue.map((c) => c.brain.role).sort();
  assert.deepEqual(roles, ['atk', 'def']);
});

test('a bot with the ball in front of its own goal clears it sideways and upfield, not into the net', () => {
  let into = 0;
  let out = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { world } = botWorld(seed, 1);
    const blue = world.cars.find((c) => c.team === 1);
    const orange = world.cars.find((c) => c.team === 2);
    orange.kind = 'remote'; // only the blue bot plays
    orange.x = 30;
    orange.z = 20;
    world.ball.x = -33;
    world.ball.z = 6 - (seed % 3) * 5;
    world.ball.y = BALL_R;
    blue.x = -22;
    blue.z = 0;
    for (let i = 0; i < 60 * 8; i++) {
      world.step(STEP);
      if (world.ball.x < -40.5) {
        into++;
        break;
      }
    }
    if (world.ball.x > -40.5) out++;
  }
  assert.ok(into <= 4, `${into} of 12 went into the bot's own goal`);
  assert.ok(out >= 8);
});

test('a bot can be told to hold still (a celebration) and then moves again', () => {
  const { world } = botWorld(3, 1);
  world.botsHold = true;
  for (let i = 0; i < 60; i++) world.step(STEP);
  assert.ok(world.cars.every((c) => Math.hypot(c.vx, c.vz) < 0.1));
  world.botsHold = false;
  for (let i = 0; i < 60; i++) world.step(STEP);
  assert.ok(world.cars.some((c) => Math.hypot(c.vx, c.vz) > 3));
  assert.equal(typeof botThink, 'function');
});
