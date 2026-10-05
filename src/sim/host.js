// What the host adds to a world: it owns the ball and the bots, decides goals and feeds the rules. Pure logic: the host
// page calls step() once per fixed step with the match clock, and reads `events` for what to write, play and show.
// The tests drive whole bot-only matches through the same class.

import { STEP } from './consts.js';
import { goalScored } from './arena.js';
import { placeBall, advanceBall, makeBall } from './ball.js';
import { hitPlausible } from '../net/protocol.js';

const LOBBY_GOAL_RESET_MS = 2200;

export class HostSim {
  /** `match` is null in the lobby (free play: goals reset the ball and score nothing). */
  constructor(world, match = null) {
    this.world = world;
    this.match = match;
    this.pre = makeBall(); // the ball as it was before the step: what a save is judged from
    this.lastHitAt = -1e9;
    this.lastTeam = 0; // team of the last touch, for the ball's glow
    this.lobbyGoalAt = -1;
    this.events = []; // { type, ... }: goal, kick, play, ot, end, results, done, save, lobbygoal
  }

  copyPre() {
    const b = this.world.ball;
    const p = this.pre;
    p.x = b.x;
    p.y = b.y;
    p.z = b.z;
    p.vx = b.vx;
    p.vy = b.vy;
    p.vz = b.vz;
  }

  /** One fixed step at clock `now` (match ms during a match, the platform clock in the lobby). */
  step(now) {
    const w = this.world;
    const m = this.match;
    const ev = this.events;
    ev.length = 0;
    const b = w.ball;
    this.copyPre();
    if (m) {
      w.frozen = m.phase === 'kick' || m.phase === 'pre';
      w.botsHold = m.phase === 'end' || m.phase === 'results';
    }
    w.step(STEP);

    // touches by the cars this host simulates: its own and the bots'
    for (let i = 0; i < w.nev; i++) {
      const e = w.ev[i];
      if (e.type !== 'hit' || !e.car) continue;
      this.lastHitAt = now;
      this.lastTeam = e.car.team;
      if (m && m.phase === 'play' && m.touch(e.car.id, e.car.team, now, !e.car.ground, this.pre)) ev.push({ type: 'save', id: e.car.id });
    }

    if (!m) {
      const t = goalScored(b.x, b.y, b.z);
      if (t && this.lobbyGoalAt < 0) {
        this.lobbyGoalAt = now;
        ev.push({ type: 'lobbygoal', team: t });
      } else if (this.lobbyGoalAt >= 0 && now - this.lobbyGoalAt > LOBBY_GOAL_RESET_MS) {
        placeBall(b);
        this.lobbyGoalAt = -1;
      }
      return ev;
    }

    if (m.phase === 'play') {
      const t = goalScored(b.x, b.y, b.z);
      if (t) {
        const last = m.goal(t, now, [b.x, b.y, b.z]);
        if (last) ev.push({ type: 'goal', last });
      }
    }
    const out = m.tick(now);
    for (let i = 0; i < out.length; i++) {
      const type = out[i];
      if (type === 'kick') {
        w.kickoff();
        w.frozen = true;
        this.lastTeam = 0;
      } else if (type === 'play') {
        w.frozen = false;
      }
      ev.push({ type });
    }
    return ev;
  }

  /**
   * A touch reported by another player's page. Takes it (the ball becomes the sender's ball, flown on to now) when it is
   * plausible. `car` is the sender's car, `presence` their last car record or null. Returns 0 when refused, 1 when taken
   * and 2 when taken and it was a save.
   */
  remoteHit(car, h, now, presence) {
    const m = this.match;
    if (m && m.phase !== 'play') return 0;
    const b = this.world.ball;
    if (!hitPlausible(h, now, b, presence, this.lastHitAt)) return 0;
    this.copyPre();
    placeBall(b, h.b[0], h.b[1], h.b[2], h.b[3], h.b[4], h.b[5]);
    advanceBall(b, Math.max(0, (now - h.at) / 1000), b);
    this.lastHitAt = h.at;
    this.lastTeam = car.team;
    return m && m.touch(car.id, car.team, h.at, h.a === 1, this.pre) ? 2 : 1;
  }
}
