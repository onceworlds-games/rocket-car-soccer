// Car physics: one car, one fixed step. Pure maths: the world (world.js) owns the cars, the ball and the events.
//
// A car stays on the floor until it jumps. On the floor it accelerates along its heading, grips sideways and turns
// slower the faster it goes. In the air it falls, yaws slowly, pitches with W/S and its boost pushes along its nose.

import { CARP, CAR_Y, CAR_R, TEAM_BLUE } from './consts.js';
import { arenaProject, makeContact } from './arena.js';
import { clamp, lerp, wrapPi } from './rng.js';

const hit = makeContact();

/** A new car. kind: 'local' (this page drives it), 'bot' (this page simulates it), 'remote' (set from the network). */
export function makeCar(id, team, kind = 'remote') {
  return {
    id,
    team,
    kind,
    slot: 0,
    bot: false,
    name: '',
    accent: 0,
    visible: true,
    x: 0,
    y: CAR_Y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    h: team === TEAM_BLUE ? 0 : Math.PI,
    p: 0,
    px: 0,
    py: CAR_Y,
    pz: 0,
    ph: 0,
    pp: 0,
    boost: CARP.kickoffBoost,
    ground: true,
    jumpT: -1,
    canAir: false,
    dodge: 0,
    dodgeA: 0,
    dodgeX: 1,
    dodgeZ: 0,
    boosting: false,
    ss: false,
    assist: false,
    // inputs, set by the player's controls or a bot's brain
    thr: 0,
    steer: 0,
    pitchIn: 0,
    boostIn: false,
    jumpIn: false,
    brain: null,
  };
}

