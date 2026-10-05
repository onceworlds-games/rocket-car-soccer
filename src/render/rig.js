// The camera: where it stands and what it looks at. Pure maths (no three.js), so it can be tested. A chase camera sits
// behind and above the car; with ball cam on it turns to keep the ball ahead of the car. Other modes: a slow orbit for the
// title, a broadcast view for watchers and a swing round the goal for the celebration.

import { PX, PZ, GOAL_HW, GOAL_D, CAR_Y } from '../sim/consts.js';
import { clamp, wrapPi, lerp } from '../sim/rng.js';

export class CameraRig {
  constructor() {
    this.x = 0;
    this.y = 12;
    this.z = 40;
    this.lx = 0;
    this.ly = 1;
    this.lz = 0;
    this.yaw = 0;
    this.fov = 75;
    this.trauma = 0;
    this.t = 0;
    this.shakeOn = true;
    this.fovKick = true;
    // what to apply: the position and target with shake, and a little roll
    this.px = 0;
    this.py = 12;
    this.pz = 40;
    this.tx = 0;
    this.ty = 1;
    this.tz = 0;
    this.roll = 0;
  }

  addTrauma(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** Jumps straight to where a chase camera would be (after a reset), with no easing. */
  snapChase(c, ball, ballCam) {
    this.yaw = c.h;
    if (ballCam) {
      const d = Math.hypot(ball.x - c.x, ball.z - c.z);
      if (d > 4) this.yaw = Math.atan2(ball.z - c.z, ball.x - c.x);
    }
    this.chase(0, c, ball, ballCam, 1);
  }

  /** Behind the car, the ball ahead of it if `ballCam`. `ease` 1 = snap into place. */
  chase(dt, c, ball, ballCam, ease = 0) {
    this.t += dt;
    const dxB = ball.x - c.x;
    const dzB = ball.z - c.z;
    const dB = Math.hypot(dxB, dzB);
    let target = c.h;
    if (ballCam && dB > 4) {
      const diff = wrapPi(Math.atan2(dzB, dxB) - c.h);
      const ad = Math.abs(diff);
      // the ball may be anywhere in front; as it goes behind the car the camera turns back to the car's own heading
      const w = ad < 1.75 ? 1 : clamp(1 - (ad - 1.75) / 0.9, 0, 1);
      target = c.h + diff * w;
    }
    this.yaw += wrapPi(target - this.yaw) * (ease || 1 - Math.exp(-dt * (ballCam ? 5 : 6.5)));
    const fx = Math.cos(this.yaw);
    const fz = Math.sin(this.yaw);
    const height = 3.5 + (ballCam ? clamp(ball.y - 3, 0, 9) * 0.28 : 0) + Math.max(0, c.y - CAR_Y) * 0.55;
    let dx = c.x - fx * 10;
    let dy = c.y + height;
    let dz = c.z - fz * 10;
    // never inside a wall: pull the camera into the arena and lift it when it had to move
    const gx = Math.abs(c.z) < GOAL_HW - 1.5 ? PX + GOAL_D - 1.4 : PX - 1.4;
    const cx = clamp(dx, -gx, gx);
    const cz = clamp(dz, -(PZ - 1.4), PZ - 1.4);
    const moved = Math.hypot(cx - dx, cz - dz);
    dx = cx;
    dz = cz;
    dy = clamp(dy + moved * 0.35, 1.6, 16.5);
    const k = ease || 1 - Math.exp(-dt * 11);
    this.x += (dx - this.x) * k;
    this.y += (dy - this.y) * k;
    this.z += (dz - this.z) * k;
    const ahead = ballCam ? clamp(dB * 0.55, 8, 30) : 12;
    const ly = ballCam ? lerp(c.y + 0.8, ball.y, 0.3) : c.y + 1;
    const tl = ease || 1 - Math.exp(-dt * 12);
    this.lx += (c.x + fx * ahead - this.lx) * tl;
    this.ly += (ly - this.ly) * tl;
    this.lz += (c.z + fz * ahead - this.lz) * tl;
    const speed = Math.hypot(c.vx, c.vz);
    const fovTarget = this.fovKick ? 75 + clamp(speed / 33, 0, 1) * 7 : 75;
    this.fov += (fovTarget - this.fov) * (ease || 1 - Math.exp(-dt * 3));
    this.finish(dt);
  }

  /** A slow orbit round the whole pitch, watching the ball (the title screen). */
  orbit(dt, ball) {
    this.t += dt;
    const a = this.t * 0.16 + 0.6;
    const dx = Math.cos(a) * 66;
    const dz = Math.sin(a) * 40;
    const dy = 17 + Math.sin(this.t * 0.31) * 3;
    const k = 1 - Math.exp(-dt * 3);
    this.x += (dx - this.x) * k;
    this.y += (dy - this.y) * k;
    this.z += (dz - this.z) * k;
    this.lx += (ball.x * 0.55 - this.lx) * k;
    this.ly += (3 - this.ly) * k;
    this.lz += (ball.z * 0.55 - this.lz) * k;
    this.fov += (58 - this.fov) * k;
    this.finish(dt);
  }

  /** A high side view that follows the ball (watchers). */
  spectate(dt, ball) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 2.6);
    const dx = ball.x * 0.7;
    const dz = 44 + Math.abs(ball.z) * 0.1;
    this.x += (dx - this.x) * k;
    this.y += (24 - this.y) * k;
    this.z += (dz - this.z) * k;
    this.lx += (ball.x * 0.9 - this.lx) * k;
    this.ly += (1.5 - this.ly) * k;
    this.lz += (ball.z * 0.8 - this.lz) * k;
    this.fov += (62 - this.fov) * k;
    this.finish(dt);
  }

  /** Swings round to look at a goal from the field, a beat after it was scored. `sx` is the goal's side (+1, -1). */
  celebrate(dt, sx, bp) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 2.2);
    const dx = sx * 21;
    const dz = bp[2] > 0 ? -13 : 13;
    this.x += (dx - this.x) * k;
    this.y += (6.5 - this.y) * k;
    this.z += (dz - this.z) * k;
    this.lx += (sx * (PX + 1.5) - this.lx) * k * 1.6;
    this.ly += (3 - this.ly) * k;
    this.lz += (bp[2] * 0.6 - this.lz) * k * 1.6;
    this.fov += (68 - this.fov) * k;
    this.finish(dt);
  }

  /** Applies shake (trauma squared, smooth sine offsets) on top of the camera's own place. */
  finish(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const s = this.shakeOn ? this.trauma * this.trauma : 0;
    const t = this.t * 24;
    this.px = this.x + s * 0.55 * Math.sin(t * 1.31 + 1.7);
    this.py = this.y + s * 0.4 * Math.sin(t * 1.77 + 0.3);
    this.pz = this.z + s * 0.55 * Math.sin(t * 1.13 + 4.1);
    this.tx = this.lx + s * 0.5 * Math.sin(t * 1.51 + 2.2);
    this.ty = this.ly + s * 0.35 * Math.sin(t * 1.91 + 5.0);
    this.tz = this.lz + s * 0.5 * Math.sin(t * 1.23 + 0.9);
    this.roll = s * 0.035 * Math.sin(t * 0.97 + 3.3);
  }

  /** Puts the camera exactly at a place looking at a point (store art, a hard cut). */
  place(x, y, z, lx, ly, lz, fov = 70) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
    this.lx = this.tx = lx;
    this.ly = this.ty = ly;
    this.lz = this.tz = lz;
    this.fov = fov;
    this.roll = 0;
    this.trauma = 0;
  }
}

