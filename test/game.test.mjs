// Whole pages of the game, run in node against a fake room server and fake screen: the title, the lobby, a match with
// bots, a second player, a host that leaves, a reload. This is where the network and match glue is checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub, makePage, run } from './fakes.mjs';
import { finiteWorld, inBounds } from './harness.mjs';
import { readG } from '../src/sim/rules.js';

const g = (hub) => readG(hub.state.g, hub.match.id);

test('a lone player: the title plays itself, Play opens the lobby, the car drives, a match with bots runs to the results and back', async () => {
  const hub = new Hub();
  const page = await makePage(hub, 'ann', { team: 1 });
  const { game, room, rec } = page;
  run(hub, 3000);
  assert.equal(game.mode, 'title');
  assert.equal(game.world.cars.length, 6, 'six bots play behind the title');
  assert.ok(game.world.cars.every((c) => c.kind === 'bot'));
  assert.ok(game.view.renders > 100, 'the title is drawn every frame');
  assert.ok(Math.hypot(game.world.cars[0].vx, game.world.cars[0].vz) > 1 || game.world.time > 1);
  assert.ok(page.game.ui.calls.length >= 0);

  game.play();
  run(hub, 800);
  assert.equal(game.mode, 'play');
  assert.equal(game.kind, 'lobby');
  assert.equal(game.world.cars.length, 1, 'only you in the lobby');
  assert.equal(game.myCar.kind, 'local');
  assert.ok(game.host, 'a lone player is the host');
  const car = game.myCar;
  const x0 = car.x;
  game.input.thr = 1;
  run(hub, 1200);
  assert.ok(Math.abs(car.x - x0) > 6, `the car drove from ${x0} to ${car.x}`);
  assert.ok(room.me.presence && Math.abs(room.me.presence.x - car.x) < 4, 'presence follows the car');
  assert.ok(hub.state.s && hub.state.s.rid === 'L', 'the host publishes the free-play ball');
  assert.equal(page.rec.controls.stick, 'analog', 'touch controls are asked for while you can drive');

  // a match: ann alone, 2v2 for two minutes
  game.input.thr = 0;
  hub.startMatch(['ann'], 3000);
  run(hub, 200);
  assert.equal(game.kind, 'starting');
  assert.equal(game.world.cars.length, 4);
  assert.equal(game.world.cars.filter((c) => c.bot).length, 3);
  assert.equal(game.world.frozen, true);
  const gs = g(hub);
  assert.ok(gs && gs.phase === 'pre' && gs.by === 'ann' && gs.roster.length === 4, 'the host wrote the record at the countdown');
  assert.ok(game.ui.count === '3' || game.ui.count === '2', `the countdown shows ${game.ui.count}`);

  run(hub, 3200);
  assert.equal(game.kind, 'playing');
  assert.equal(g(hub).phase, 'play');
  assert.equal(game.world.frozen, false);
  const phases = new Set();
  let goals = 0;
  let sawKick = false;
  for (let i = 0; i < 400 && hub.match.phase === 'playing'; i++) {
    run(hub, 500);
    const cur = g(hub);
    if (cur) {
      phases.add(cur.phase);
      goals = cur.gn;
      if (cur.phase === 'kick') sawKick = true;
    }
    assert.ok(finiteWorld(game.world) && inBounds(game.world), 'the world stays finite and inside the walls');
  }
  assert.equal(hub.match.phase, 'lobby', 'the host ended the match after the results');
  assert.equal(hub.log.endMatch, 1);
  assert.ok(phases.has('play') && phases.has('end') && phases.has('results'), [...phases].join());
  assert.ok(goals >= 1 && sawKick, `${goals} goals`);
  assert.ok(game.ui.said.some((s) => s.big === 'GOAL!' || s.big === 'OWN GOAL'), 'a goal was called out');
  assert.ok(game.ui.said.some((s) => s.big === 'FULL TIME'));
  assert.ok(game.ui.results === null || game.ui.results.rows.length === 4, 'results listed everyone');
  await new Promise((r) => setImmediate(r));
  assert.ok(rec.saves.stats && rec.saves.stats.matches === 1, 'stats saved once');

  run(hub, 8000);
  assert.equal(game.kind, 'lobby');
  assert.equal(game.world.cars.length, 1, 'bots are gone in the lobby');
  assert.equal(game.ui.results, null, 'the results card goes away after a few seconds');
});

