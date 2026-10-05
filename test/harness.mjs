// Shared by the tests: seat bots, run a whole match through the pure modules the way the host page does.

import { World } from '../src/sim/world.js';
import { makeCar } from '../src/sim/car.js';
import { Match, buildRoster } from '../src/sim/rules.js';
import { HostSim } from '../src/sim/host.js';
import { STEP, PX, PZ, CEIL } from '../src/sim/consts.js';
import { insideArena } from '../src/sim/arena.js';

export function botWorld(seed, size, humans = []) {
  const { roster } = buildRoster(humans, size, seed);
  const world = new World(seed);
  for (const r of roster) {
    const car = makeCar(r.id, r.tm, r.b ? 'bot' : 'local');
    car.slot = r.sl;
    car.bot = !!r.b;
    car.name = r.nm;
    world.addCar(car);
  }
  world.kickoff();
  return { world, roster, size };
}

export function finiteWorld(world) {
  const b = world.ball;
  for (const v of [b.x, b.y, b.z, b.vx, b.vy, b.vz]) if (!Number.isFinite(v)) return false;
  for (const c of world.cars) for (const v of [c.x, c.y, c.z, c.vx, c.vy, c.vz, c.h, c.p, c.boost]) if (!Number.isFinite(v)) return false;
  return true;
}

export function inBounds(world) {
  const b = world.ball;
  if (!insideArena(b.x, b.y, b.z, 0.5)) return false;
  for (const c of world.cars) if (!insideArena(c.x, c.y, c.z, 0.6)) return false;
  return true;
}

/** A whole match of bots only. Returns what happened. */
export function runMatch({ seed, size = 3, dur = 120, maxSeconds = 1200, check = true }) {
  const { world, roster } = botWorld(seed, size);
  const match = new Match({ mid: `m${seed}`, by: 'host', roster, dur, size });
  const host = new HostSim(world, match);
  match.start(0);
  world.frozen = false;
  const log = { goals: [], phases: new Set(), kicks: 0, ot: false, done: false, ticks: 0, maxBallSpeed: 0, nan: false, oob: false, saves: 0 };
  let now = 0;
  const maxTicks = Math.round(maxSeconds / STEP);
  for (let i = 0; i < maxTicks; i++) {
    now = Math.round(i * STEP * 1000);
    const ev = host.step(now);
    log.ticks++;
    log.phases.add(match.phase);
    for (const e of ev) {
      if (e.type === 'goal') log.goals.push({ at: now, ...e.last });
      if (e.type === 'kick') log.kicks++;
      if (e.type === 'ot') log.ot = true;
      if (e.type === 'save') log.saves++;
      if (e.type === 'done') log.done = true;
    }
    const b = world.ball;
    log.maxBallSpeed = Math.max(log.maxBallSpeed, Math.hypot(b.vx, b.vy, b.vz));
    if (check && i % 15 === 0) {
      if (!finiteWorld(world)) {
        log.nan = true;
        break;
      }
      if (!inBounds(world)) {
        log.oob = true;
        break;
      }
    }
    if (log.done) break;
  }
  return { world, match, host, roster, log, now };
}

export { PX, PZ, CEIL };
