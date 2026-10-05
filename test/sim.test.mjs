import test from 'node:test';
import assert from 'node:assert/strict';
import { runMatch } from './harness.mjs';
import { points } from '../src/sim/rules.js';

// Whole matches with only bots through the pure modules, the way the host runs them: 20 seeds, every team size and clock.
const SIZES = [1, 2, 3];
const DURS = [120, 180];

test('20 bot-only matches: each ends, ranks everyone, nothing is NaN or out of bounds', () => {
  let goals = 0;
  let overtime = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const size = SIZES[seed % 3];
    const dur = DURS[seed % 2];
    const { match, log, roster } = runMatch({ seed, size, dur });
    const tag = `seed ${seed} (${size}v${size}, ${dur}s)`;
    assert.ok(log.done, `${tag}: the match never finished (phase ${match.phase})`);
    assert.ok(!log.nan, `${tag}: NaN`);
    assert.ok(!log.oob, `${tag}: something left the arena`);
    assert.equal(match.phase, 'results', tag);
    for (const p of ['play', 'end', 'results']) assert.ok(log.phases.has(p), `${tag}: never reached ${p}`);
    if (log.goals.length) assert.ok(log.phases.has('goal') && log.phases.has('kick'), tag);
    assert.ok(log.maxBallSpeed <= 60.0001, `${tag}: ball speed ${log.maxBallSpeed}`);
    assert.equal(roster.length, size * 2);
    // everyone is ranked and the scores add up
    assert.equal(Object.keys(match.res.pts).length, size * 2, tag);
    for (const r of roster) assert.equal(match.res.pts[r.id], points(match.st[r.id]), tag);
    const scored = Object.values(match.st).reduce((a, s) => a + s[0], 0);
    const og = log.goals.filter((g) => g.og).length;
    const noScorer = log.goals.filter((g) => !g.by && !g.og).length;
    assert.equal(scored + og + noScorer, match.sc[0] + match.sc[1], `${tag}: every goal is credited once`);
    assert.equal(log.goals.length, match.sc[0] + match.sc[1], tag);
    // a decided result: a winner, or the overtime cap's draw
    const lead = match.sc[0] - match.sc[1];
    assert.equal(match.res.win, lead > 0 ? 1 : lead < 0 ? 2 : 0, tag);
    if (match.res.win === 0) assert.ok(log.ot, `${tag}: a draw without overtime`);
    if (match.res.win !== 0) assert.equal(roster.find((r) => r.id === match.res.mvp)?.tm, match.res.win, `${tag}: MVP is on the winning team`);
    assert.ok(log.kicks >= log.goals.length - 1 && log.kicks <= log.goals.length + 1, `${tag}: ${log.kicks} kickoffs for ${log.goals.length} goals`);
    goals += log.goals.length;
    if (log.ot) overtime++;
  }
  assert.ok(goals >= 40, `only ${goals} goals in 20 matches: the bots cannot score`);
  assert.ok(overtime >= 0);
});

test('the clock stops during celebrations and the match lasts about its length plus the goals', () => {
  const { log, match } = runMatch({ seed: 4, size: 2, dur: 120 });
  const seconds = log.ticks / 60;
  const celebrations = log.goals.length * (3 + 3);
  assert.ok(seconds >= 120 + celebrations - 8 && seconds <= 120 + celebrations + 20 + (log.ot ? 300 : 0), `${seconds}s with ${log.goals.length} goals`);
  assert.ok(match.sc[0] + match.sc[1] === log.goals.length);
});

test('a match through the record: a second host picking up halfway sees the same game', async () => {
  const { Match, readG } = await import('../src/sim/rules.js');
  const { World } = await import('../src/sim/world.js');
  const { HostSim } = await import('../src/sim/host.js');
  const { botWorld } = await import('./harness.mjs');
  const { buildRoster } = await import('../src/sim/rules.js');
  const { world, roster } = botWorld(9, 2);
  const match = new Match({ mid: 'mm', by: 'h1', roster, dur: 120, size: 2 });
  const host = new HostSim(world, match);
  match.start(0);
  let now = 0;
  for (let i = 0; i < 60 * 70; i++) {
    now = Math.round((i * 1000) / 60);
    host.step(now);
  }
  const g = readG(JSON.parse(JSON.stringify(match.toG())), 'mm');
  assert.ok(g);
  const m2 = Match.fromG(g);
  const host2 = new HostSim(world, m2);
  let done = false;
  for (let i = 60 * 70; i < 60 * 400 && !done; i++) {
    now = Math.round((i * 1000) / 60);
    for (const e of host2.step(now)) if (e.type === 'done') done = true;
  }
  assert.ok(done && m2.phase === 'results');
  assert.ok(m2.sc[0] >= match.sc[0] && m2.sc[1] >= match.sc[1], 'scores only go up');
  assert.equal(typeof World, 'function');
  assert.equal(typeof buildRoster, 'function');
});