test('a second player joins: both see each other, the guest follows the host\'s bots and ball, and touches count', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 2 };
  const a = await makePage(hub, 'ann', { team: 1 });
  const b = await makePage(hub, 'bob', { team: 2 });
  a.game.play();
  b.game.play();
  run(hub, 1500);
  assert.equal(a.game.world.cars.length, 2);
  assert.equal(b.game.world.cars.length, 2);
  assert.ok(a.game.host && !b.game.host, 'only the first player hosts');
  assert.ok(a.game.world.byId.get('bob').visible && b.game.world.byId.get('ann').visible, 'presence reaches the other page');
  hub.startMatch(['ann', 'bob'], 3000);
  run(hub, 3600);
  assert.equal(a.game.kind, 'playing');
  assert.equal(b.game.kind, 'playing');
  const roster = g(hub).roster;
  assert.equal(roster.length, 4);
  assert.equal(roster.filter((r) => r.b).length, 2);
  // bob sees the bots as followers of the host's snapshots
  assert.ok(b.game.botCars.length === 2 && b.game.botCars.every((c) => c.kind === 'remote'));
  assert.ok(a.game.botCars.every((c) => c.kind === 'bot'));
  run(hub, 4000);
  assert.ok(b.game.snaps.length >= 2, 'the guest receives snapshots');
  for (let i = 0; i < 6; i++) {
    run(hub, 1000);
    const wa = a.game.world;
    const wb = b.game.world;
    for (const c of wa.cars.filter((x) => x.bot)) {
      const d = wb.byId.get(c.id);
      assert.ok(Math.hypot(c.x - d.x, c.z - d.z) < 16, `bot ${c.id} drifted apart: ${c.x},${c.z} vs ${d.x},${d.z}`);
    }
    assert.ok(Math.hypot(wa.ball.x - wb.ball.x, wa.ball.z - wb.ball.z) < 22, 'the two balls roughly agree');
  }
  // bob drives at the ball and touches it: the host's ball takes his hit
  const wb = b.game.world;
  const wa = a.game.world;
  const bobCar = b.game.myCar;
  const hits = [];
  const origSend = b.room.send.bind(b.room);
  b.room.send = (d, o) => {
    if (d.t === 'hit') hits.push(d);
    origSend(d, o);
  };
  for (let i = 0; i < 40 && hits.length === 0; i++) {
    const ball = wb.ball;
    const dx = ball.x - bobCar.x;
    const dz = ball.z - bobCar.z;
    const want = Math.atan2(dz, dx);
    let diff = want - bobCar.h;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    b.game.input.thr = 1;
    b.game.input.steer = Math.max(-1, Math.min(1, diff * 3));
    b.game.input.boost = Math.hypot(dx, dz) > 15;
    run(hub, 250);
  }
  assert.ok(hits.length >= 1, 'bob touched the ball and told the host');
  assert.equal(hits[0].rid, b.game.rid);
  const st = g(hub).st;
  run(hub, 500);
  assert.ok(g(hub).st.bob[3] >= 0);
  assert.ok(a.game.match.st.bob[3] >= 1, 'the host counted his touch');
});

test('the host leaves mid-match: the guest takes over the ball, the bots and the rules, and the match still ends', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 2 };
  const a = await makePage(hub, 'ann', { team: 1 });
  const b = await makePage(hub, 'bob', { team: 2 });
  a.game.play();
  b.game.play();
  run(hub, 500);
  hub.startMatch(['ann', 'bob'], 2000);
  run(hub, 12000);
  assert.equal(g(hub).by, 'ann');
  const before = g(hub);
  hub.leave('ann');
  run(hub, 1500);
  assert.ok(b.game.host && b.game.isAuth(), 'bob is the host now');
  assert.equal(g(hub).by, 'bob', 'he took the record over');
  assert.deepEqual(b.game.botCars.map((c) => c.kind), ['bot', 'bot']);
  assert.ok(g(hub).sc[0] + g(hub).sc[1] >= before.sc[0] + before.sc[1], 'the score survived');
  for (let i = 0; i < 400 && hub.match.phase === 'playing'; i++) run(hub, 500);
  assert.equal(hub.match.phase, 'lobby', 'the new host finished the match');
  assert.ok(finiteWorld(b.game.world));
});

