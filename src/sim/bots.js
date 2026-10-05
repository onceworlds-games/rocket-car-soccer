// Bot drivers. A bot reads the world like a player would and sets the same inputs a player's controls set: throttle,
// steering, boost and a jump press. Each has a reaction time (it sees the ball a moment late), aim noise and a habit of
// getting it wrong now and then, so they are beatable. The bot nearest the ball attacks; the others hold a spot between
// the ball and their own goal, and clear the ball when it comes close to their goal.

import { PX, PZ, BALL_R, TEAM_BLUE } from './consts.js';
import { clamp, wrapPi, mulberry32, hashString } from './rng.js';

const MEM = 40; // ticks of ball history a bot can look back through (reaction time up to 0.66 s)

function makeBrain(car, seed) {
  const rng = mulberry32((hashString(car.id) ^ seed) >>> 0);
  return {
    rng,
    react: 0.15 + rng() * 0.2,
    noise: 0.05 + rng() * 0.2,
    mem: new Float32Array(MEM * 6),
    head: 0,
    count: 0,
    role: 'def',
    t: 0,
    nextAim: 0,
    aimZ: 0,
    stuck: 0,
    rev: 0,
    revSteer: 1,
    jumpCool: 0,
    tx: 0,
    tz: 0,
    // the ball as the bot sees it: a moment ago
    bx: 0,
    by: BALL_R,
    bz: 0,
    bvx: 0,
    bvz: 0,
  };
}

function remember(br, ball) {
  const o = br.head * 6;
  br.mem[o] = ball.x;
  br.mem[o + 1] = ball.y;
  br.mem[o + 2] = ball.z;
  br.mem[o + 3] = ball.vx;
  br.mem[o + 4] = ball.vy;
  br.mem[o + 5] = ball.vz;
  br.head = (br.head + 1) % MEM;
  if (br.count < MEM) br.count++;
}

function perceive(br, ticks) {
  const back = Math.min(ticks, br.count - 1);
  const i = (br.head - 1 - back + MEM * 2) % MEM;
  const o = i * 6;
  br.bx = br.mem[o];
  br.by = br.mem[o + 1];
  br.bz = br.mem[o + 2];
  br.bvx = br.mem[o + 3];
  br.bvz = br.mem[o + 5];
}

/** Steers a car toward a point on the floor. Sets thr and steer; `slow` caps the throttle (arriving). */
function driveTo(car, tx, tz, slow = 1) {
  const dx = tx - car.x;
  const dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  const diff = wrapPi(Math.atan2(dz, dx) - car.h);
  const ad = Math.abs(diff);
  car.steer = clamp(diff * 2.4, -1, 1);
  let thr = ad < 0.9 ? 1 : ad < 1.6 ? 0.6 : 0.3;
  if (dist < 3) thr *= 0.4;
  car.thr = Math.min(thr, slow);
  return { dist, ad };
}

