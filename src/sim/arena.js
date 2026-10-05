// The arena as geometry: where a ball or a car may be. Pure maths, no three.js.
//
// A sphere (the ball, or a car's collision circle) may stay inside the union of two boxes: the pitch (with its 45 degree
// corners and a ceiling) and a narrow box through both goals. The nearest point of that union is where a sphere that has
// strayed outside is put back, and the direction back is the contact normal. That gives walls, corners, the floor, the
// ceiling, the goal frame and the inside of the nets without a special case for any of them.

import { PX, PZ, CEIL, GOAL_HW, GOAL_H, GOAL_D, CORNER, BALL_R, TEAM_BLUE } from './consts.js';
import { clamp } from './rng.js';

const SQ2 = Math.SQRT2;

/** Scratch result: the corrected centre (y without the offset), the inward unit normal and how deep the sphere was. */
export function makeContact() {
  return { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, depth: 0 };
}

/**
 * Puts a sphere of radius `r` back inside the arena. Its centre is (px, py + yo, pz): `yo` lets a car (whose centre is
 * 0.6 above the floor) use a bigger circle. Returns false, leaving `out` alone, when the sphere is fine.
 */
export function arenaProject(px, py, pz, r, yo, out) {
  const y = py + yo;

  // the pitch box with its chamfered corners
  let ax = clamp(px, -(PX - r), PX - r);
  let az = clamp(pz, -(PZ - r), PZ - r);
  const ay = clamp(y, r, CEIL - r);
  const over = Math.abs(ax) + Math.abs(az) - (PX + PZ - CORNER - r * SQ2);
  if (over > 0) {
    ax -= (ax < 0 ? -1 : 1) * over * 0.5;
    az -= (az < 0 ? -1 : 1) * over * 0.5;
  }

  // the goal box
  const bx = clamp(px, -(PX + GOAL_D - r), PX + GOAL_D - r);
  const bz = clamp(pz, -(GOAL_HW - r), GOAL_HW - r);
  const by = clamp(y, r, GOAL_H - r);

  const da = (ax - px) * (ax - px) + (ay - y) * (ay - y) + (az - pz) * (az - pz);
  const db = (bx - px) * (bx - px) + (by - y) * (by - y) + (bz - pz) * (bz - pz);
  if (da === 0 || db === 0) return false;

  let cx;
  let cy;
  let cz;
  let d2;
  if (da <= db) {
    cx = ax;
    cy = ay;
    cz = az;
    d2 = da;
  } else {
    cx = bx;
    cy = by;
    cz = bz;
    d2 = db;
  }
  const d = Math.sqrt(d2);
  out.x = cx;
  out.y = cy - yo;
  out.z = cz;
  if (d > 1e-9) {
    out.nx = (cx - px) / d;
    out.ny = (cy - y) / d;
    out.nz = (cz - pz) / d;
  } else {
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
  }
  out.depth = d;
  return true;
}

/** The team that scored when the ball is fully in a goal (centre past the line, inside the frame), else 0. */
export function goalScored(x, y, z) {
  if (Math.abs(x) > PX + BALL_R && Math.abs(z) < GOAL_HW && y < GOAL_H) return x > 0 ? TEAM_BLUE : 2;
  return 0;
}

/** Whether a point is inside the walls (with a margin), goals included. For tests and spawn checks. */
export function insideArena(x, y, z, margin = 0) {
  if (y < -margin || y > CEIL + margin) return false;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax <= PX + margin && az <= PZ + margin && ax + az <= PX + PZ - CORNER + margin * SQ2) return true;
  return ax <= PX + GOAL_D + margin && az <= GOAL_HW + margin && y <= GOAL_H + margin;
}

/**
 * Where a car starts a kickoff: slot 0 straight ahead of the ball 20 away, the others on diagonals facing the ball.
 * `team` 1 (blue) starts on the -x side facing +x, team 2 on the other side.
 */
const SPOTS = [
  [-20, 0],
  [-16, 10],
  [-16, -10],
  [-30, 0],
];

export function kickoffSpot(team, slot, out = { x: 0, z: 0, h: 0 }) {
  const s = SPOTS[slot % SPOTS.length];
  const sign = team === TEAM_BLUE ? 1 : -1;
  out.x = s[0] * sign || 0;
  out.z = s[1] * sign || 0; // a half turn of the pitch: the two teams start the same way round
  out.h = Math.atan2(-out.z, -out.x);
  return out;
}
