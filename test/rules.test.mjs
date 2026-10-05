import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, buildRoster, readG, points } from '../src/sim/rules.js';
import { KICKOFF_MS, GOAL_MS, END_MS, RESULTS_MS, OT_CAP_MS } from '../src/sim/consts.js';

const humans = (...specs) => specs.map(([id, team]) => ({ id, team }));

test('roster: humans keep their team, bots fill both sides to the size', () => {
  const { roster, size } = buildRoster(humans(['a', 1]), 3, 7);
  assert.equal(size, 3);
  assert.equal(roster.length, 6);
  assert.deepEqual(roster.filter((r) => r.tm === 1).map((r) => r.id), ['a', 'bot1', 'bot2']);
  assert.equal(roster.filter((r) => r.tm === 2 && r.b).length, 3);
  assert.ok(roster.filter((r) => r.b).every((r) => r.nm.length > 0));
  assert.equal(new Set(roster.map((r) => r.nm || r.id)).size, 6, 'no two bots share a name');
  assert.deepEqual(roster.filter((r) => r.tm === 1).map((r) => r.sl), [0, 1, 2]);
});

test('roster: more humans than the chosen size widen the teams; a team with extra humans gets matching bots on the other', () => {
  const { roster, size } = buildRoster(humans(['a', 1], ['b', 1], ['c', 1], ['d', 2]), 1, 3);
  assert.equal(size, 3);
  assert.equal(roster.filter((r) => r.tm === 1).length, 3);
  assert.equal(roster.filter((r) => r.tm === 2).length, 3);
  assert.deepEqual(roster.filter((r) => r.tm === 2).map((r) => r.b), [0, 1, 1]);
});

test('roster: a player with no team goes to the smaller side; eight humans fit four a side; nobody gets two seats', () => {
  const r1 = buildRoster(humans(['a', 1], ['b', 0]), 2, 1).roster;
  assert.equal(r1.find((r) => r.id === 'b').tm, 2);
  const eight = buildRoster(humans(...Array.from({ length: 8 }, (_, i) => [`p${i}`, 1 + (i % 2)])), 1, 1);
  assert.equal(eight.size, 4);
  assert.equal(eight.roster.length, 8);
  assert.ok(eight.roster.every((r) => !r.b));
  const lopsided = buildRoster(humans(...Array.from({ length: 6 }, (_, i) => [`p${i}`, 1])), 1, 1);
  assert.ok(lopsided.roster.filter((r) => r.tm === 1).length <= 4);
  assert.equal(new Set(lopsided.roster.map((r) => r.id)).size, lopsided.roster.length);
});

function fresh(dur = 120, h = humans(['a', 1], ['b', 2])) {
  const { roster, size } = buildRoster(h, 2, 3);
  const m = new Match({ mid: 'm1', by: 'a', roster, dur, size });
  m.start(0);
  return m;
}

test('a match starts in play with the clock running', () => {
  const m = fresh(120);
  assert.equal(m.phase, 'play');
  assert.equal(m.rid, 'm1.1');
  assert.equal(m.clockLeft(30000), 90000);
  assert.deepEqual(m.sc, [0, 0]);
});

test('a goal scores for the team, credits the last toucher and the assist, stops the clock and starts the celebration', () => {
  const m = fresh();
  m.touch('bot1', 1, 9000, false, null);
  m.touch('a', 1, 10000, false, null);
  m.touch('bot1', 1, 11000, true, null);
  const last = m.goal(1, 12000, [41, 2, 0]);
  assert.deepEqual(m.sc, [1, 0]);
  assert.equal(last.by, 'bot1');
  assert.equal(last.as, 'a');
  assert.equal(last.air, 1);
  assert.equal(last.og, 0);
  assert.equal(m.phase, 'goal');
  assert.equal(m.clockLeft(99999), 120000 - 12000, 'the clock waits');
  assert.equal(m.st.bot1[0], 1);
  assert.equal(m.st.a[1], 1);
  assert.equal(m.goal(1, 12010, [41, 2, 0]), null, 'only once per play');
  assert.deepEqual(m.sc, [1, 0]);
});