test('a page that loads mid-match watches until the next one, and a reloaded player carries on', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 1 };
  const a = await makePage(hub, 'ann', { team: 1 });
  a.game.play();
  run(hub, 500);
  hub.startMatch(['ann'], 2000);
  run(hub, 9000);
  const late = await makePage(hub, 'cat', { team: 2 });
  run(hub, 500);
  assert.equal(late.game.mode, 'title');
  late.game.play();
  run(hub, 1500);
  assert.equal(late.game.spectating, true);
  assert.equal(late.game.myCar, null);
  assert.ok(late.game.ui.spectating, 'the interface says watching');
  assert.equal(late.rec.controls, null, 'no touch controls for a watcher');
  assert.equal(late.game.world.cars.length, 2);
  assert.ok(late.game.view.rig.y > 10, 'watchers get the high view');
  // ann reloads: a new page for the same player, with the presence the room kept
  const keep = hub.players.get('ann').presence;
  assert.ok(keep);
  hub.rooms.delete('ann');
  const again = await makePage(hub, 'ann', { team: 1 });
  hub.players.get('ann').presence = keep;
  again.game.play();
  run(hub, 800);
  assert.equal(again.game.kind, 'playing');
  assert.ok(again.game.myCar && Math.hypot(again.game.myCar.x - keep.x, again.game.myCar.z - keep.z) < 12, 'carried on from where it was');
  assert.equal(again.game.ui.results, null);
});

test('a closed room offers one button, and the lobby settings are the host\'s to change', async () => {
  const hub = new Hub();
  const a = await makePage(hub, 'ann', { team: 1 });
  a.game.play();
  run(hub, 500);
  assert.ok(a.game.ui.settings.host, 'the host gets the tap targets');
  assert.deepEqual(a.game.ui.settings.list.map((s) => s.id), ['time', 'size']);
  a.game.ui.handlers.onSetting('size', 1);
  assert.equal(hub.settings.size, 1);
  a.room.emit('close', 'kicked');
  assert.equal(a.game.ui.closed.text, 'YOU WERE REMOVED');
  assert.equal(a.game.ui.closed.button, 'PLAY');
  a.room.emit('close', 'left');
});

test('three players and a bot: every page agrees on the record, and the match ends the same way for all of them', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 2 };
  const pages = [await makePage(hub, 'ann', { team: 1 }), await makePage(hub, 'bob', { team: 1 }), await makePage(hub, 'cat', { team: 2 })];
  for (const p of pages) p.game.play();
  run(hub, 800);
  hub.startMatch(['ann', 'bob', 'cat'], 3000);
  run(hub, 300);
  const roster = g(hub).roster;
  assert.deepEqual(roster.map((r) => `${r.tm}${r.b ? 'b' : 'h'}`), ['1h', '1h', '2h', '2b']);
  for (const p of pages) assert.equal(p.game.world.cars.length, 4);
  const sawResults = new Map();
  for (let i = 0; i < 600 && hub.match.phase !== 'lobby'; i++) {
    run(hub, 500);
    if (hub.match.phase === 'playing') {
      const rec = g(hub);
      for (const p of pages) {
        assert.equal(p.game.g?.sc.join(), rec.sc.join(), 'every page reads the same score');
        if (p.game.ui.results) sawResults.set(p.id, p.game.ui.results);
      }
    }
  }
  assert.equal(hub.match.phase, 'lobby');
  assert.equal(sawResults.size, 3, 'every page showed the results');
  for (const m of sawResults.values()) {
    assert.equal(m.rows.length, 4);
    assert.equal(m.rows.filter((r) => r.mvp).length, 1, 'one MVP');
    assert.ok(m.rows[0].pts >= m.rows[3].pts, 'sorted by points');
    assert.deepEqual(m.score, [...m.score]);
  }
  const shown = [...sawResults.values()].map((m) => `${m.head}|${m.score.join('-')}|${m.rows.map((r) => r.id).join()}`);
  assert.equal(new Set(shown).size, 1, 'the same results on every page');
  await new Promise((r) => setImmediate(r));
  for (const p of pages) {
    assert.ok(p.rec.saves.stats && p.rec.saves.stats.matches === 1, `${p.id} saved its stats`);
    assert.ok(p.game.ui.said.some((s) => s.big === 'FULL TIME'));
  }
  run(hub, 7000);
  for (const p of pages) assert.equal(p.game.world.cars.length, 3, 'only the three humans are in the lobby again');
});

