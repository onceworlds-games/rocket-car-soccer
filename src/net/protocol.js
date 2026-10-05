// What goes over the wire, and how it is checked. Pure: no room, no clock of its own. Everything that comes from another
// player's page is untrusted, so every reader returns a clean copy or null and clamps what it keeps.

import { BALLP, CARP, PX, GOAL_D } from '../sim/consts.js';
import { insideArena } from '../sim/arena.js';
import { advanceBall, makeBall } from '../sim/ball.js';
import { clamp } from '../sim/rng.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

const XMAX = PX + GOAL_D + 4;
const ZMAX = 34;

/** Longest a hit may lag behind the host's clock and still count, and how far ahead of it it may claim to be (ms). */
export const HIT_LATE_MS = 400;
export const HIT_EARLY_MS = 250;

// ---------------------------------------------------------------- a player's own car, in presence

/** The compact record a page publishes for its car: about 20 times a second. */
export function encodePresence(c) {
  return {
    x: r2(c.x),
    y: r2(c.y),
    z: r2(c.z),
    h: r3(c.h),
    p: r3(c.p),
    vx: r1(c.vx),
    vy: r1(c.vy),
    vz: r1(c.vz),
    b: r2(c.boost / 100),
    bo: c.boosting ? 1 : 0,
    fl: c.dodge > 0 ? r2(c.dodge) : 0,
    fd: r2(c.dodgeA),
    gr: c.ground ? 1 : 0,
  };
}

/** Reads someone's presence into `out` (numbers only, clamped). False when it isn't a car record. */
export function readPresence(p, out) {
  if (!p || typeof p !== 'object') return false;
  const { x, y, z, h } = p;
  if (![x, y, z, h].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  const n = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  out.x = clamp(x, -XMAX, XMAX);
  out.y = clamp(y, 0, 20);
  out.z = clamp(z, -ZMAX, ZMAX);
  out.h = h;
  out.p = n(p.p, -1.6, 1.6);
  out.vx = n(p.vx, -80, 80);
  out.vy = n(p.vy, -80, 80);
  out.vz = n(p.vz, -80, 80);
  out.boost = n(p.b, 0, 1) * 100;
  out.bo = n(p.bo, 0, 1);
  out.fl = n(p.fl, 0, 1);
  out.fd = n(p.fd, -7, 7);
  out.gr = n(p.gr, 0, 1);
  return true;
}

// ---------------------------------------------------------------- the host's snapshot: the ball and the bots

/**
 * One snapshot: round id, host clock, the ball [x,y,z,vx,vy,vz], each bot [x,y,z,h,p,vx,vy,vz,boost,flags] in roster
 * order, and the team that touched the ball last (for its glow).
 */
export function encodeSnapshot(rid, t, ball, bots, lt) {
  return {
    rid,
    t: Math.round(t),
    b: [r2(ball.x), r2(ball.y), r2(ball.z), r1(ball.vx), r1(ball.vy), r1(ball.vz)],
    k: bots.map((c) => [r2(c.x), r2(c.y), r2(c.z), r3(c.h), r3(c.p), r1(c.vx), r1(c.vy), r1(c.vz), Math.round(c.boost), (c.boosting ? 1 : 0) | (c.ground ? 2 : 0) | (c.dodge > 0 ? 4 : 0)]),
    lt: lt === 1 || lt === 2 ? lt : 0,
  };
}

/** A snapshot checked and clamped, or null. `maxBots` is how many bots the roster has. */
export function readSnapshot(s, maxBots) {
  if (!s || typeof s !== 'object' || typeof s.rid !== 'string' || s.rid.length > 100) return null;
  if (typeof s.t !== 'number' || !Number.isFinite(s.t)) return null;
  const b = s.b;
  if (!Array.isArray(b) || b.length !== 6 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (!Array.isArray(s.k) || s.k.length > maxBots) return null;
  const k = [];
  for (const e of s.k) {
    if (!Array.isArray(e) || e.length !== 10 || !e.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    k.push([
      clamp(e[0], -XMAX, XMAX),
      clamp(e[1], 0, 20),
      clamp(e[2], -ZMAX, ZMAX),
      e[3],
      clamp(e[4], -1.6, 1.6),
      clamp(e[5], -80, 80),
      clamp(e[6], -80, 80),
      clamp(e[7], -80, 80),
      clamp(e[8], 0, 100),
      e[9] | 0,
    ]);
  }
  return {
    rid: s.rid,
    t: s.t,
    b: [clamp(b[0], -XMAX, XMAX), clamp(b[1], 0, 20), clamp(b[2], -ZMAX, ZMAX), clamp(b[3], -90, 90), clamp(b[4], -90, 90), clamp(b[5], -90, 90)],
    k,
    lt: s.lt === 1 || s.lt === 2 ? s.lt : 0,
  };
}

// ---------------------------------------------------------------- a touch, reported to the host

/** The message a page sends when its car touches its copy of the ball. */
export function encodeHit(rid, at, ball, car) {
  return {
    t: 'hit',
    rid,
    at: Math.round(at),
    b: [r2(ball.x), r2(ball.y), r2(ball.z), r1(ball.vx), r1(ball.vy), r1(ball.vz)],
    c: [r2(car.x), r2(car.z)],
    a: car.ground ? 0 : 1,
  };
}

export function readHit(d) {
  if (!d || typeof d !== 'object' || d.t !== 'hit' || typeof d.rid !== 'string' || d.rid.length > 100) return null;
  if (typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
  if (!Array.isArray(d.b) || d.b.length !== 6 || !d.b.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (!Array.isArray(d.c) || d.c.length !== 2 || !d.c.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { rid: d.rid, at: d.at, b: d.b.slice(), c: d.c.slice(), a: d.a ? 1 : 0 };
}

const scratch = makeBall();

/**
 * Whether the host should believe a touch: not stale or from the future, not older than the last one it took, the car
 * close to the ball and to where the sender's presence says it is, the ball no faster than it can be, inside the arena and
 * not far from where the host's own ball is. `now` is the host's clock, `ball` the host's ball, `presence` the sender's last
 * car (or null), `lastAt` the stamp of the last touch taken.
 */
export function hitPlausible(h, now, ball, presence, lastAt) {
  if (now - h.at > HIT_LATE_MS || h.at - now > HIT_EARLY_MS) return false;
  if (h.at < lastAt) return false;
  const [bx, by, bz, vx, vy, vz] = h.b;
  if (Math.hypot(h.c[0] - bx, h.c[1] - bz) > 7.5) return false;
  if (Math.hypot(vx, vy, vz) > BALLP.max + 3) return false;
  if (!insideArena(bx, by, bz, 2)) return false;
  if (presence && Math.hypot(h.c[0] - presence.x, h.c[1] - presence.z) > 16) return false;
  scratch.x = bx;
  scratch.y = by;
  scratch.z = bz;
  scratch.vx = vx;
  scratch.vy = vy;
  scratch.vz = vz;
  const ahead = advanceBall(scratch, Math.max(0, (now - h.at) / 1000), scratch);
  if (Math.hypot(ahead.x - ball.x, ahead.y - ball.y, ahead.z - ball.z) > 16) return false;
  return true;
}

/** The speed above which a car counts as supersonic (for trails). */
export const SUPERSONIC = CARP.boostMax * CARP.supersonic;
