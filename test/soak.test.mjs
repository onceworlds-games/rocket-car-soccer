// A long run of whole pages: three matches in a row in one server with players pressing random things, someone leaving
// in the middle and a latecomer arriving. Nothing may throw in a frame, nothing may go NaN, every match must end, and the
// third match must behave like the first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub, makePage, run } from './fakes.mjs';
import { finiteWorld, inBounds } from './harness.mjs';
import { mulberry32 } from '../src/sim/rng.js';

test('three matches in a row with random drivers, a leaver and a latecomer', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    const hub = new Hub();
    const rng = mulberry32(99);
    const pages = [await makePage(hub, 'ann', { team: 1 }), await makePage(hub, 'bob', { team: 2 }), await makePage(hub, 'cat', { team: 1 })];
    for (const p of pages) p.game.play();
    run(hub, 1000);
    const drive = () => {
      for (const p of pages) {
        if (!hub.players.has(p.id)) continue;
        const inp = p.game.input;
        if (rng() < 0.08) {
          inp.thr = Math.round(rng() * 2 - 1) || 1;
          inp.steer = rng() < 0.3 ? 0 : rng() * 2 - 1;
          inp.boost = rng() < 0.5;
        }
        if (rng() < 0.03) inp.jump = true;
        if (rng() < 0.005) inp.cam = true;
        if (rng() < 0.002) inp.reset = true;
      }
    };
    for (let m = 1; m <= 3; m++) {
      hub.settings = { time: 120, size: m === 2 ? 1 : 2 };
      const ids = [...hub.players.keys()];
      hub.startMatch(ids, 3000);
      let seconds = 0;
      let late = null;
      while (hub.match.phase !== 'lobby' && seconds < 700) {
        for (let k = 0; k < 4; k++) {
          drive();
          run(hub, 125);
        }
        seconds++;
        if (m === 1 && seconds === 30) hub.leave('cat'); // cat drops out mid-match
        if (m === 2 && seconds === 20 && !late) {
          late = await makePage(hub, 'dan', { team: 2 });
          late.game.play();
          pages.push(late);
        }
        for (const p of pages) {
          if (!hub.players.has(p.id)) continue;
          assert.ok(finiteWorld(p.game.world), `match ${m}: NaN on ${p.id}`);
          assert.ok(inBounds(p.game.world), `match ${m}: out of bounds on ${p.id}`);
        }
      }
      assert.equal(hub.match.phase, 'lobby', `match ${m} never ended`);
      run(hub, 3000);
      const humans = hub.players.size;
      for (const p of pages) {
        if (!hub.players.has(p.id)) continue;
        assert.equal(p.game.kind, 'lobby');
        assert.equal(p.game.world.cars.length, humans, `match ${m}: the lobby holds the ${humans} humans`);
        assert.equal(p.game.host === null || p.game.host.match === null, true);
      }
      // a stale record from the match just played is never read in the lobby
      assert.ok(pages.every((p) => !hub.players.has(p.id) || p.game.currentG() === null));
    }
    assert.equal(hub.log.endMatch, 3);
    for (const p of pages) assert.equal(p.game.warned, undefined, `${p.id} threw in a frame`);
    assert.deepEqual(errors, []);
  } finally {
    console.error = origError;
  }
});