test('an assist must be within 4 s; a defender who touches last scores an own goal for the other team', () => {
  const m = fresh();
  m.touch('a', 1, 1000, false, null);
  m.touch('bot1', 1, 9000, false, null);
  assert.equal(m.goal(1, 9500, [41, 2, 0]).as, null);
  const m2 = fresh();
  m2.touch('b', 2, 5000, false, null);
  const og = m2.goal(1, 5400, [41, 2, 0]);
  assert.equal(og.og, 1);
  assert.equal(og.by, null);
  assert.deepEqual(m2.sc, [1, 0]);
  const m3 = fresh();
  assert.equal(m3.goal(2, 1000, [-41, 2, 0]).by, null, 'a ball nobody touched');
});

test('after the celebration comes a 3-2-1 kickoff with a new round id, then play with the clock resumed', () => {
  const m = fresh();
  m.goal(1, 20000, [41, 2, 0]);
  assert.deepEqual([...m.tick(20000 + GOAL_MS - 1)], []);
  assert.deepEqual([...m.tick(20000 + GOAL_MS)], ['kick']);
  assert.equal(m.phase, 'kick');
  assert.equal(m.rid, 'm1.2');
  const t0 = 20000 + GOAL_MS;
  assert.deepEqual([...m.tick(t0 + KICKOFF_MS - 1)], []);
  assert.deepEqual([...m.tick(t0 + KICKOFF_MS)], ['play']);
  assert.equal(m.phase, 'play');
  assert.equal(m.clockLeft(t0 + KICKOFF_MS), 100000, '20 s were played, the clock waited through the celebration');
});

test('time up with a leader ends the match; tied goes to golden-goal overtime', () => {
  const m = fresh(60);
  m.goal(2, 10000, [-41, 2, 0]);
  m.tick(13000);
  m.tick(16000);
  assert.equal(m.phase, 'play');
  const out = [...m.tick(16000 + 50000 + 1)];
  assert.deepEqual(out, ['end']);
  assert.equal(m.res.win, 2);

  const t = fresh(60);
  assert.deepEqual([...t.tick(60000)], ['kick', 'ot']);
  assert.equal(t.ot, 1);
  assert.equal(t.phase, 'kick');
  t.tick(63000);
  assert.equal(t.phase, 'play');
  assert.equal(t.clockLeft(65000), 0);
  assert.deepEqual([...t.tick(100000)], [], 'overtime has no clock');
  t.goal(1, 100000, [41, 2, 0]);
  assert.deepEqual([...t.tick(100000 + GOAL_MS)], ['end'], 'golden goal ends it');
  assert.equal(t.res.win, 1);
});

test('a goal scored as the clock runs out is decided after the celebration', () => {
  const m = fresh(60);
  m.goal(1, 59990, [41, 2, 0]);
  assert.equal(m.left, 10);
  m.tick(59990 + GOAL_MS);
  m.tick(59990 + GOAL_MS + KICKOFF_MS);
  assert.equal(m.phase, 'play');
  assert.deepEqual([...m.tick(59990 + GOAL_MS + KICKOFF_MS + 10)], ['end']);
  assert.equal(m.res.win, 1);
  const tie = fresh(60);
  tie.goal(1, 30000, [41, 2, 0]);
  tie.goal;
  tie.tick(33000);
  tie.tick(36000);
  tie.goal(2, 59999, [-41, 2, 0]);
  const ev = [...tie.tick(59999 + GOAL_MS)];
  assert.ok(ev.includes('ot') || ev.includes('kick') || ev.includes('end'));
});

test('overtime that nobody breaks ends as a draw', () => {
  const m = fresh(60);
  m.tick(60000);
  m.tick(63000);
  const out = [...m.tick(63000 + OT_CAP_MS + 1)];
  assert.deepEqual(out, ['end']);
  assert.equal(m.res.win, 0);
});

test('end, then results, then done once', () => {
  const m = fresh(60);
  m.goal(1, 1000, [41, 2, 0]);
  m.tick(4000);
  m.tick(7000); // play again with 59 s left
  m.tick(66000);
  assert.equal(m.phase, 'end');
  assert.deepEqual([...m.tick(66000 + END_MS)], ['results']);
  assert.deepEqual([...m.tick(66000 + END_MS + RESULTS_MS - 1)], []);
  assert.deepEqual([...m.tick(66000 + END_MS + RESULTS_MS)], ['done']);
  assert.deepEqual([...m.tick(66000 + END_MS + RESULTS_MS + 10)], [], 'done is said once');
});