/** Sets this bot's inputs for the next step. */
export function botThink(car, w, dt) {
  const br = car.brain ?? (car.brain = makeBrain(car, w.seed));
  const ball = w.ball;
  br.t += dt;
  remember(br, ball);
  perceive(br, Math.round(br.react / dt));
  car.thr = 0;
  car.steer = 0;
  car.pitchIn = 0;
  car.boostIn = false;
  br.jumpCool -= dt;
  if (w.botsHold) return;
  if (br.t >= br.nextAim) {
    br.nextAim = br.t + 0.7 + br.rng() * 0.9;
    br.aimZ = (br.rng() * 2 - 1) * br.noise * 12;
  }

  const dir = car.team === TEAM_BLUE ? 1 : -1; // the way this team attacks along x
  const goalX = dir * PX;
  const ownX = -dir * PX;

  // who attacks: the bot of this team nearest the ball (the one already attacking keeps a small lead)
  const mine = Math.hypot(br.bx - car.x, br.bz - car.z) - (br.role === 'atk' ? 3 : 0);
  let rank = 0;
  for (const o of w.cars) {
    if (o === car || o.team !== car.team || o.kind !== 'bot' || !o.brain) continue;
    const d = Math.hypot(br.bx - o.x, br.bz - o.z) - (o.brain.role === 'atk' ? 3 : 0);
    if (d < mine || (d === mine && o.id < car.id)) rank++;
  }
  const dBall = Math.hypot(br.bx - car.x, br.bz - car.z);
  const ballFromOwn = (br.bx - ownX) * dir; // how far the ball is from our goal line, along the pitch
  const clearing = rank === 1 && ballFromOwn < 24 && dBall < 22;
  const attack = rank === 0 || clearing;
  br.role = rank === 0 ? 'atk' : 'def';

  // the speed the car is making, for stuck detection
  const speed = Math.hypot(car.vx, car.vz);

  if (br.rev > 0) {
    br.rev -= dt;
    car.thr = -1;
    car.steer = br.revSteer;
    return;
  }

  let wantThr;
  if (attack) {
    // where the ball will be by the time we get there
    const eta = clamp(dBall / 22, 0, 1.1);
    let bx = clamp(br.bx + br.bvx * eta, -(PX - BALL_R), PX - BALL_R);
    let bz = clamp(br.bz + br.bvz * eta, -(PZ - BALL_R), PZ - BALL_R);
    if (dBall < 6) {
      bx = br.bx;
      bz = br.bz;
    }
    // strike along the line from the ball through the goal we attack; with the ball close to our own goal line, clear it
    // upfield and to the side instead (a shot from there would go the wrong way)
    let sx = goalX - bx;
    let sz = br.aimZ - bz;
    const danger = (bx - ownX) * dir;
    if (danger < 15) {
      const side = bz > 0 ? 1 : bz < 0 ? -1 : car.z >= 0 ? -1 : 1;
      const k = clamp((15 - danger) / 15, 0, 1); // 0 at 15 m out, 1 on the line
      sx = dir * 14;
      sz = side * 14 * (0.4 + 1.2 * k);
    }
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    // Where round the ball are we, compared with where we want to be (on the far side from the goal we attack)?
    const here = Math.atan2(car.z - bz, car.x - bx);
    const want = Math.atan2(-sz, -sx);
    const turn = wrapPi(want - here);
    const behind = (car.x - bx) * sx + (car.z - bz) * sz; // negative: we are behind the ball, the right side
    let tx;
    let tz;
    if (Math.abs(turn) < 0.9 && behind < -1.5) {
      // well placed: run at a point behind the ball, then through it
      const off = clamp(dBall * 0.4, 0, 12);
      tx = bx - sx * off;
      tz = bz - sz * off;
      if (dBall < 7) {
        tx = bx;
        tz = bz;
      }
    } else {
      // out of position: circle the ball at a distance, the short way round, never across it
      const a = here + clamp(turn, -0.8, 0.8);
      const radius = clamp(dBall, 9, 13);
      tx = bx + Math.cos(a) * radius;
      tz = bz + Math.sin(a) * radius;
    }
    tx = clamp(tx, -(PX - 4), PX - 4);
    tz = clamp(tz, -(PZ - 3.5), PZ - 3.5);
    const r = driveTo(car, tx, tz);
    wantThr = car.thr;
    // boost when far and pointing the right way
    if (r.dist > 16 && r.ad < 0.2 && car.boost > 18 && speed < 31) car.boostIn = true;
    // a high ball: jump into it, then flip through it
    const hb = Math.hypot(br.bx - car.x, br.bz - car.z);
    if (car.ground && br.jumpCool <= 0 && hb < 7.5 && br.by > 3.2 && br.by < 7 && behind < 0) {
      car.jumpIn = true;
      br.jumpCool = 1.4;
    } else if (!car.ground && car.canAir && car.jumpT > 0.12 && car.jumpT < 0.8 && hb < 6.5 && Math.abs(br.by - car.y) < 4.8) {
      car.thr = 1;
      car.steer = 0;
      car.jumpIn = true;
    }
  } else {
    // hold a spot between the ball and our goal: further back for each extra defender, spread across the pitch
    const frac = rank === 1 ? 0.45 : 0.28;
    const bx = br.bx;
    const bz = br.bz;
    let tx = ownX + (bx - ownX) * frac;
    let tz = bz * 0.55 + (rank >= 2 ? (rank % 2 ? 9 : -9) : 0);
    tx = clamp(tx, -(PX - 6), PX - 6);
    tz = clamp(tz, -(PZ - 5), PZ - 5);
    const r = driveTo(car, tx, tz, arrival(car, tx, tz));
    wantThr = car.thr;
    if (r.dist < 4) {
      // arrived: turn to face the ball and keep rolling gently, a bot never parks
      const want = wrapPi(Math.atan2(bz - car.z, bx - car.x) - car.h);
      car.steer = clamp(want * 2, -1, 1);
      car.thr = speed < 3 ? 0.32 : 0;
      wantThr = 0;
    }
  }

  // wedged against something: back out for a moment
  if (car.ground && speed < 1.2 && wantThr > 0.3) {
    br.stuck += dt;
    if (br.stuck > 0.7) {
      br.stuck = 0;
      br.rev = 0.8;
      br.revSteer = br.rng() < 0.5 ? -1 : 1;
    }
  } else {
    br.stuck = Math.max(0, br.stuck - dt * 2);
  }
}

/** Slow a defender down as it nears its spot. */
function arrival(car, tx, tz) {
  const d = Math.hypot(tx - car.x, tz - car.z);
  return d > 14 ? 1 : clamp(d / 14 + 0.25, 0.25, 1);
}

