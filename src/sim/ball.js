// The ball and what a car does to it. Pure maths.

import { BALL_R, BALLP, HITP, CAR_HX, CAR_HY, CAR_HZ, STEP } from './consts.js';
import { arenaProject, makeContact } from './arena.js';
import { clamp } from './rng.js';

const hit = makeContact();

export function makeBall() {
  return { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: BALL_R, pz: 0 };
}

export function placeBall(b, x = 0, y = BALL_R, z = 0, vx = 0, vy = 0, vz = 0) {
  b.x = b.px = x;
  b.y = b.py = y;
  b.z = b.pz = z;
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
}

function capSpeed(b) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  if (sp > BALLP.max) {
    const k = BALLP.max / sp;
    b.vx *= k;
    b.vy *= k;
    b.vz *= k;
  }
}

/** One fixed step of the ball on its own. Returns the speed of the hardest wall or floor hit this step (0 if none). */
export function stepBall(b, dt) {
  b.px = b.x;
  b.py = b.y;
  b.pz = b.z;
  b.vy -= BALLP.gravity * dt;
  const drag = Math.exp(-BALLP.drag * dt);
  b.vx *= drag;
  b.vy *= drag;
  b.vz *= drag;
  capSpeed(b);
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let impact = 0;
  for (let i = 0; i < 3; i++) {
    if (!arenaProject(b.x, b.y, b.z, BALL_R, 0, hit)) break;
    b.x = hit.x;
    b.y = hit.y;
    b.z = hit.z;
    const vn = b.vx * hit.nx + b.vy * hit.ny + b.vz * hit.nz;
    if (vn < 0) {
      const e = -vn < BALLP.minBounce ? 0 : BALLP.rest;
      const k = (1 + e) * vn;
      b.vx -= k * hit.nx;
      b.vy -= k * hit.ny;
      b.vz -= k * hit.nz;
      if (-vn > impact) impact = -vn;
    }
  }
  if (b.y <= BALL_R + 0.02 && Math.abs(b.vy) < 0.8) {
    const g = Math.exp(-BALLP.groundFriction * dt);
    b.vx *= g;
    b.vz *= g;
  }
  return impact;
}

/** Copies `src` into `out` and lets it fly for `seconds` of free motion (gravity, walls, floor), in fixed steps. */
export function advanceBall(src, seconds, out) {
  out.x = out.px = src.x;
  out.y = out.py = src.y;
  out.z = out.pz = src.z;
  out.vx = src.vx;
  out.vy = src.vy;
  out.vz = src.vz;
  let left = clamp(Number.isFinite(seconds) ? seconds : 0, 0, 1);
  while (left > 1e-6) {
    const dt = Math.min(STEP, left);
    stepBall(out, dt);
    left -= dt;
  }
  out.px = out.x;
  out.py = out.y;
  out.pz = out.z;
  return out;
}

/**
 * A car against the ball: if the car's box (a little inflated) touches the ball, the ball is pushed out and, when they were
 * closing, thrown: 1.6 times the closing speed along the contact normal, a push along the car's nose scaled by how squarely
 * it hit, and a bonus for a dodge. The car feels a little of it. Returns true on a hit.
 */
export function carBallHit(c, b, w) {
  const cp = Math.cos(c.p);
  const sp = Math.sin(c.p);
  const ch = Math.cos(c.h);
  const sh = Math.sin(c.h);
  const fx = cp * ch;
  const fy = sp;
  const fz = cp * sh;
  const rx = -sh;
  const rz = ch;
  const ux = -ch * sp;
  const uy = cp;
  const uz = -sh * sp;
  const dx = b.x - c.x;
  const dy = b.y - c.y;
  const dz = b.z - c.z;
  const lx = dx * fx + dy * fy + dz * fz;
  const ly = dx * ux + dy * uy + dz * uz;
  const lz = dx * rx + dz * rz;
  const hx = CAR_HX + HITP.inflate;
  const hy = CAR_HY + HITP.inflate;
  const hz = CAR_HZ + HITP.inflate;
  const qx = clamp(lx, -hx, hx);
  const qy = clamp(ly, -hy, hy);
  const qz = clamp(lz, -hz, hz);
  const ex = lx - qx;
  const ey = ly - qy;
  const ez = lz - qz;
  const d2 = ex * ex + ey * ey + ez * ez;
  if (d2 >= BALL_R * BALL_R) return false;

  let nlx;
  let nly;
  let nlz;
  let cx = qx;
  let cy = qy;
  let cz = qz;
  const d = Math.sqrt(d2);
  if (d > 1e-6) {
    nlx = ex / d;
    nly = ey / d;
    nlz = ez / d;
  } else {
    // the ball's centre is inside the box: leave by the nearest face
    const gx = hx - Math.abs(lx);
    const gy = hy - Math.abs(ly);
    const gz = hz - Math.abs(lz);
    nlx = nly = nlz = 0;
    if (gx <= gy && gx <= gz) {
      nlx = lx < 0 ? -1 : 1;
      cx = nlx * hx;
    } else if (gy <= gz) {
      nly = ly < 0 ? -1 : 1;
      cy = nly * hy;
    } else {
      nlz = lz < 0 ? -1 : 1;
      cz = nlz * hz;
    }
  }
  const nx = nlx * fx + nly * ux + nlz * rx;
  const ny = nlx * fy + nly * uy;
  const nz = nlx * fz + nly * uz + nlz * rz;
  b.x = c.x + fx * cx + ux * cy + rx * cz + nx * (BALL_R + 0.002);
  b.y = c.y + fy * cx + uy * cy + ny * (BALL_R + 0.002);
  b.z = c.z + fz * cx + uz * cy + rz * cz + nz * (BALL_R + 0.002);
  if (b.y < BALL_R) b.y = BALL_R;

  // the push goes along the contact normal with its upward part reduced, so a hit on the ground drives the ball forward
  // and lifts it a little instead of popping it into the air
  let kx = nx;
  let ky = ny * HITP.lift;
  let kz = nz;
  const kl = Math.hypot(kx, ky, kz) || 1;
  kx /= kl;
  ky /= kl;
  kz /= kl;
  const vn = (b.vx - c.vx) * kx + (b.vy - c.vy) * ky + (b.vz - c.vz) * kz;
  if (vn >= -0.05) return false;
  const j = -vn * (1 + HITP.restitution);
  b.vx += kx * j;
  b.vy += ky * j;
  b.vz += kz * j;
  const align = clamp(fx * kx + fy * ky + fz * kz, 0, 1);
  const push = HITP.power * align;
  b.vx += fx * push;
  b.vy += fy * push;
  b.vz += fz * push;
  if (c.dodge > 0) {
    const k = HITP.dodge * (0.35 + 0.65 * align);
    b.vx += c.dodgeX * k;
    b.vz += c.dodgeZ * k;
  }
  capSpeed(b);
  c.vx -= kx * j * HITP.recoil;
  c.vz -= kz * j * HITP.recoil;
  if (w) w.emit('hit', c, Math.hypot(b.vx - c.vx, b.vy - c.vy, b.vz - c.vz), c.dodge > 0 ? 1 : 0);
  return true;
}