test('MVP is the best of the winning team: goals 100, assists 50, saves 50, touches 5', () => {
  assert.equal(points([2, 1, 3, 10]), 200 + 50 + 150 + 50);
  const m = fresh(60);
  m.touch('a', 1, 100, false, null);
  m.touch('a', 1, 200, false, null);
  m.touch('b', 2, 300, false, null);
  for (let i = 0; i < 40; i++) m.touch('b', 2, 400 + i, false, null);
  m.touch('bot1', 1, 500, false, null);
  m.goal(1, 600, [41, 2, 0]);
  m.tick(3600);
  m.tick(6600);
  m.tick(66000);
  assert.equal(m.res.win, 1);
  assert.equal(m.res.mvp, 'bot1', 'goal beats touches; b is on the losing team');
  assert.equal(m.res.pts.b, 41 * 5);
});

test('a save: touching a ball that was heading into your goal within 1.5 s; not twice in 2 s; not a ball going away', () => {
  const m = fresh();
  assert.equal(m.touch('a', 1, 1000, false, { x: -30, z: 1, vx: -12, vz: 0 }), true, 'blue defends -x');
  assert.equal(m.touch('a', 1, 1500, false, { x: -30, z: 1, vx: -12, vz: 0 }), false);
  assert.equal(m.touch('a', 1, 4000, false, { x: -30, z: 1, vx: 12, vz: 0 }), false, 'going away');
  assert.equal(m.touch('a', 1, 6000, false, { x: -10, z: 1, vx: -12, vz: 0 }), false, 'too far to matter');
  assert.equal(m.touch('a', 1, 8000, false, { x: -30, z: 20, vx: -12, vz: 0 }), false, 'wide of the goal');
  assert.equal(m.touch('b', 2, 9000, false, { x: 30, z: 0, vx: 14, vz: 0 }), true, 'orange defends +x');
  assert.equal(m.st.a[2], 1);
  assert.equal(m.touch('nobody', 1, 9000, false, null), false, 'unknown ids are ignored');
});

test('the record survives a round trip and a new host carries on from it', () => {
  const m = fresh(90);
  m.touch('a', 1, 100, false, null);
  m.goal(1, 5000, [41, 2.5, 1]);
  m.tick(8000);
  const g = JSON.parse(JSON.stringify(m.toG()));
  const clean = readG(g, 'm1');
  assert.ok(clean);
  const m2 = Match.fromG(clean);
  m2.by = 'b';
  assert.equal(m2.phase, 'kick');
  assert.deepEqual(m2.sc, [1, 0]);
  assert.equal(m2.rid, 'm1.2');
  assert.deepEqual([...m2.tick(11000)], ['play']);
  assert.equal(m2.clockLeft(11000), 90000 - 5000);
  assert.equal(m2.st.a[0], 1);
});

test('readG refuses another match, bad shapes and junk, and clamps what it keeps', () => {
  const m = fresh();
  const g = m.toG();
  assert.equal(readG(g, 'other'), null);
  assert.equal(readG(null, 'm1'), null);
  assert.equal(readG({ ...g, phase: 'bogus' }, 'm1'), null);
  assert.equal(readG({ ...g, roster: [] }, 'm1'), null);
  assert.equal(readG({ ...g, roster: [{ id: 'x', tm: 3 }] }, 'm1'), null);
  assert.equal(readG({ ...g, roster: [...g.roster, g.roster[0]] }, 'm1'), null, 'duplicate ids');
  const odd = readG({ ...g, sc: [1e9, 'x'], until: 'soon', endsAt: NaN, last: { tm: 9, by: 'ghost', bp: ['a'] }, res: { win: 7, mvp: 'ghost', pts: { a: -5 } }, st: { a: [1e9, null] } }, 'm1');
  assert.deepEqual(odd.sc, [99, 0]);
  assert.equal(odd.until, 0);
  assert.equal(odd.endsAt, 0);
  assert.equal(odd.last.by, null);
  assert.equal(odd.res.win, 0);
  assert.equal(odd.res.pts.a, 0);
  assert.equal(odd.st.a[0], 9999);
  assert.equal(odd.st.a[1], 0);
});
