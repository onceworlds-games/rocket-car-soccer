import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaProject, makeContact, goalScored, insideArena, kickoffSpot } from '../src/sim/arena.js';
import { PX, PZ, CEIL, GOAL_HW, GOAL_H, BALL_R, CAR_R } from '../src/sim/consts.js';
import { mulberry32 } from '../src/sim/rng.js';

const out = makeContact();

test('a ball inside the pitch is left alone', () => {
  assert.equal(arenaProject(0, BALL_R, 0, BALL_R, 0, out), false);
  assert.equal(arenaProject(30, 8, 20, BALL_R, 0, out), false);
});

test('walls, floor and ceiling push the ball back with an inward normal', () => {
  assert.equal(arenaProject(10, 0.5, 0, BALL_R, 0, out), true);
  assert.ok(Math.abs(out.y - BALL_R) < 1e-9 && out.ny === 1);
  assert.equal(arenaProject(0, 5, PZ, BALL_R, 0, out), true);
  assert.ok(Math.abs(out.z - (PZ - BALL_R)) < 1e-9 && out.nz < -0.99);
  assert.equal(arenaProject(0, CEIL + 1, 0, BALL_R, 0, out), true);
  assert.ok(Math.abs(out.y - (CEIL - BALL_R)) < 1e-9 && out.ny < -0.99);
  // the end wall away from the goal mouth
  assert.equal(arenaProject(PX, 4, 15, BALL_R, 0, out), true);
  assert.ok(Math.abs(out.x - (PX - BALL_R)) < 1e-9 && out.nx < -0.99);
});

test('the chamfered corner is a 45 degree wall, not a square corner', () => {
  assert.equal(arenaProject(PX - BALL_R, 4, PZ - BALL_R, BALL_R, 0, out), true);
  assert.ok(out.nx < -0.6 && out.nz < -0.6, 'normal points away from the corner');
  assert.ok(Math.abs(Math.abs(out.nx) - Math.abs(out.nz)) < 1e-9);
});

test('the goal mouth is open: a ball can be pushed into the net but not through the frame', () => {
  assert.equal(arenaProject(PX + 1, 2.5, 0, BALL_R, 0, out), false, 'centre of the mouth');
  assert.equal(arenaProject(PX + 3, 2.5, 0, BALL_R, 0, out), false, 'inside the net');
  assert.equal(arenaProject(PX + 3, 2.5, GOAL_HW + 0.5, BALL_R, 0, out), true, 'beside the post');
  assert.equal(arenaProject(PX + 1, 5.5, 0, BALL_R, 0, out), true, 'under the crossbar is closed');
  assert.equal(arenaProject(PX + 8, 2, 0, BALL_R, 0, out), true, 'behind the back of the net');
});

test('goalScored needs the whole ball past the line inside the frame', () => {
  assert.equal(goalScored(PX + 1, 2, 0), 0, 'only the centre is over the line');
  assert.equal(goalScored(PX + BALL_R + 0.1, 2, 0), 1, 'blue scores in the +x goal');
  assert.equal(goalScored(-PX - BALL_R - 0.1, 2, 0), 2);
  assert.equal(goalScored(PX + BALL_R + 0.1, 2, GOAL_HW + 0.1), 0);
  assert.equal(goalScored(PX + BALL_R + 0.1, GOAL_H + 0.1, 0), 0);
});

test('anything pushed anywhere ends up inside the arena', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 20000; i++) {
    const x = (rng() - 0.5) * 120;
    const y = (rng() - 0.5) * 40;
    const z = (rng() - 0.5) * 80;
    const r = i % 2 ? BALL_R : CAR_R;
    const yo = i % 2 ? 0 : 0.7;
    let px = x;
    let py = y;
    let pz = z;
    if (arenaProject(px, py, pz, r, yo, out)) {
      px = out.x;
      py = out.y;
      pz = out.z;
    }
    assert.ok(insideArena(px, py, pz, 0.01 + (yo ? 0.7 : 0)), `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) -> (${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)})`);
    assert.equal(arenaProject(px, py, pz, r, yo, out), false, 'projected point is stable');
  }
});

test('kickoff spots: one car straight ahead 20 away, the rest on diagonals, facing the ball', () => {
  const a = kickoffSpot(1, 0);
  assert.deepEqual([a.x, a.z], [-20, 0]);
  assert.ok(Math.abs(a.h) < 1e-9, 'blue faces +x');
  const o = kickoffSpot(2, 0);
  assert.deepEqual([o.x, o.z], [20, 0]);
  assert.ok(Math.abs(Math.abs(o.h) - Math.PI) < 1e-9, 'orange faces -x');
  for (let slot = 0; slot < 4; slot++) {
    for (const team of [1, 2]) {
      const s = kickoffSpot(team, slot);
      assert.ok(insideArena(s.x, 0.6, s.z, 0) && Math.abs(s.x) < PX - 5 && Math.abs(s.z) < PZ - 5);
      const fx = Math.cos(s.h);
      const fz = Math.sin(s.h);
      assert.ok(fx * -s.x + fz * -s.z > 0, 'points at the centre');
    }
  }
});
