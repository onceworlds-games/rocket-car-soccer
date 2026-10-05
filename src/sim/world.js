// The world: cars, the ball and the boost pads, stepped at a fixed rate. The same object runs on every page (a page
// simulates its own car and its own copy of the ball), on the host (which also simulates the bots and owns the ball),
// in the title screen's demo and in the tests. It knows nothing about networks, rules or drawing.

import { CAR_R, PADS, PAD_SMALL, PAD_BIG, CARP } from './consts.js';
import { kickoffSpot } from './arena.js';
import { placeCar, stepCar } from './car.js';
import { makeBall, placeBall, stepBall, carBallHit } from './ball.js';
import { botThink } from './bots.js';
import { mulberry32 } from './rng.js';

export class World {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.cars = [];
    this.byId = new Map();
    this.ball = makeBall();
    this.pads = PADS.map((p) => ({ x: p.x, z: p.z, big: p.big, cd: 0 }));
    this.frozen = false; // kickoff countdowns: nothing moves
    this.botsHold = false; // bots stand still (a celebration)
    this.time = 0;
    this.ev = Array.from({ length: 64 }, () => ({ type: '', car: null, a: 0, b: 0 }));
    this.nev = 0;
    this.lastToucher = null;
    this.spot = { x: 0, z: 0, h: 0 };
  }

  /** Records something that happened this step (for sounds, effects and the rules). Read ev[0..nev) after step(). */
  emit(type, car, a = 0, b = 0) {
    if (this.nev >= this.ev.length) return;
    const e = this.ev[this.nev++];
    e.type = type;
    e.car = car;
    e.a = a;
    e.b = b;
  }

  addCar(car) {
    if (this.byId.has(car.id)) return this.byId.get(car.id);
    this.cars.push(car);
    this.byId.set(car.id, car);
    return car;
  }

  removeCar(id) {
    const car = this.byId.get(id);
    if (!car) return;
    this.byId.delete(id);
    this.cars.splice(this.cars.indexOf(car), 1);
    if (this.lastToucher === car) this.lastToucher = null;
  }

  car(id) {
    return this.byId.get(id) ?? null;
  }

  /** Every car to its kickoff spot (still, with the kickoff boost), the ball to the centre, the pads back. */
  kickoff() {
    for (const c of this.cars) this.placeAtSpot(c);
    placeBall(this.ball);
    for (const p of this.pads) p.cd = 0;
    this.lastToucher = null;
  }

  placeAtSpot(c) {
    kickoffSpot(c.team, c.slot, this.spot);
    placeCar(c, this.spot.x, this.spot.z, this.spot.h, CARP.kickoffBoost);
    c.visible = true;
  }

  /** One fixed step. */
  step(dt) {
    this.nev = 0;
    const ball = this.ball;
    const cars = this.cars;
    if (this.frozen) {
      ball.px = ball.x;
      ball.py = ball.y;
      ball.pz = ball.z;
      for (const c of cars) {
        c.px = c.x;
        c.py = c.y;
        c.pz = c.z;
        c.ph = c.h;
        c.pp = c.p;
      }
      this.time += dt;
      return;
    }
    for (const c of cars) {
      if (c.kind === 'remote') {
        c.px = c.x;
        c.py = c.y;
        c.pz = c.z;
        c.ph = c.h;
        c.pp = c.p;
        continue;
      }
      if (c.kind === 'bot') botThink(c, this, dt);
      stepCar(c, dt, this);
      if (!(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z) && Number.isFinite(c.h) && Number.isFinite(c.p))) this.placeAtSpot(c);
    }
    this.carCar();
    const impact = stepBall(ball, dt);
    if (impact > 5) this.emit('ballwall', null, impact, 0);
    if (!(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(ball.z))) placeBall(ball);
    for (const c of cars) {
      if (c.kind === 'remote') continue;
      if (carBallHit(c, ball, this)) this.lastToucher = c;
    }
    this.pads_(dt);
    this.time += dt;
  }

  carCar() {
    const cs = this.cars;
    const n = cs.length;
    for (let i = 0; i < n; i++) {
      const a = cs[i];
      for (let j = i + 1; j < n; j++) {
        const b = cs[j];
        const aMove = a.kind !== 'remote';
        const bMove = b.kind !== 'remote';
        if (!aMove && !bMove) continue;
        if (!a.visible || !b.visible) continue;
        if (Math.abs(a.y - b.y) > 1.3) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const min = CAR_R * 2;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          dx = 1;
          dz = 0;
          d = 1e-6;
        }
        const nx = dx / d;
        const nz = dz / d;
        const pen = min - d;
        if (aMove && bMove) {
          a.x -= nx * pen * 0.5;
          a.z -= nz * pen * 0.5;
          b.x += nx * pen * 0.5;
          b.z += nz * pen * 0.5;
        } else if (aMove) {
          a.x -= nx * pen;
          a.z -= nz * pen;
        } else {
          b.x += nx * pen;
          b.z += nz * pen;
        }
        const closing = -((b.vx - a.vx) * nx + (b.vz - a.vz) * nz);
        if (closing > 0) {
          const k = closing * 1.35 * 0.5;
          if (aMove) {
            a.vx -= nx * k;
            a.vz -= nz * k;
          }
          if (bMove) {
            b.vx += nx * k;
            b.vz += nz * k;
          }
          if (closing > 4) this.emit('carbump', aMove ? a : b, closing, 0);
        }
      }
    }
  }

  pads_(dt) {
    const pads = this.pads;
    for (const p of pads) if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
    for (const c of this.cars) {
      if (c.y > 1.7 || !c.visible) continue;
      for (const p of pads) {
        if (p.cd > 0) continue;
        const spec = p.big ? PAD_BIG : PAD_SMALL;
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        if (dx * dx + dz * dz > spec.radius * spec.radius) continue;
        p.cd = spec.cooldown;
        if (c.kind !== 'remote') c.boost = Math.min(100, c.boost + spec.amount);
        this.emit('pad', c, p.big ? 1 : 0, spec.amount);
      }
    }
  }
}