/** Puts a car on the floor at a spot, still, with `boost`. */
export function placeCar(c, x, z, h, boost = CARP.kickoffBoost) {
  c.x = c.px = x;
  c.y = c.py = CAR_Y;
  c.z = c.pz = z;
  c.vx = c.vy = c.vz = 0;
  c.h = c.ph = h;
  c.p = c.pp = 0;
  c.ground = true;
  c.jumpT = -1;
  c.canAir = false;
  c.dodge = 0;
  c.boost = boost;
  c.boosting = false;
  c.ss = false;
  c.thr = c.steer = c.pitchIn = 0;
  c.boostIn = false;
  c.jumpIn = false;
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/** One fixed step of a simulated car. `w` is the world: emit(type, car, a, b) and ball. */
export function stepCar(c, dt, w) {
  const P = CARP;
  c.px = c.x;
  c.py = c.y;
  c.pz = c.z;
  c.ph = c.h;
  c.pp = c.p;
  c.boosting = false;
  const thr = clamp(num(c.thr), -1, 1);
  const steer = clamp(num(c.steer), -1, 1);
  const pitchIn = clamp(num(c.pitchIn), -1, 1);
  const wantBoost = c.boostIn === true && c.boost > 0;

  c.boost = Math.min(100, c.boost + P.boostRegen * dt);

  if (c.ground && c.jumpIn) {
    c.jumpIn = false;
    c.vy = P.jumpV;
    c.ground = false;
    c.jumpT = 0;
    c.canAir = true;
    w.emit('jump', c, 0, 0);
  }

  if (c.ground) {
    const ch = Math.cos(c.h);
    const sh = Math.sin(c.h);
    let vf = c.vx * ch + c.vz * sh;
    let vl = -c.vx * sh + c.vz * ch;
    let acc = 0;
    if (thr > 0) acc += P.accel * thr;
    if (wantBoost) {
      acc += P.boostAccel;
      c.boost = Math.max(0, c.boost - P.boostUse * dt);
      c.boosting = true;
    }
    const cap = wantBoost ? P.boostMax : P.max;
    if (acc > 0 && vf < cap) vf = Math.min(cap, vf + acc * dt);
    if (thr < 0 && !wantBoost) {
      if (vf > 0.5) vf = Math.max(0, vf + thr * P.brake * dt);
      else vf = Math.max(-P.reverseMax, vf + thr * P.reverse * dt);
    } else if (thr === 0 && !wantBoost) {
      const d = Math.min(Math.abs(vf), P.coast * dt);
      vf -= Math.sign(vf) * d;
    }
    if (vf > cap) vf = Math.max(cap, vf - P.overspeed * dt);
    // the velocity in the old frame, then turn the car and keep what grips
    const wx = ch * vf - sh * vl;
    const wz = sh * vf + ch * vl;
    const sp = Math.abs(vf);
    const rate = lerp(P.turnLow, P.turnHigh, clamp(sp / P.boostMax, 0, 1));
    c.h = wrapPi(c.h + steer * rate * Math.min(1, sp / 3) * (vf >= 0 ? 1 : -1) * dt);
    const ch2 = Math.cos(c.h);
    const sh2 = Math.sin(c.h);
    const vf2 = wx * ch2 + wz * sh2;
    const vl2 = (-wx * sh2 + wz * ch2) * Math.exp(-P.grip * dt);
    c.vx = ch2 * vf2 - sh2 * vl2;
    c.vz = sh2 * vf2 + ch2 * vl2;
    c.vy = 0;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    c.y = CAR_Y;
    c.p = 0;
    c.jumpIn = false;
  } else {
    c.jumpT += dt;
    if (c.jumpIn) {
      c.jumpIn = false;
      if (c.canAir && c.jumpT <= P.dodgeWindow) {
        c.canAir = false;
        const len = Math.hypot(thr, steer);
        if (len > 0.35) {
          const ch = Math.cos(c.h);
          const sh = Math.sin(c.h);
          const dx = ch * thr - sh * steer;
          const dz = sh * thr + ch * steer;
          const m = Math.hypot(dx, dz) || 1;
          c.dodgeX = dx / m;
          c.dodgeZ = dz / m;
          c.vx += c.dodgeX * P.dodgeV;
          c.vz += c.dodgeZ * P.dodgeV;
          c.dodge = P.dodgeTime;
          c.dodgeA = Math.atan2(steer, thr);
          w.emit('dodge', c, 0, 0);
        } else {
          c.vy = P.doubleJumpV;
          w.emit('jump', c, 1, 0);
        }
      }
    }
    if (c.dodge > 0) {
      c.dodge = Math.max(0, c.dodge - dt);
    } else {
      c.p = clamp(c.p + pitchIn * P.airPitch * dt, -1.35, 1.35);
    }
    c.h = wrapPi(c.h + steer * P.airYaw * dt);
    // a gentle turn toward the ball for a player who boosts without steering, so a first aerial isn't a puzzle
    if (c.assist && wantBoost && Math.abs(pitchIn) < 0.1 && Math.abs(steer) < 0.1 && c.dodge <= 0 && w.ball) {
      const dx = w.ball.x - c.x;
      const dz = w.ball.z - c.z;
      const dy = w.ball.y - c.y;
      const hd = Math.hypot(dx, dz);
      if (hd > 2) {
        c.h = wrapPi(c.h + clamp(wrapPi(Math.atan2(dz, dx) - c.h) * 3, -1.8, 1.8) * dt);
        const wantP = clamp(Math.atan2(dy, hd), -1.2, 1.2);
        c.p = clamp(c.p + clamp((wantP - c.p) * 3, -2, 2) * dt, -1.35, 1.35);
      }
    }
    if (wantBoost) {
      const cp = Math.cos(c.p);
      c.vx += cp * Math.cos(c.h) * P.airBoost * dt;
      c.vy += Math.sin(c.p) * P.airBoost * dt;
      c.vz += cp * Math.sin(c.h) * P.airBoost * dt;
      c.boost = Math.max(0, c.boost - P.boostUse * dt);
      c.boosting = true;
    }
    c.vy -= P.gravity * dt;
    const drag = Math.exp(-P.airDrag * dt);
    c.vx *= drag;
    c.vz *= drag;
    if (c.boosting) {
      const sp = Math.hypot(c.vx, c.vy, c.vz);
      if (sp > P.airMax) {
        const k = P.airMax / sp;
        c.vx *= k;
        c.vy *= k;
        c.vz *= k;
      }
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    if (c.y <= CAR_Y && c.vy <= 0) {
      if (c.vy < -6) w.emit('land', c, -c.vy, 0);
      c.y = CAR_Y;
      c.vy = 0;
      c.ground = true;
      c.jumpT = -1;
      c.canAir = false;
      c.dodge = 0;
      c.p = 0;
    }
  }

  // walls, corners, ceiling and the goal frame
  if (arenaProject(c.x, c.y, c.z, CAR_R, 0.7, hit)) {
    const vn = c.vx * hit.nx + c.vy * hit.ny + c.vz * hit.nz;
    c.x = hit.x;
    c.y = hit.y;
    c.z = hit.z;
    if (vn < 0) {
      const k = (1 + P.wallBounce) * vn;
      c.vx -= k * hit.nx;
      c.vy -= k * hit.ny;
      c.vz -= k * hit.nz;
      if (-vn > 5 && hit.ny < 0.7) w.emit('bump', c, -vn, 0);
    }
    if (c.y < CAR_Y) c.y = CAR_Y;
  }
  const speed = Math.hypot(c.vx, c.vy, c.vz);
  c.ss = speed > P.boostMax * P.supersonic;
}
