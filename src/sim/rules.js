// The rules of a match: roster, score, clock, goals, assists, saves, overtime and the results. Pure logic with no
// clocks of its own: the host feeds it match time (`room.matchNow()` ms) and writes `toG()` to room state, and a new host
// carries on from that record with `Match.fromG`.
//
// Phases: pre (the platform's countdown) > play > goal (3 s) > kick (3-2-1) > play ... > end > results.
// The clock is a deadline in match time while it runs (`endsAt`) and a remaining time while it is stopped (`left`).

import { KICKOFF_MS, GOAL_MS, END_MS, RESULTS_MS, OT_CAP_MS, MAX_TEAM, BOT_NAMES, PX, GOAL_HW, TEAM_BLUE } from './consts.js';
import { mulberry32, clamp } from './rng.js';

export const PHASES = ['pre', 'kick', 'play', 'goal', 'end', 'results'];

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Seats everyone: humans keep the team the room gave them, bots fill both teams up to the chosen size (or to the bigger
 * team's headcount). Returns { roster, size } with roster entries { id, tm, sl, b, nm }: team, slot on the team, bot flag, bot name.
 */
export function buildRoster(humans, wantSize, seed = 1) {
  const rng = mulberry32(seed);
  const teams = [[], []];
  for (const h of humans) {
    if (!h || typeof h.id !== 'string') continue;
    let t = h.team === 1 || h.team === 2 ? h.team : 0;
    if (!t) t = teams[0].length <= teams[1].length ? 1 : 2;
    if (teams[t - 1].length >= MAX_TEAM) t = 3 - t;
    if (teams[t - 1].length >= MAX_TEAM) continue; // no seat left: they watch
    teams[t - 1].push(h.id);
  }
  const want = Number.isFinite(wantSize) ? Math.round(wantSize) : 1;
  const size = clamp(Math.max(want, teams[0].length, teams[1].length, 1), 1, MAX_TEAM);
  const names = BOT_NAMES.slice();
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const roster = [];
  let bots = 0;
  for (let t = 1; t <= 2; t++) {
    const ids = teams[t - 1];
    ids.forEach((id, i) => roster.push({ id, tm: t, sl: i, b: 0, nm: '' }));
    for (let i = ids.length; i < size; i++) {
      bots++;
      roster.push({ id: `bot${bots}`, tm: t, sl: i, b: 1, nm: names[(bots - 1) % names.length] });
    }
  }
  return { roster, size };
}

/** Points for the MVP: goals, assists, saves and touches. */
export function points(s) {
  return s[0] * 100 + s[1] * 50 + s[2] * 50 + s[3] * 5;
}

export class Match {
  constructor({ mid, by, roster, dur, size }) {
    this.mid = mid;
    this.by = by;
    this.roster = roster;
    this.dur = dur;
    this.size = size;
    this.phase = 'pre';
    this.n = 0;
    this.rid = `${mid}.0`;
    this.until = 0;
    this.endsAt = 0;
    this.left = dur * 1000;
    this.ot = 0;
    this.ots = 0;
    this.sc = [0, 0];
    this.gn = 0;
    this.st = {};
    for (const r of roster) this.st[r.id] = [0, 0, 0, 0];
    this.last = null;
    this.res = null;
    this.dirty = true; // `toG()` has something new to write
    this.hist = []; // recent touches, newest last (host only: not in the record)
    this.saveAt = {};
    this.finished = false;
    this.out = [];
  }

  static fromG(g) {
    const m = new Match({ mid: g.mid, by: g.by, roster: g.roster, dur: g.dur, size: g.size });
    m.phase = g.phase;
    m.n = g.n;
    m.rid = g.rid;
    m.until = g.until;
    m.endsAt = g.endsAt;
    m.left = g.left;
    m.ot = g.ot;
    m.ots = g.ots;
    m.sc = [g.sc[0], g.sc[1]];
    m.gn = g.gn;
    for (const id of Object.keys(g.st)) m.st[id] = g.st[id].slice();
    m.last = g.last;
    m.res = g.res;
    m.dirty = true;
    return m;
  }

  toG() {
    const st = {};
    for (const id of Object.keys(this.st)) st[id] = this.st[id].slice();
    return {
      mid: this.mid,
      by: this.by,
      rid: this.rid,
      n: this.n,
      phase: this.phase,
      until: this.until,
      endsAt: this.endsAt,
      left: this.left,
      ot: this.ot,
      ots: this.ots,
      sc: [this.sc[0], this.sc[1]],
      gn: this.gn,
      size: this.size,
      dur: this.dur,
      roster: this.roster,
      st,
      last: this.last,
      res: this.res,
    };
  }

  /** The platform's countdown is over: the first kickoff, straight into play. */
  start(now) {
    this.n = 1;
    this.rid = `${this.mid}.1`;
    this.phase = 'play';
    this.endsAt = now + this.left;
    this.dirty = true;
  }

  /** Milliseconds on the clock at match time `now` (0 in overtime). */
  clockLeft(now) {
    if (this.ot) return 0;
    if (this.phase === 'play') return Math.max(0, this.endsAt - now);
    return Math.max(0, this.left);
  }

  /** Moves the phases along. Returns a list of what happened: 'play', 'kick', 'ot', 'end', 'results', 'done'. Reused: read it at once. */
  tick(now) {
    const out = this.out;
    out.length = 0;
    if (this.phase === 'kick') {
      if (now >= this.until) {
        this.phase = 'play';
        if (!this.ot) this.endsAt = now + this.left;
        this.dirty = true;
        out.push('play');
      }
    } else if (this.phase === 'play') {
      if (!this.ot && now >= this.endsAt) {
        this.left = 0;
        if (this.sc[0] !== this.sc[1]) this.finish(now, out);
        else this.overtime(now, out);
      } else if (this.ot && now - this.ots > OT_CAP_MS) {
        this.finish(now, out);
      }
    } else if (this.phase === 'goal') {
      if (now >= this.until) {
        if (this.ot) this.finish(now, out);
        else if (this.left <= 0) {
          if (this.sc[0] !== this.sc[1]) this.finish(now, out);
          else this.overtime(now, out);
        } else this.kick(now, out);
      }
    } else if (this.phase === 'end') {
      if (now >= this.until) {
        this.phase = 'results';
        this.until = now + RESULTS_MS;
        this.dirty = true;
        out.push('results');
      }
    } else if (this.phase === 'results') {
      if (now >= this.until && !this.finished) {
        this.finished = true;
        out.push('done');
      }
    }
    return out;
  }

  kick(now, out) {
    this.n++;
    this.rid = `${this.mid}.${this.n}`;
    this.phase = 'kick';
    this.until = now + KICKOFF_MS;
    this.dirty = true;
    out.push('kick');
  }

  overtime(now, out) {
    this.ot = 1;
    this.ots = now;
    this.left = 0;
    this.kick(now, out);
    out.push('ot');
  }

  finish(now, out) {
    this.phase = 'end';
    this.until = now + END_MS;
    const win = this.sc[0] > this.sc[1] ? 1 : this.sc[1] > this.sc[0] ? 2 : 0;
    const pts = {};
    let mvp = null;
    let best = -1;
    for (const r of this.roster) {
      const p = points(this.st[r.id]);
      pts[r.id] = p;
      if ((win === 0 || r.tm === win) && p > best) {
        best = p;
        mvp = r.id;
      }
    }
    this.res = { win, mvp, pts };
    this.dirty = true;
    out.push('end');
  }

  /**
   * The ball is in a net: team `team` (1 blue, 2 orange) scored. `bp` is where the ball is. Credits the last toucher
   * (an own goal when it was a defender), an assist for the last teammate before them within 4 s. Only counts while playing.
   */
  goal(team, now, bp) {
    if (this.phase !== 'play') return null;
    this.sc[team - 1]++;
    this.gn++;
    let lt = this.hist.length ? this.hist[this.hist.length - 1] : null;
    let by = null;
    let as = null;
    let og = 0;
    let air = 0;
    let from = this.hist.length - 2;
    if (lt && lt.team !== team) {
      // A defender touched it last. If the ball was already heading into that goal, the shot was the attacker's and the
      // defender only got a touch to it; if the defender turned it round, it is an own goal.
      let k = this.hist.length - 2;
      while (k >= 0 && this.hist[k].team !== team) k--;
      if (lt.toward && k >= 0 && lt.at - this.hist[k].at <= 6000) {
        lt = this.hist[k];
        from = k - 1;
      } else {
        og = 1;
      }
    }
    if (lt && !og) {
      by = lt.id;
      air = lt.air;
      for (let i = from; i >= 0; i--) {
        const h = this.hist[i];
        if (lt.at - h.at > 4000) break;
        if (h.team === team && h.id !== lt.id) {
          as = h.id;
          break;
        }
      }
    }
    if (by && this.st[by]) this.st[by][0]++;
    if (as && this.st[as]) this.st[as][1]++;
    if (!this.ot) this.left = Math.max(0, this.endsAt - now);
    this.phase = 'goal';
    this.until = now + GOAL_MS;
    this.last = { tm: team, by, as, og, air, bp: [r2(bp[0]), r2(bp[1]), r2(bp[2])] };
    this.hist.length = 0;
    this.dirty = true;
    return this.last;
  }

  /**
   * A player or bot touched the ball at match time `at`. `pre` is the ball just before the touch ({x,z,vx,vz}) to spot a save:
   * the ball was heading into this player's goal and would reach it within 1.5 s. Returns true when a save is credited.
   */
  touch(id, team, at, air, pre) {
    const s = this.st[id];
    if (!s) return false;
    s[3]++;
    let saved = false;
    if (pre && at - (this.saveAt[id] ?? -1e9) > 2000) {
      const own = team === TEAM_BLUE ? -PX : PX;
      const toward = (own - pre.x) * pre.vx > 0 && Math.abs(pre.vx) > 3;
      if (toward) {
        const t = Math.abs(own - pre.x) / Math.abs(pre.vx);
        const zAt = pre.z + pre.vz * t;
        if (t < 1.5 && Math.abs(zAt) < GOAL_HW + 1.5) {
          s[2]++;
          this.saveAt[id] = at;
          saved = true;
        }
      }
    }
    const own = team === TEAM_BLUE ? -PX : PX;
    const toward = !!pre && (own - pre.x) * pre.vx > 0 && Math.abs(pre.vx) > 3;
    this.hist.push({ id, team, at, air: air ? 1 : 0, toward });
    if (this.hist.length > 8) this.hist.shift();
    return saved;
  }

  /** The team ahead, 0 for level. */
  leader() {
    return this.sc[0] > this.sc[1] ? 1 : this.sc[1] > this.sc[0] ? 2 : 0;
  }
}

// ---------------------------------------------------------------- reading someone else's record

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 80;
const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

/**
 * The game record from room state, checked and cut down to what this code knows: null unless it belongs to match `mid`
 * and has the right shape. Everything a page draws or a new host continues from goes through this.
 */
export function readG(raw, mid) {
  if (!raw || typeof raw !== 'object' || raw.mid !== mid || !PHASES.includes(raw.phase)) return null;
  if (!Array.isArray(raw.roster) || raw.roster.length < 1 || raw.roster.length > MAX_TEAM * 2) return null;
  const roster = [];
  const seen = new Set();
  for (const r of raw.roster) {
    if (!r || !isId(r.id) || seen.has(r.id) || (r.tm !== 1 && r.tm !== 2)) return null;
    seen.add(r.id);
    roster.push({
      id: r.id,
      tm: r.tm,
      sl: Math.round(num(r.sl, 0, MAX_TEAM - 1, 0)),
      b: r.b ? 1 : 0,
      nm: typeof r.nm === 'string' ? r.nm.slice(0, 24) : '',
    });
  }
  const sc = Array.isArray(raw.sc) ? [Math.round(num(raw.sc[0], 0, 99, 0)), Math.round(num(raw.sc[1], 0, 99, 0))] : [0, 0];
  const st = {};
  for (const r of roster) {
    const s = raw.st && Array.isArray(raw.st[r.id]) ? raw.st[r.id] : [];
    st[r.id] = [0, 1, 2, 3].map((i) => Math.round(num(s[i], 0, 9999, 0)));
  }
  let last = null;
  if (raw.last && typeof raw.last === 'object') {
    const bp = Array.isArray(raw.last.bp) ? raw.last.bp : [];
    last = {
      tm: raw.last.tm === 2 ? 2 : 1,
      by: isId(raw.last.by) && seen.has(raw.last.by) ? raw.last.by : null,
      as: isId(raw.last.as) && seen.has(raw.last.as) ? raw.last.as : null,
      og: raw.last.og ? 1 : 0,
      air: raw.last.air ? 1 : 0,
      bp: [num(bp[0], -60, 60, 0), num(bp[1], 0, 20, 2), num(bp[2], -40, 40, 0)],
    };
  }
  let res = null;
  if (raw.res && typeof raw.res === 'object') {
    const pts = {};
    for (const r of roster) pts[r.id] = Math.round(num(raw.res.pts && raw.res.pts[r.id], 0, 99999, 0));
    res = {
      win: raw.res.win === 1 || raw.res.win === 2 ? raw.res.win : 0,
      mvp: isId(raw.res.mvp) && seen.has(raw.res.mvp) ? raw.res.mvp : null,
      pts,
    };
  }
  const n = Math.round(num(raw.n, 0, 999, 0));
  return {
    mid,
    by: isId(raw.by) ? raw.by : null,
    rid: typeof raw.rid === 'string' && raw.rid.length <= 100 ? raw.rid : `${mid}.${n}`,
    n,
    phase: raw.phase,
    until: num(raw.until, 0, 1e9, 0),
    endsAt: num(raw.endsAt, 0, 1e9, 0),
    left: num(raw.left, 0, 1e7, 0),
    ot: raw.ot ? 1 : 0,
    ots: num(raw.ots, 0, 1e9, 0),
    sc,
    gn: Math.round(num(raw.gn, 0, 999, 0)),
    size: Math.round(num(raw.size, 1, MAX_TEAM, 1)),
    dur: num(raw.dur, 10, 3600, 180),
    roster,
    st,
    last,
    res,
  };
}