test('a paused match stands still, and goes on where it was', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 1 };
  const a = await makePage(hub, 'ann', { team: 1 });
  a.game.play();
  run(hub, 500);
  hub.startMatch(['ann'], 2000);
  run(hub, 6500);
  assert.equal(g(hub).phase === 'play' || g(hub).phase === 'goal' || g(hub).phase === 'kick', true);
  const left = () => (g(hub).phase === 'play' ? g(hub).endsAt - a.room.matchNow() : g(hub).left);
  const before = left();
  const ball = { x: a.game.world.ball.x, z: a.game.world.ball.z };
  hub.pause(true);
  run(hub, 4000);
  assert.ok(Math.abs(left() - before) < 200, `the clock held: ${before} -> ${left()}`);
  assert.ok(a.game.world.frozen, 'the world is frozen while the match waits');
  assert.ok(Math.hypot(a.game.world.ball.x - ball.x, a.game.world.ball.z - ball.z) < 3, 'the ball stood still');
  hub.pause(false);
  run(hub, 2000);
  assert.ok(left() < before - 1000 || g(hub).phase !== 'play', 'play went on');
});

test('the host loses its connection and gets it back: it carries on from the record', async () => {
  const hub = new Hub();
  hub.settings = { time: 120, size: 1 };
  const a = await makePage(hub, 'ann', { team: 1 });
  const b = await makePage(hub, 'bob', { team: 2 });
  a.game.play();
  b.game.play();
  run(hub, 500);
  hub.startMatch(['ann', 'bob'], 2000);
  run(hub, 9000);
  a.room.connected = false;
  run(hub, 1000);
  assert.equal(a.game.host, null, 'a page that is offline stops acting as the host');
  a.room.connected = true;
  run(hub, 1500);
  assert.ok(a.game.host && g(hub).by === 'ann', 'back as the host, same record');
  for (let i = 0; i < 900 && hub.match.phase !== 'lobby'; i++) run(hub, 500);
  assert.equal(hub.match.phase, 'lobby');
});

test('opened on its own (no platform): the stub room lets the title, the lobby and driving work without throwing', async () => {
  const { makeStub } = await import('../src/net/stub.js');
  const { Game } = await import('../src/game.js');
  const { DEPS, clock } = await import('./fakes.mjs');
  const { ow, room } = makeStub();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const game = new Game({ ow, room, canvas: {}, root: {}, deps: { ...DEPS } });
    const frames = (n) => {
      for (let i = 0; i < n; i++) {
        clock.vt += 1000 / 60;
        const cbs = clock.callbacks;
        clock.callbacks = [];
        for (const cb of cbs) cb(clock.vt);
      }
    };
    frames(120);
    assert.equal(game.mode, 'title');
    game.play();
    frames(60);
    game.input.thr = 1;
    game.input.boost = true;
    let fastest = 0;
    for (let i = 0; i < 18; i++) {
      frames(10);
      fastest = Math.max(fastest, Math.hypot(game.myCar.vx, game.myCar.vz));
    }
    assert.equal(game.kind, 'lobby');
    assert.ok(fastest > 25, `the boosted car reached ${fastest}`);
    assert.ok(game.world.ball.x !== 0 || game.world.ball.z !== 0, 'the car hit the ball');
    assert.equal(game.world.cars.length, 1);
    game.input.jump = true;
    frames(30);
    assert.ok(game.view.renders > 300);
  } finally {
    console.error = orig;
  }
  assert.deepEqual(errors, []);
});
