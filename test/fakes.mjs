// Stand-ins for the platform, the screen and the speakers, so whole Game pages can run in node: a Hub that plays the part
// of a room server (state, presence, messages, host, the match cycle), and fake view, interface, sound and input classes
// that record what they were asked to do.

import { CameraRig } from '../src/render/rig.js';

/** A virtual clock: the Game reads performance.now() and requestAnimationFrame, which this takes over. */
export const clock = {
  vt: 5000,
  callbacks: [],
};
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.vt }, configurable: true });
globalThis.requestAnimationFrame = (cb) => {
  clock.callbacks.push(cb);
  return clock.callbacks.length;
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 };

const noop = () => {};
function recorder(extra = {}) {
  const calls = [];
  const proxy = new Proxy(
    { calls, ...extra },
    {
      get(t, p) {
        if (p in t) return t[p];
        if (typeof p === 'symbol') return undefined;
        return (...args) => {
          calls.push([p, ...args]);
        };
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    },
  );
  return proxy;
}

export class FakeSound {
  constructor() {
    return recorder({ music: 'off' });
  }
}

export class FakeUI {
  constructor(root, handlers) {
    const ui = recorder({ score: { hidden: false }, handlers, results: null, closed: null, said: [], count: null, tags: new Set(), banner: '', spectating: false, settings: null, title: true });
    const set = (name, fn) => {
      ui[name] = fn;
    };
    set('showResults', (m) => {
      ui.results = m;
    });
    set('hideResults', () => {
      ui.results = null;
    });
    set('showClosed', (text, button, cb) => {
      ui.closed = { text, button, cb };
    });
    set('hideClosed', () => {
      ui.closed = null;
    });
    set('say', (big, sub, color, ms, sub2) => {
      ui.said.push({ big, sub, sub2, color });
    });
    set('countdown', (t) => {
      ui.count = t;
    });
    set('setBanner', (t) => {
      ui.banner = t;
    });
    set('setSpectating', (on) => {
      ui.spectating = !!on;
    });
    set('showTitle', (on) => {
      ui.title = !!on;
    });
    set('setSettings', (list, host) => {
      ui.settings = { list, host };
    });
    set('beginTags', () => {
      ui.tags = new Set();
    });
    set('tag', (id) => {
      ui.tags.add(id);
    });
    set('setScore', (b, o) => {
      ui.shown = [b, o];
    });
    set('setClock', (t, mode) => {
      ui.clockText = t;
      ui.clockMode = mode;
    });
    set('tick', noop);
    return ui;
  }
}

export class FakeView {
  constructor() {
    const calls = [];
    this.calls = calls;
    this.rig = new CameraRig();
    this.fx = recorder();
    this.focus = { x: 0, z: 0 };
    this.quality = 'high';
    this.lastTeam = 0;
    this.slow = 1;
    this.renders = 0;
    this.cars = new Set();
  }
  setQuality(q) {
    this.quality = q;
  }
  setReduced() {}
  resize() {}
  syncCars(world, meId) {
    this.cars = new Set(world.cars.map((c) => c.id));
    this.meId = meId;
  }
  view() {
    return { pulse() {} };
  }
  project(x, y, z, out) {
    out.x = 640;
    out.y = 360;
    out.depth = 0.5;
    out.on = true;
    return out;
  }
  render() {
    this.renders++;
  }
  hitFx(...a) {
    this.calls.push(['hit', ...a]);
  }
  goalFx(...a) {
    this.calls.push(['goal', ...a]);
  }
  winFx(...a) {
    this.calls.push(['win', ...a]);
  }
  wallFx() {}
  landFx() {}
  padFx() {}
  jumpFx() {}
  shake() {}
}

export class FakeInput {
  constructor() {
    this.thr = 0;
    this.steer = 0;
    this.boost = false;
    this.used = { drive: false, jump: false, boost: false };
    this.jump = false;
    this.cam = false;
    this.reset = false;
    this.enter = false;
  }
  poll() {}
  takeJump() {
    const j = this.jump;
    this.jump = false;
    return j;
  }
  takeCam() {
    const c = this.cam;
    this.cam = false;
    return c;
  }
  takeReset() {
    const r = this.reset;
    this.reset = false;
    return r;
  }
  takeEnter() {
    const e = this.enter;
    this.enter = false;
    return e;
  }
  flush() {}
}

const DEPS = { View: FakeView, UI: FakeUI, Sound: FakeSound, Input: FakeInput };

// ---------------------------------------------------------------- the room server

export class Hub {
  constructor() {
    this.time = 1_000_000; // the platform clock, ms
    this.state = {};
    this.players = new Map();
    this.rooms = new Map();
    this.hostId = null;
    this.match = { phase: 'lobby', n: 0, min: 1, id: undefined, participants: [], startsAt: 0, startedAt: undefined, seed: 1 };
    this.settings = { time: 120, size: 2 };
    this.matchCount = 0;
    this.pausedMs = 0;
    this.log = { messages: 0, states: {}, endMatch: 0 };
  }

  /** The match waits (too few players connected): matchNow() stands still until it resumes. */
  pause(on) {
    if (on && !this.match.paused) {
      this.match = { ...this.match, paused: { since: this.time } };
      for (const r of this.rooms.values()) r.emit('matchpause', this.match);
    } else if (!on && this.match.paused) {
      this.pausedMs += this.time - this.match.paused.since;
      const m = { ...this.match };
      delete m.paused;
      this.match = m;
      for (const r of this.rooms.values()) r.emit('matchresume', this.match);
    }
  }

  now() {
    return this.time;
  }

  join(id, name = id, team = 0) {
    const p = { id, name, presence: null, team: team || 1 + (this.players.size % 2), ready: false, connected: true, guest: false };
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    const room = new FakeRoom(this, p);
    this.rooms.set(id, room);
    return room;
  }

  /** The player's page goes away: they leave at once (no seat hold) and the host moves on. */
  leave(id) {
    this.players.delete(id);
    const room = this.rooms.get(id);
    this.rooms.delete(id);
    if (room) room.closed = true;
    if (this.hostId === id) {
      const next = [...this.players.keys()][0] ?? null;
      this.hostId = next;
      for (const r of this.rooms.values()) r.emit('host', next);
    }
    for (const r of this.rooms.values()) r.emit('leave', { id });
  }

  /** The room starts a match with these players: countdown now, play after `ms`. */
  startMatch(ids, ms = 3000) {
    this.matchCount++;
    this.match = { phase: 'starting', n: this.matchCount, min: 1, id: `m${this.matchCount}`, participants: ids.slice(), startsAt: this.time + ms, startedAt: undefined, seed: 1000 + this.matchCount };
    this.pausedMs = 0;
    for (const r of this.rooms.values()) r.emit('starting', this.match);
  }

  begin() {
    this.match = { ...this.match, phase: 'playing', startedAt: this.time };
    for (const r of this.rooms.values()) r.emit('matchstart', this.match);
  }

  endMatch() {
    this.log.endMatch++;
    const prev = this.match;
    this.match = { phase: 'lobby', n: prev.n, min: 1, participants: [], id: prev.id };
    for (const p of this.players.values()) p.ready = false;
    for (const r of this.rooms.values()) r.emit('matchend', this.match, prev);
  }

  advance(ms) {
    this.time += ms;
    if (this.match.phase === 'starting' && this.time >= this.match.startsAt) this.begin();
  }
}

class FakeRoom {
  constructor(hub, me) {
    this.hub = hub;
    this.me = me;
    this.listeners = new Map();
    this.closed = false;
    this.connected = true;
    this.kind = 'private';
    this.teams = 2;
    this.sent = [];
    this.writes = 0;
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  emit(name, ...args) {
    for (const fn of this.listeners.get(name) || []) fn(...args);
  }
  get players() {
    return this.hub.players;
  }
  get online() {
    return [...this.hub.players.values()].filter((p) => p.connected !== false);
  }
  get host() {
    return this.hub.hostId;
  }
  get isHost() {
    return this.connected && this.hub.hostId === this.me.id;
  }
  get state() {
    return this.hub.state;
  }
  get match() {
    return this.hub.match;
  }
  get settings() {
    return this.hub.settings;
  }
  get participants() {
    const m = this.hub.match;
    return m.phase === 'lobby' ? [] : m.participants.map((id) => this.hub.players.get(id)).filter(Boolean);
  }
  get spectating() {
    const m = this.hub.match;
    return m.phase !== 'lobby' && !m.participants.includes(this.me.id);
  }
  get running() {
    return this.hub.match.phase === 'playing' && !this.hub.match.paused;
  }
  isParticipant(id = this.me.id) {
    return this.hub.match.phase !== 'lobby' && this.hub.match.participants.includes(id);
  }
  matchNow() {
    const m = this.hub.match;
    if (m.phase !== 'playing') return 0;
    const now = m.paused ? m.paused.since : this.hub.time;
    return Math.max(0, now - m.startedAt - this.hub.pausedMs);
  }
  setState(k, v) {
    this.writes++;
    const log = this.hub.log.states;
    log[k] = (log[k] || 0) + 1;
    if (v === null || v === undefined) delete this.hub.state[k];
    else this.hub.state[k] = JSON.parse(JSON.stringify(v));
  }
  setPresence(p) {
    this.me.presence = JSON.parse(JSON.stringify(p));
  }
  presenceAt(id) {
    const p = this.hub.players.get(id);
    return p ? p.presence : null;
  }
  send(data, opts = {}) {
    this.hub.log.messages++;
    const copy = JSON.parse(JSON.stringify(data));
    const targets = opts.to ? [this.hub.rooms.get(opts.to)] : [...this.hub.rooms.values()].filter((r) => r !== this);
    for (const r of targets) if (r && !r.closed) r.emit('message', copy, this.me, this.hub.time, r.matchNow());
  }
  setSetting(id, v) {
    this.hub.settings = { ...this.hub.settings, [id]: v };
  }
  setReady(v = true) {
    this.me.ready = v;
  }
  hideLobby() {}
  endMatch() {
    if (this.isHost) this.hub.endMatch();
  }
  setOpen() {}
  leave() {
    this.hub.leave(this.me.id);
  }
}

/** Fake onceworlds for one player. */
export function fakeOw(hub, room, rec = {}) {
  rec.badges = rec.badges || [];
  rec.saves = rec.saves || {};
  rec.scores = rec.scores || [];
  return {
    mode: 'platform',
    now: () => hub.now(),
    on() {},
    settings: { quality: 'high', reducedMotion: false, pixelRatio: () => 1, on() {} },
    controls: { set(v) { rec.controls = v; }, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    player: { get: async () => ({ id: room.me.id, name: room.me.name }), avatarUrl: async () => null },
    save: { get: async (k) => rec.saves[k] ?? null, set: async (k, v) => { rec.saves[k] = v; }, delete: async () => {} },
    badges: { award: async (id) => { rec.badges.push(id); return true; } },
    leaderboards: { submit: async (b, s) => { rec.scores.push([b, s]); return { best: s, rank: 1 }; } },
    ui: { setOrientation() {}, showInvite() { rec.invited = true; } },
    rooms: { join: async () => room },
  };
}

/** Makes a Game page in `hub` for player `id`. Returns { game, room, ow, rec }. */
export async function makePage(hub, id, opts = {}) {
  const { Game } = await import('../src/game.js');
  const room = hub.join(id, opts.name || id, opts.team || 0);
  const rec = {};
  const ow = fakeOw(hub, room, rec);
  const game = new Game({ ow, room, canvas: {}, root: {}, deps: { ...DEPS } });
  return { game, room, ow, rec, id };
}

/** Runs `ms` of time at `fps` frames a second for every page. */
export function run(hub, ms, fps = 60) {
  const dt = 1000 / fps;
  for (let t = 0; t < ms; t += dt) {
    clock.vt += dt;
    hub.advance(dt);
    const cbs = clock.callbacks;
    clock.callbacks = [];
    for (const cb of cbs) cb(clock.vt);
  }
}
