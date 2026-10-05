// The game: ties the room, the simulation, the 3D view, the interface and the sound together.
//
// Who does what (the rules the platform's guide asks for):
//   - Every page simulates its own car at a fixed 60 Hz and publishes it as presence; others are drawn from presence.
//   - The host's page owns the ball and the bots and decides goals. It publishes the ball and the bots about 12 times a
//     second as room state `s` (stamped with the clock), and the match as room state `g` (written only when it changes).
//   - A page whose car touches its own copy of the ball applies the hit at once and tells the host; the host takes the
//     newest believable one. Other pages ease their copy of the ball toward the host's.
//   - Everything a page draws is derived from `room.match.phase` plus `g`, so a reload or a new host heals itself.

import { World } from './sim/world.js';
import { makeCar } from './sim/car.js';
import { HostSim } from './sim/host.js';
import { Match, buildRoster, readG } from './sim/rules.js';
import { advanceBall, makeBall } from './sim/ball.js';
import { goalScored } from './sim/arena.js';
import { clamp, hashString, wrapPi } from './sim/rng.js';
import { STEP, ACCENTS, CARP, KICKOFF_MS, PX } from './sim/consts.js';
import { encodePresence, readPresence, encodeSnapshot, readSnapshot, encodeHit, readHit } from './net/protocol.js';
import { TEAMS } from './render/palette.js';
import { JOIN_OPTIONS, SETTING_LIST, settingValue, clockText } from './config.js';
import { makeAvatars } from './ui/avatars.js';

const PRESENCE = { angles: ['h', 'p', 'fd'], snap: 12 };
const SNAP_DELAY_MS = 110;
const GO_MS = 900;
const RESULTS_AFTER_MS = 5500;

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const ballLerp = (a, b, t) => a + (b - a) * t;

export class Game {
  /**
   * deps: { View, UI, Sound, Input }: the classes to build the view, interface, sound and input from (the tests give fakes).
   * `view` may be null when the page has no WebGL: the game then runs without a picture rather than not at all.
   */
  constructor({ ow, room, canvas, root, deps }) {
    this.ow = ow;
    this.canvas = canvas;
    this.root = root;
    this.deps = deps;
    this.avatars = makeAvatars(ow);
    this.input = new deps.Input(ow);
    this.sound = new deps.Sound();
    this.ui = new deps.UI(root, {
      onPlay: () => this.play(),
      onSetting: (id, v) => this.room.setSetting(id, v),
      onCam: () => this.toggleCam(),
      onInvite: () => ow.ui?.showInvite?.(),
    });
    this.view = null;
    try {
      this.view = new deps.View(canvas, { quality: ow.settings.quality });
    } catch (e) {
      console.warn('[rocket-car-soccer] no 3D graphics here', e);
    }
    this.mode = 'title';
    this.world = new World(hashString(room.me.id));
    this.ballCam = true;
    this.kind = 'none';
    this.acc = 0;
    this.tickN = 0;
    this.last = performance.now();
    this.time = 0;
    this.camCar = { x: 0, y: 0.6, z: 0, h: 0, vx: 0, vz: 0 };
    this.camBall = { x: 0, y: 1.9, z: 0 };
    this.scratch = {};
    this.sp = {};
    this.tmpBall = makeBall();
    this.proj = { x: 0, y: 0, depth: 0, on: false };
    this.demoHost = null;
    this.controlsOn = null;
    this.legendUntil = 0;
    this.stopUntil = 0;
    this.slowT = -1;
    this.celebrate = null;
    this.resultsHideAt = 0;
    this.resultsFor = null;
    this.closedUi = null;
    this.saved = new Set();
    this.awarded = new Set();
    this.reduced = false;
    this.attachRoom(room);
    this.applySettings();
    this.buildDemo();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    try {
      ow.settings.on('change', () => {
        this.applySettings();
        this.resize();
      });
    } catch (e) {
      // settings events are optional
    }
    this.frameFn = (t) => this.frame(t);
    requestAnimationFrame(this.frameFn);
  }

  // ================================================================ room and session state

  /** Starts a session in `room` (the first, or a new one after the old closed): everything keyed to a room is reset here. */
  attachRoom(room) {
    this.room = room;
    this.g = null;
    this.rawG = undefined;
    this.gMid = null;
    this.localRoster = null;
    this.localRosterMid = null;
    this.rid = 'L';
    this.host = null;
    this.match = null;
    this.hostMid = null;
    this.lastWrite = 0;
    this.doneSent = false;
    this.snaps = [];
    this.rawS = undefined;
    this.snapRid = null;
    this.ballSynced = false;
    this.botIds = [];
    this.botCars = [];
    this.myHitAt = -1e9;
    this.remoteFxAt = 0;
    this.hitSeen = new Map();
    this.carsDirty = true;
    this.lastCarSync = 0;
    this.seenMid = null;
    this.seenGn = 0;
    this.seenRid = null;
    this.seenPhase = null;
    this.seenOt = 0;
    this.primed = false;
    this.lobbyGoal = false;
    this.goUntil = 0;
    this.bannerUntil = 0;
    this.lastCount = null;
    this.settingsKey = null;
    this.stuckT = 0;
    this.myCar = null;
    this.spectating = false;
    this.kind = 'none';
    room.on('message', (d, from, at) => this.onMessage(d, from, at));
    room.on('close', (reason) => this.onClose(reason));
    room.on('matchend', () => this.onMatchEnd());
    // a friends' server closes to newcomers while a match plays: leave the door open, they watch and join the next one
    // (never in a public server, where opening the room again would end the match)
    room.on('starting', () => {
      if (room.isHost && room.kind === 'private') room.setOpen?.(true);
    });
    room.on('host', () => {
      this.carsDirty = true;
    });
    room.on('join', () => {
      this.carsDirty = true;
    });
    room.on('leave', () => {
      this.carsDirty = true;
    });
    room.on('team', () => {
      this.carsDirty = true;
    });
    room.on('reconnect', () => {
      this.carsDirty = true;
    });
    room.on('settings', () => {
      this.carsDirty = true;
    });
  }

  get me() {
    return this.room.me;
  }

  /** The room's clock for things stamped by the host: match time while playing, the platform's clock otherwise. */
  clockNow() {
    return this.room.match.phase === 'playing' ? this.room.matchNow() : this.ow.now();
  }

  isAuth() {
    return this.mode === 'play' && this.room.isHost === true && this.room.connected !== false;
  }

  applySettings() {
    const s = this.ow.settings;
    this.reduced = !!s.reducedMotion;
    this.ui.setReduced(this.reduced);
    if (this.view) {
      this.view.setReduced(this.reduced);
      const q = s.quality;
      if (q && q !== this.view.quality) this.view.setQuality(q);
    }
  }

  resize() {
    const pr = this.ow.settings.pixelRatio ? this.ow.settings.pixelRatio(2) : Math.min(window.devicePixelRatio || 1, 2);
    if (this.view) this.view.resize(window.innerWidth, window.innerHeight, pr);
  }

  // ================================================================ title

  /** The title's backdrop: bots playing 3 against 3 with a ball of their own. */
  buildDemo() {
    const w = this.world;
    for (const c of [...w.cars]) w.removeCar(c.id);
    for (let i = 0; i < 6; i++) {
      const c = makeCar(`d${i}`, 1 + (i % 2), 'bot');
      c.slot = i >> 1;
      c.bot = true;
      c.accent = i;
      c.name = `Bot ${i}`;
      w.addCar(c);
    }
    w.frozen = false;
    w.botsHold = false;
    w.kickoff();
    this.demoHost = new HostSim(w, null);
    this.host = null;
    this.match = null;
    this.carsDirty = true;
    if (this.view) this.view.syncCars(w, null);
    this.room.hideLobby?.(true);
    this.ui.showTitle(true);
    this.ui.showHud(false);
    this.ui.showLobby(false);
    this.setControls(false);
    this.view?.rig.snapChase({ x: -20, y: 0.6, z: 0, h: 0, vx: 0, vz: 0 }, w.ball, false);
  }

  /** The Play button (or a tap, Space or Enter): sound starts, the lobby appears, and you drive. */
  play() {
    if (this.mode !== 'title') return;
    this.sound.unlock();
    this.mode = 'play';
    this.ui.showTitle(false);
    this.room.hideLobby?.(false);
    this.input.flush();
    this.demoHost = null;
    this.acc = 0;
    const w = this.world;
    for (const c of [...w.cars]) w.removeCar(c.id);
    w.frozen = false;
    w.botsHold = false;
    w.kickoff();
    this.view?.fx.clear();
    this.kind = 'none';
    this.carsDirty = true;
    this.primed = false;
    this.sound.setMusic('menu');
    this.legendUntil = performance.now() + 45000;
  }

  // ================================================================ the frame

  frame(t) {
    requestAnimationFrame(this.frameFn);
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    try {
      this.step(dt);
    } catch (e) {
      // one bad frame must never stop the game; the error is reported to the creator by the platform
      if (!this.warned) {
        this.warned = true;
        console.error('[rocket-car-soccer] frame error', e);
      }
    }
  }

  step(dt) {
    if (this.mode === 'title') {
      this.stepTitle(dt);
    } else {
      this.stepPlay(dt);
    }
    this.ui.tick(performance.now());
  }

  stepTitle(dt) {
    const w = this.world;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 5) {
      this.demoHost.step(performance.now());
      this.acc -= STEP;
      n++;
    }
    if (n === 5) this.acc = 0;
    if (this.input.takeEnter() || this.input.takeJump()) this.play();
    if (this.view) {
      this.view.rig.orbit(dt, w.ball);
      this.view.focus.x = w.ball.x;
      this.view.focus.z = w.ball.z;
      this.view.lastTeam = this.demoHost ? this.demoHost.lastTeam : 0;
      this.view.render(dt, this.acc / STEP, w);
    }
    this.ui.setTouch(!!this.ow.controls?.touch);
    this.updateMusic();
  }

  stepPlay(dt) {
    const room = this.room;
    const kind = room.match.phase;
    this.spectating = room.spectating === true;
    const g = this.currentG();
    this.rid = this.computeRid(kind, g);
    if (kind !== this.kind) this.enterKind(kind);
    if (this.carsDirty || performance.now() - this.lastCarSync > 400) this.syncCars(kind, g);
    this.syncAuthority(kind, g);
    this.syncFromG(kind, g);
    this.input.poll();
    this.ui.setTouch(!!this.ow.controls?.touch);

    const w = this.world;
    const car = this.myCar;
    w.frozen = this.isFrozen(kind, g);
    w.botsHold = kind === 'playing' && !!g && (g.phase === 'end' || g.phase === 'results');
    if (this.input.takeCam()) this.toggleCam();

    // fixed steps, with a short freeze after a big hit
    const nowMs = performance.now();
    if (nowMs < this.stopUntil) {
      this.acc = 0;
    } else {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        this.tick(kind, g);
        this.acc -= STEP;
        n++;
      }
      if (n === 5) this.acc = 0;
    }
    const alpha = this.acc / STEP;

    this.updateRemotes();
    this.blendBall(dt, kind);
    this.checkStuck(dt, kind, g);
    this.lobbyGoalFx(kind);
    this.updateControls(kind, g);
    this.updateCamera(dt, alpha, kind, g);
    this.updateHud(kind, g, car);
    this.updateMusic();
    if (this.view) {
      this.view.lastTeam = this.host ? this.host.lastTeam : this.lastTeamSeen || 0;
      this.view.slow = this.slowFactor();
      this.view.render(dt, alpha, w);
      this.updateTags(kind, g);
    }
  }

  // ================================================================ derived state

  currentG() {
    const room = this.room;
    const mid = room.match.id;
    const raw = room.state.g;
    if (room.match.phase === 'lobby') return null;
    if (raw === this.rawG && mid === this.gMid) return this.g;
    this.rawG = raw;
    this.gMid = mid;
    this.g = readG(raw, mid);
    this.carsDirty = true;
    return this.g;
  }

  computeRid(kind, g) {
    if (kind === 'lobby') return 'L';
    if (kind === 'starting') return `${this.room.match.id}.0`;
    return g ? g.rid : `${this.room.match.id}.0`;
  }

  isFrozen(kind, g) {
    if (kind === 'starting') return true;
    if (kind !== 'playing') return false;
    if (!this.room.running) return true;
    if (!g) return true;
    if (g.phase === 'pre') return true;
    if (g.phase === 'kick') return this.room.matchNow() < g.until;
    return false;
  }

  /** The roster this page would build by itself: the same on every page, so cars exist before the host's record arrives. */
  rosterFallback() {
    const room = this.room;
    const m = room.match;
    if (this.localRosterMid === m.id && this.localRoster) return this.localRoster;
    const humans = (m.participants || []).map((id) => ({ id, team: room.players.get(id)?.team }));
    const { roster, size } = buildRoster(humans, settingValue(room.settings, 'size'), Number(m.seed) || 1);
    this.localRoster = { roster, size };
    this.localRosterMid = m.id;
    return this.localRoster;
  }

  // ================================================================ screens changing

  enterKind(kind) {
    const prev = this.kind;
    this.kind = kind;
    this.carsDirty = true;
    this.input.flush();
    this.snaps = [];
    this.ballSynced = false;
    this.lastCount = null;
    this.celebrate = null;
    this.slowT = -1;
    const w = this.world;
    if (kind === 'starting') {
      this.ui.hideResults();
      this.resultsFor = null;
      this.view?.fx.clear();
      this.doneSent = false;
      this.saved = new Set();
      this.host = null;
      this.match = null;
      this.sound.setMusic('play');
      for (const c of [...w.cars]) w.removeCar(c.id);
      this.syncCars(kind, null);
      w.kickoff();
      this.snapMyCamera();
    } else if (kind === 'playing') {
      this.sound.setMusic('play');
      this.carsDirty = true;
    } else {
      // the lobby: free play on the pitch with the ball
      this.host = null;
      this.match = null;
      this.hostMid = null;
      this.seenMid = null;
      this.primed = false;
      for (const c of [...w.cars]) w.removeCar(c.id);
      w.frozen = false;
      w.botsHold = false;
      this.syncCars(kind, null);
      w.kickoff();
      this.view?.fx.clear();
      this.sound.setMusic('menu');
      if (prev === 'playing' || prev === 'starting') {
        this.resultsHideAt = this.resultsFor ? performance.now() + RESULTS_AFTER_MS : 0;
        this.room.hideLobby?.(false);
      }
      this.snapMyCamera();
    }
  }

  onMatchEnd() {
    this.carsDirty = true;
  }

  snapMyCamera() {
    if (!this.view) return;
    const car = this.myCar;
    if (car && !this.spectating) this.view.rig.snapChase(car, this.world.ball, this.ballCam);
  }

  // ================================================================ cars

  /** The cars the world should hold right now. */
  wanted(kind, g) {
    const room = this.room;
    const out = [];
    const myId = this.me.id;
    if (kind === 'lobby') {
      const byTeam = [[], [], []];
      for (const p of room.players.values()) {
        if (p.connected === false && p.id !== myId) continue;
        const t = p.team === 2 ? 2 : 1;
        byTeam[t].push(p);
      }
      for (const t of [1, 2]) {
        byTeam[t].sort((a, b) => (a.id < b.id ? -1 : 1));
        byTeam[t].forEach((p, i) => out.push({ id: p.id, team: t, slot: i, bot: false, name: p.name || 'Player' }));
      }
      return out;
    }
    const roster = g ? g.roster : this.rosterFallback().roster;
    for (const r of roster) {
      const p = room.players.get(r.id);
      out.push({ id: r.id, team: r.tm, slot: r.sl, bot: !!r.b, name: r.b ? r.nm : p?.name || 'Player', gone: !r.b && !p });
    }
    return out;
  }

  syncCars(kind, g) {
    this.carsDirty = false;
    this.lastCarSync = performance.now();
    const w = this.world;
    const want = this.wanted(kind, g);
    const myId = this.me.id;
    const auth = this.isAuth();
    const spectating = this.spectating;
    const ids = new Set(want.map((x) => x.id));
    for (const c of [...w.cars]) if (!ids.has(c.id)) w.removeCar(c.id);
    this.botIds = [];
    this.botCars = [];
    for (const x of want) {
      const mine = x.id === myId && !spectating;
      const kindWanted = mine ? 'local' : x.bot ? (auth ? 'bot' : 'remote') : 'remote';
      let c = w.byId.get(x.id);
      if (!c) {
        c = makeCar(x.id, x.team, kindWanted);
        c.slot = x.slot;
        w.addCar(c);
        w.placeAtSpot(c);
        if (mine) this.restoreMyCar(c, kind);
        c.visible = x.bot || mine;
      } else {
        if (c.kind !== kindWanted) {
          if (kindWanted !== 'bot') c.brain = null;
          c.kind = kindWanted;
        }
        c.team = x.team;
        c.slot = x.slot;
      }
      c.bot = x.bot;
      c.name = x.name;
      c.accent = hashString(x.id) % ACCENTS.length;
      if (x.gone) c.visible = false;
      if (x.bot) {
        this.botIds.push(x.id);
        this.botCars.push(c);
      }
    }
    this.myCar = !spectating ? w.byId.get(myId) || null : null;
    if (this.view) this.view.syncCars(w, this.myCar ? myId : null);
  }

  /** After a reload the room gives back our last presence: carry on from it instead of the kickoff spot. */
  restoreMyCar(c, kind) {
    const p = this.me.presence;
    if (!p || kind === 'starting') return;
    if (!readPresence(p, this.sp)) return;
    const s = this.sp;
    c.x = c.px = s.x;
    c.y = c.py = Math.max(0.6, s.y);
    c.z = c.pz = s.z;
    c.h = c.ph = s.h;
    c.p = c.pp = s.p;
    c.vx = s.vx;
    c.vy = s.vy;
    c.vz = s.vz;
    c.boost = s.boost || CARP.kickoffBoost;
    c.ground = c.y <= 0.61;
  }

  // ================================================================ the host's duties

  /** Starts, continues or drops the host's rules and simulation to match who the host is right now. */
  syncAuthority(kind, g) {
    const room = this.room;
    const w = this.world;
    if (!this.isAuth()) {
      if (this.host) this.dropHost();
      return;
    }
    if (kind === 'lobby') {
      if (!this.host || this.host.match) this.host = new HostSim(w, null);
      this.match = null;
      return;
    }
    const mid = room.match.id;
    if (!g) {
      if (kind === 'starting' || kind === 'playing') this.beginMatch(mid);
      return;
    }
    if (g.by !== this.me.id || !this.match || this.match.mid !== mid) {
      this.match = Match.fromG(g);
      this.match.by = this.me.id;
      this.match.dirty = true;
      this.host = new HostSim(w, this.match);
      this.hostMid = mid;
      this.carsDirty = true;
    }
    if (kind === 'playing' && this.match.phase === 'pre') this.match.start(room.matchNow());
    this.writeG();
  }

  /** The host builds the roster (humans where the room put them, bots to fill both sides) and the first record. */
  beginMatch(mid) {
    const room = this.room;
    const { roster, size } = this.rosterFallback();
    const dur = settingValue(room.settings, 'time');
    this.match = new Match({ mid, by: this.me.id, roster, dur, size });
    this.host = new HostSim(this.world, this.match);
    this.hostMid = mid;
    this.writeG(true);
    this.carsDirty = true;
  }

  dropHost() {
    this.host = null;
    this.match = null;
    this.hostMid = null;
    this.carsDirty = true;
  }

  /** Writes the match record when it changed, at most about 10 times a second. */
  writeG(force = false) {
    const m = this.match;
    if (!m || !m.dirty) return;
    const now = performance.now();
    if (!force && now - this.lastWrite < 90) return;
    this.lastWrite = now;
    m.dirty = false;
    this.room.setState('g', m.toG());
  }

  // ================================================================ one fixed step

  tick(kind, g) {
    this.tickN++;
    const w = this.world;
    const car = this.myCar;
    const room = this.room;
    if (car && car.kind === 'local') this.feedInput(car, kind, g);
    const now = this.clockNow();
    let events = null;
    if (this.host && (kind === 'lobby' || (kind === 'playing' && room.running))) {
      events = this.host.step(now); // also moves the match through its countdowns while the cars stand still
    } else {
      w.step(STEP);
    }
    this.afterStep(now, kind);
    if (events) this.hostEvents(events, kind);
    if (this.tickN % 3 === 0 && car && car.kind === 'local' && car.visible) room.setPresence(encodePresence(car));
    if (this.host && this.tickN % (w.frozen ? 30 : 5) === 0) this.publishSnapshot(now);
    if (this.host) this.writeG();
  }

  feedInput(car, kind, g) {
    const inp = this.input;
    const live = !this.world.frozen && !(kind === 'playing' && g && (g.phase === 'end' || g.phase === 'results'));
    if (!live) {
      car.thr = 0;
      car.steer = 0;
      car.pitchIn = 0;
      car.boostIn = false;
      car.jumpIn = false;
      inp.takeJump();
      return;
    }
    car.thr = inp.thr;
    car.steer = inp.steer;
    car.pitchIn = inp.thr;
    car.boostIn = inp.boost;
    car.assist = this.ballCam;
    if (inp.takeJump()) car.jumpIn = true;
  }

  publishSnapshot(now) {
    const snap = encodeSnapshot(this.rid, now, this.world.ball, this.botCars, this.host.lastTeam);
    this.room.setState('s', snap);
  }

  /** What the world says happened this step: sounds, sparks, and telling the host about a touch. */
  afterStep(now, kind) {
    const w = this.world;
    const me = this.myCar;
    const ball = w.ball;
    const view = this.view;
    for (let i = 0; i < w.nev; i++) {
      const e = w.ev[i];
      const car = e.car;
      const mine = car !== null && car === me;
      switch (e.type) {
        case 'hit': {
          if (view) view.hitFx(ball.x, ball.y, ball.z, e.a, car.team);
          this.lastTeamSeen = car.team;
          if (this.near(ball.x, ball.z) || mine) this.sound.hit(e.a);
          if (mine) {
            if (view) {
              view.shake(clamp(e.a / 75, 0.12, 0.55));
              view.view(car.id)?.pulse(clamp(e.a / 60, 0.2, 0.8));
            }
            if (e.a > 46 && !this.reduced && !this.host) this.stopUntil = performance.now() + 45; // never the host's: it would stall everyone
            this.myHitAt = performance.now();
            if (!this.host && kind !== 'starting') this.room.send(encodeHit(this.rid, now, ball, car), { to: this.room.host });
          } else if (view && this.near(ball.x, ball.z)) view.shake(clamp(e.a / 200, 0, 0.18));
          break;
        }
        case 'jump':
          if (mine) this.sound.jump();
          if (view && car.visible) view.jumpFx(car.x, car.z, mine ? 1 : 0.5);
          break;
        case 'dodge':
          if (mine) this.sound.dodge();
          break;
        case 'land':
          if (view && car.visible) {
            view.landFx(car.x, car.z, e.a);
            view.view(car.id)?.pulse(clamp(e.a / 24, 0.2, 0.7));
          }
          if (mine) this.sound.land(e.a);
          break;
        case 'bump':
          if (mine) {
            this.sound.bump(e.a);
            view?.shake(clamp(e.a / 90, 0, 0.3));
          }
          break;
        case 'carbump':
          if (mine) {
            this.sound.bump(e.a * 1.4);
            view?.shake(clamp(e.a / 70, 0, 0.3));
          }
          break;
        case 'ballwall':
          if (this.near(ball.x, ball.z)) this.sound.wall(e.a);
          if (view && e.a > 8) view.wallFx(ball.x, ball.y, ball.z, e.a);
          break;
        case 'pad':
          if (view && car.visible) view.padFx(car.x, car.z, e.a === 1);
          if (mine) this.sound.pad(e.a === 1);
          break;
        default:
          break;
      }
    }
  }

  near(x, z) {
    const c = this.myCar || this.camCar;
    return Math.hypot(x - c.x, z - c.z) < 60;
  }

  /** Things the host's rules reported. Goals and phases reach everyone (the host too) through the record; these are the host's own. */
  hostEvents(events, kind) {
    for (const e of events) {
      if (e.type === 'done') {
        if (!this.doneSent) {
          this.doneSent = true;
          this.room.endMatch();
        }
      } else if (e.type === 'save') {
        if (e.id === this.me.id) this.onSave();
        else this.room.send({ t: 'save' }, { to: e.id });
      }
    }
  }

  onSave() {
    this.ui.say('SAVE!', '', '#ffd23d', 1000, '', true);
    this.sound.save();
  }

  /** Messages from other pages: touches (to the host) and a save notice (to the one who made it). */
  onMessage(d, from, at) {
    if (!d || typeof d !== 'object' || !from) return;
    if (d.t === 'save') {
      if (from.id === this.room.host && this.mode === 'play') this.onSave();
      return;
    }
    if (d.t !== 'hit' || !this.host || !this.isAuth()) return;
    const h = readHit(d);
    if (!h || h.rid !== this.rid) return;
    const car = this.world.byId.get(from.id);
    if (!car || car.kind !== 'remote' || car.bot) return;
    const nowMs = performance.now();
    if (nowMs - (this.hitSeen.get(from.id) || 0) < 40) return;
    this.hitSeen.set(from.id, nowMs);
    const pl = this.room.players.get(from.id);
    const pres = pl && readPresence(pl.presence, this.scratch) ? this.scratch : null;
    const r = this.host.remoteHit(car, h, this.clockNow(), pres);
    if (!r) return;
    this.lastTeamSeen = car.team;
    const b = this.world.ball;
    if (this.view && this.near(b.x, b.z)) {
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      this.view.hitFx(b.x, b.y, b.z, speed * 0.8, car.team);
      this.sound.hit(speed * 0.8);
    }
    if (r === 2) this.room.send({ t: 'save' }, { to: from.id });
  }

  // ================================================================ other people's cars and the host's ball

  updateRemotes() {
    const room = this.room;
    const w = this.world;
    const s = this.sp;
    for (const c of w.cars) {
      if (c.kind !== 'remote' || c.bot) continue;
      const pl = room.players.get(c.id);
      if (!pl) {
        c.visible = false;
        continue;
      }
      const raw = room.presenceAt(c.id, PRESENCE);
      if (!readPresence(raw, s)) continue;
      const away = pl.connected === false;
      c.visible = true;
      c.x = c.px = s.x;
      c.y = c.py = Math.max(0.6, s.y);
      c.z = c.pz = s.z;
      c.h = c.ph = s.h;
      c.p = c.pp = s.p;
      c.vx = away ? 0 : s.vx;
      c.vy = away ? 0 : s.vy;
      c.vz = away ? 0 : s.vz;
      c.boost = s.boost;
      c.boosting = !away && s.bo > 0.5;
      c.dodge = away ? 0 : s.fl;
      c.dodgeA = s.fd;
      c.ground = s.gr > 0.5;
      c.ss = !away && Math.hypot(c.vx, c.vy, c.vz) > CARP.boostMax * CARP.supersonic;
    }
    if (!this.isAuth()) this.readSnapshots();
  }

  /** Takes in the host's latest snapshot of the ball and the bots, and draws the bots a moment in the past between two of them. */
  readSnapshots() {
    const raw = this.room.state.s;
    if (raw !== this.rawS) {
      this.rawS = raw;
      const s = readSnapshot(raw, this.botIds.length);
      if (s && s.rid === this.rid) {
        const last = this.snaps[this.snaps.length - 1];
        if (!last || s.t > last.t) {
          this.snaps.push(s);
          if (this.snaps.length > 8) this.snaps.shift();
        }
      }
    }
    const buf = this.snaps;
    if (!buf.length) return;
    const newest = buf[buf.length - 1];
    this.lastTeamSeen = newest.lt;
    const T = this.clockNow() - SNAP_DELAY_MS;
    let a = buf[0];
    let b = buf[0];
    for (let i = 0; i < buf.length; i++) {
      if (buf[i].t <= T) a = buf[i];
      if (buf[i].t >= T) {
        b = buf[i];
        break;
      }
      b = buf[i];
    }
    const k = b.t > a.t ? clamp((T - a.t) / (b.t - a.t), 0, 1) : 1;
    const ahead = clamp((T - newest.t) / 1000, 0, 0.25);
    for (let i = 0; i < this.botCars.length; i++) {
      const c = this.botCars[i];
      if (c.kind !== 'remote') continue;
      const p = a.k[i];
      const q = b.k[i];
      if (!p || !q) continue;
      c.visible = true;
      c.x = c.px = ballLerp(p[0], q[0], k) + (b === a ? q[5] * ahead : 0);
      c.y = c.py = Math.max(0.6, ballLerp(p[1], q[1], k));
      c.z = c.pz = ballLerp(p[2], q[2], k) + (b === a ? q[7] * ahead : 0);
      c.h = c.ph = p[3] + wrapPi(q[3] - p[3]) * k;
      c.p = c.pp = ballLerp(p[4], q[4], k);
      c.vx = ballLerp(p[5], q[5], k);
      c.vy = ballLerp(p[6], q[6], k);
      c.vz = ballLerp(p[7], q[7], k);
      c.boost = q[8];
      c.boosting = (q[9] & 1) === 1;
      c.ground = (q[9] & 2) === 2;
      c.dodge = (q[9] & 4) === 4 ? 0.2 : 0;
      c.ss = Math.hypot(c.vx, c.vy, c.vz) > CARP.boostMax * CARP.supersonic;
    }
  }

  /** Eases this page's ball toward the host's (flown on to now); a page that just touched it keeps its own for a moment. */
  blendBall(dt, kind) {
    if (this.isAuth() || this.world.frozen) return;
    const buf = this.snaps;
    if (!buf.length) return;
    const s = buf[buf.length - 1];
    const age = clamp((this.clockNow() - s.t) / 1000, 0, 0.5);
    const t = this.tmpBall;
    t.x = s.b[0];
    t.y = s.b[1];
    t.z = s.b[2];
    t.vx = s.b[3];
    t.vy = s.b[4];
    t.vz = s.b[5];
    advanceBall(t, age, t);
    const b = this.world.ball;
    const err = Math.hypot(t.x - b.x, t.y - b.y, t.z - b.z);
    const since = (performance.now() - this.myHitAt) / 1000;
    let k = 1 - Math.exp(-dt / 0.075);
    if (since < 0.25) k = 0;
    else if (since < 0.45) k *= (since - 0.25) / 0.2;
    // a sudden change of speed the host's ball has and this page's doesn't: someone else touched it (or it hit a wall a hair earlier)
    const dv = Math.hypot(t.vx - b.vx, t.vy - b.vy, t.vz - b.vz);
    const nowMs = performance.now();
    if (dv > 11 && this.ballSynced && since > 0.45 && nowMs - this.remoteFxAt > 140) {
      this.remoteFxAt = nowMs;
      const power = Math.min(60, dv * 1.1);
      if (this.view && this.near(b.x, b.z)) this.view.hitFx(b.x, b.y, b.z, power, this.lastTeamSeen || 0);
      if (this.near(b.x, b.z)) this.sound.hit(power);
    }
    if (!this.ballSynced || err > 9) {
      if (since > 0.45 || !this.ballSynced) {
        this.shiftBall(b, t.x - b.x, t.y - b.y, t.z - b.z);
        b.vx = t.vx;
        b.vy = t.vy;
        b.vz = t.vz;
        this.ballSynced = true;
      }
      return;
    }
    if (k <= 0) return;
    this.shiftBall(b, (t.x - b.x) * k, (t.y - b.y) * k, (t.z - b.z) * k);
    b.vx += (t.vx - b.vx) * k;
    b.vy += (t.vy - b.vy) * k;
    b.vz += (t.vz - b.vz) * k;
  }

  shiftBall(b, dx, dy, dz) {
    b.x += dx;
    b.y += dy;
    b.z += dz;
    b.px += dx;
    b.py += dy;
    b.pz += dz;
  }

  /** A car that hasn't moved for three seconds while its driver pushes is put back on its kickoff spot. */
  checkStuck(dt, kind, g) {
    const c = this.myCar;
    const wantReset = this.input.takeReset();
    if (!c || c.kind !== 'local' || this.world.frozen) {
      this.stuckT = 0;
      return;
    }
    const speed = Math.hypot(c.vx, c.vz);
    if (speed < 0.8 && c.ground && (Math.abs(this.input.thr) > 0.3 || wantReset)) this.stuckT += dt * (wantReset ? 3 : 1);
    else if (speed > 2) this.stuckT = 0;
    if (this.stuckT > 3) {
      this.stuckT = 0;
      this.world.placeAtSpot(c);
      this.snapMyCamera();
    }
  }

  /** A goal in free play: the same burst of light on every page, no score. */
  lobbyGoalFx(kind) {
    if (kind !== 'lobby' || !this.view) return;
    const b = this.world.ball;
    const t = goalScored(b.x, b.y, b.z);
    if (t && !this.lobbyGoal) {
      this.lobbyGoal = true;
      this.view.goalFx(t, [b.x, b.y, b.z]);
      this.view.shake(0.4);
      this.sound.goal(false);
    } else if (!t && Math.abs(b.x) < PX - 3) this.lobbyGoal = false;
  }

  // ================================================================ what the record says

  syncFromG(kind, g) {
    if (kind === 'lobby' || !g) return;
    if (g.mid !== this.seenMid) {
      this.seenMid = g.mid;
      this.seenGn = g.gn;
      this.seenRid = g.rid;
      this.seenPhase = g.phase;
      this.seenOt = g.ot;
      this.primed = true;
      if (g.phase === 'results') this.showResults(g);
      return;
    }
    if (g.gn > this.seenGn) {
      this.seenGn = g.gn;
      this.onGoal(g);
    }
    if (g.rid !== this.seenRid) {
      this.seenRid = g.rid;
      this.onNewRound(g);
    }
    if (g.ot && !this.seenOt) {
      this.seenOt = 1;
      this.ui.say('GOLDEN GOAL', 'NEXT GOAL WINS', '#ffd23d', 2400);
      this.sound.whistle();
    }
    if (g.phase !== this.seenPhase) {
      const prev = this.seenPhase;
      this.seenPhase = g.phase;
      this.onPhase(prev, g);
    }
  }

  myTeam(g) {
    const r = g ? g.roster.find((x) => x.id === this.me.id) : null;
    return r ? r.tm : 0;
  }

  nameOf(g, id) {
    const r = g.roster.find((x) => x.id === id);
    if (!r) return 'Player';
    if (r.b) return r.nm;
    return this.room.players.get(id)?.name || 'Player';
  }

  onGoal(g) {
    const last = g.last;
    if (!last) return;
    const team = TEAMS[last.tm];
    const mine = this.myTeam(g) === last.tm;
    const view = this.view;
    view?.goalFx(last.tm, last.bp);
    view?.shake(0.9);
    this.ui.flash();
    this.sound.goal(mine);
    if (!this.reduced) this.slowT = performance.now();
    this.celebrate = { sx: last.bp[0] > 0 ? 1 : -1, bp: last.bp, until: performance.now() + 2600 };
    const color = hex(team.glow);
    if (last.og) this.ui.say('OWN GOAL', `${team.name} SCORES`, color, 2800);
    else if (last.by) this.ui.say('GOAL!', this.nameOf(g, last.by), color, 2800, last.as ? `ASSIST ${this.nameOf(g, last.as)}` : '');
    else this.ui.say('GOAL!', `${team.name} SCORES`, color, 2800);
    if (last.by === this.me.id) {
      this.award('first-goal');
      if (last.air) this.award('aerial');
      if ((g.st[this.me.id]?.[0] || 0) >= 3) this.award('hat-trick');
    }
  }

  /** A new kickoff: everyone back on their spot, the ball in the middle, a fresh view. */
  onNewRound(g) {
    this.snaps = [];
    this.ballSynced = false;
    this.celebrate = null;
    this.slowT = -1;
    this.hitSeen.clear();
    this.myHitAt = -1e9;
    this.lastTeamSeen = 0;
    if (g.phase === 'kick') {
      const w = this.world;
      w.kickoff();
      this.view?.fx.clear();
      this.snapMyCamera();
      this.carsDirty = true;
      this.input.flush();
      this.bannerUntil = performance.now() + (KICKOFF_MS + 1800);
    }
  }

  onPhase(prev, g) {
    if (g.phase === 'play' && (prev === 'kick' || prev === 'pre')) {
      this.goUntil = performance.now() + GO_MS;
      this.sound.go();
      this.bannerUntil = Math.max(this.bannerUntil, performance.now() + 2200);
    } else if (g.phase === 'end') {
      this.ui.say('FULL TIME', '', '#ffffff', 1800);
      this.sound.whistle();
      this.finishMatch(g);
    } else if (g.phase === 'results') {
      this.showResults(g);
    }
  }

  /** Stats, badges and the leaderboard: once per match, from the final record. */
  finishMatch(g) {
    if (this.saved.has(g.mid) || !g.res) return;
    this.saved.add(g.mid);
    const id = this.me.id;
    const tm = this.myTeam(g);
    if (!tm) return;
    const st = g.st[id] || [0, 0, 0, 0];
    const won = g.res.win === tm;
    if (st[0] >= 1) this.award('first-goal');
    if (st[0] >= 3) this.award('hat-trick');
    if (won) this.award('first-win');
    const ow = this.ow;
    (async () => {
      try {
        const stats = (await ow.save.get('stats')) || {};
        const next = {
          matches: (Number(stats.matches) || 0) + 1,
          wins: (Number(stats.wins) || 0) + (won ? 1 : 0),
          goals: (Number(stats.goals) || 0) + st[0],
          assists: (Number(stats.assists) || 0) + st[1],
          saves: (Number(stats.saves) || 0) + st[2],
        };
        await ow.save.set('stats', next);
        if (won) await ow.leaderboards.submit('wins', next.wins);
      } catch (e) {
        // saving is best effort
      }
    })();
  }

  award(id) {
    if (this.awarded.has(id)) return;
    this.awarded.add(id);
    try {
      Promise.resolve(this.ow.badges.award(id)).catch(() => {});
    } catch (e) {
      // guests and standalone pages simply don't earn badges
    }
  }

  showResults(g) {
    if (this.resultsFor === g.mid || !g.res) return;
    this.resultsFor = g.mid;
    const res = g.res;
    const rows = g.roster
      .map((r, i) => ({ id: r.id, name: r.b ? r.nm : this.room.players.get(r.id)?.name || 'Player', team: r.tm, pts: res.pts[r.id] || 0, mvp: res.mvp === r.id, you: r.id === this.me.id, order: i, avatar: r.b ? null : this.avatars.url(r.id) }))
      .sort((a, b) => b.pts - a.pts || a.order - b.order);
    const tm = this.myTeam(g);
    const head = res.win === 0 ? 'DRAW' : `${TEAMS[res.win].name} WINS`;
    const color = res.win === 0 ? '#ffffff' : hex(TEAMS[res.win].glow);
    this.ui.showResults({ head, color, score: g.sc, rows, you: rows.findIndex((r) => r.you) });
    const won = tm && res.win === tm;
    this.sound.finish(!!won);
    if (res.win && won) this.view?.winFx(res.win);
    this.resultsHideAt = 0;
  }

  // ================================================================ screen: controls, camera, hud

  setControls(on) {
    if (this.controlsOn === on) return;
    this.controlsOn = on;
    try {
      const c = this.ow.controls;
      if (!c) return;
      if (on) {
        c.set({
          stick: 'analog',
          buttons: [
            { id: 'jump', label: 'Jump', key: ' ' },
            { id: 'boost', label: 'Boost', key: 'Shift' },
            { id: 'cam', label: 'Ball cam', key: 'c' },
          ],
        });
      } else c.set(null);
    } catch (e) {
      // touch controls are optional
    }
  }

  updateControls(kind, g) {
    const playing = !this.spectating && this.myCar && !(kind === 'playing' && g && g.phase === 'results');
    this.setControls(!!playing);
  }

  toggleCam() {
    this.ballCam = !this.ballCam;
    this.ui.setCam(this.ballCam);
    this.sound.tick();
  }

  updateCamera(dt, alpha, kind, g) {
    const view = this.view;
    const w = this.world;
    const car = this.myCar;
    const b = w.ball;
    this.camBall.x = b.px + (b.x - b.px) * alpha;
    this.camBall.y = b.py + (b.y - b.py) * alpha;
    this.camBall.z = b.pz + (b.z - b.pz) * alpha;
    if (car) {
      const cc = this.camCar;
      cc.x = car.px + (car.x - car.px) * alpha;
      cc.y = car.py + (car.y - car.py) * alpha;
      cc.z = car.pz + (car.z - car.pz) * alpha;
      cc.h = car.ph + wrapPi(car.h - car.ph) * alpha;
      cc.vx = car.vx;
      cc.vz = car.vz;
    }
    if (!view) return;
    const rig = view.rig;
    view.focus.x = car ? this.camCar.x : this.camBall.x;
    view.focus.z = car ? this.camCar.z : this.camBall.z;
    if (this.spectating || !car) rig.spectate(dt, this.camBall);
    else if (this.celebrate && performance.now() < this.celebrate.until) rig.celebrate(dt, this.celebrate.sx, this.celebrate.bp);
    else rig.chase(dt, this.camCar, this.camBall, this.ballCam);
  }

  slowFactor() {
    if (this.slowT < 0 || this.reduced) return 1;
    const t = (performance.now() - this.slowT) / 1000;
    if (t > 0.6) {
      this.slowT = -1;
      return 1;
    }
    const e = t / 0.6;
    return 0.3 + 0.7 * e * e;
  }

  updateHud(kind, g, car) {
    const ui = this.ui;
    const room = this.room;
    const lobby = kind === 'lobby';
    const spectating = this.spectating;
    ui.setSpectating(spectating);
    ui.showLobby(lobby && !spectating);
    ui.showHud(true);
    ui.setCam(this.ballCam);
    const now = performance.now();

    if (lobby) {
      const isHost = room.isHost === true;
      const key = `${settingValue(room.settings, 'time')}|${settingValue(room.settings, 'size')}|${isHost}`;
      if (key !== this.settingsKey) {
        this.settingsKey = key;
        ui.setSettings(
          SETTING_LIST.map((s) => ({ id: s.id, label: s.label, value: settingValue(room.settings, s.id), options: s.options })),
          isHost,
        );
      }
      ui.setHint('Hit the ball into their goal');
      ui.showInviteButton(room.online.length < 2);
      const used = this.input.used;
      for (const k of ['drive', 'jump', 'boost']) if (used[k]) ui.legendUsed(k);
      ui.setLegend(now < this.legendUntil && !(used.drive && used.jump && used.boost));
      ui.setScore(0, 0);
      ui.score.hidden = true;
      ui.setClock('0:00');
      ui.countdown(null);
      ui.setBanner('', '');
      if (this.resultsHideAt && now > this.resultsHideAt) {
        this.resultsHideAt = 0;
        ui.hideResults();
      }
    } else {
      ui.score.hidden = false;
      ui.showInviteButton(false);
      ui.setLegend(false);
      if (this.resultsHideAt && now > this.resultsHideAt) {
        this.resultsHideAt = 0;
        ui.hideResults();
      }
    }
    if (car) ui.setBoost(car.boost, car.boosting);

    // the countdown: the platform's before the match, ours (3-2-1) after a goal
    let count = null;
    if (kind === 'starting') {
      const left = (room.match.startsAt || 0) - this.ow.now();
      count = left > 0 ? String(Math.ceil(left / 1000)) : 'GO';
    } else if (kind === 'playing' && g && g.phase === 'kick') {
      const left = g.until - room.matchNow();
      count = left > 0 ? String(Math.ceil(left / 1000)) : 'GO';
    } else if (now < this.goUntil) count = 'GO';
    if (count !== this.lastCount) {
      this.lastCount = count;
      if (count && count !== 'GO') this.sound.beep(Number(count));
    }
    ui.countdown(count, count === 'GO' ? '#ffd23d' : '#ffffff');

    if (!lobby && g) {
      ui.setScore(g.sc[0], g.sc[1]);
      const left = g.phase === 'play' ? Math.max(0, g.endsAt - room.matchNow()) : g.left;
      if (g.ot) ui.setClock('OT', 'ot');
      else ui.setClock(clockText(left), left < 30000 ? 'low' : '');
    } else if (!lobby) {
      ui.setScore(0, 0);
      const dur = settingValue(room.settings, 'time');
      ui.setClock(clockText(dur * 1000));
    }

    // the goal, stated: a line under the clock around every kickoff, for the player who has a side
    const tm = g ? this.myTeam(g) : room.me.team;
    if (!lobby && !spectating && tm && (kind === 'starting' || (g && (g.phase === 'kick' || now < this.bannerUntil)))) {
      const opp = TEAMS[3 - tm];
      ui.setBanner(`SCORE IN ${opp.name} GOAL`, hex(opp.glow));
    } else ui.setBanner('', '');
  }

  updateTags(kind, g) {
    const ui = this.ui;
    const view = this.view;
    const room = this.room;
    const lobby = kind === 'lobby';
    const myCar = this.myCar;
    ui.beginTags();
    let arrow = false;
    for (const c of this.world.cars) {
      if (!c.visible) continue;
      const isMe = myCar === c;
      view.project(c.x, c.y + 2.5, c.z, this.proj);
      if (isMe) {
        const showArrow = this.arrowWanted(kind, g);
        if (showArrow && this.proj.on) {
          arrow = true;
          ui.setArrow(true, this.proj.x, this.proj.y + 10, hex(TEAMS[c.team].glow));
        }
        continue;
      }
      if (!this.proj.on || this.proj.depth > 1) continue;
      const cam = view.rig;
      const dist = Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z);
      const alpha = clamp(1.25 - dist / 75, 0.35, 1);
      const pl = room.players.get(c.id);
      ui.tag(c.id, c.name || 'Player', c.team, this.proj.x, this.proj.y, alpha, lobby && !!pl && pl.ready === true, c.bot ? null : this.avatars.url(c.id));
    }
    if (!arrow) ui.setArrow(false, 0, 0, '#fff');
    ui.endTags();
  }

  /** An arrow over your own car around a kickoff, so you find yourself. */
  arrowWanted(kind, g) {
    if (this.spectating) return false;
    if (kind === 'starting') return true;
    if (kind === 'playing' && g && (g.phase === 'kick' || performance.now() < this.goUntil + 1200)) return true;
    return false;
  }

  updateMusic() {
    const s = this.sound;
    const car = this.myCar;
    if (this.mode === 'title') {
      s.setMusic('menu');
      s.setBoost(false);
      s.engine(0, 0, false);
      return;
    }
    const k = this.kind;
    s.setMusic(k === 'playing' || k === 'starting' ? 'play' : 'menu');
    if (car && !this.spectating && (k === 'lobby' || k === 'playing')) {
      const speed = Math.hypot(car.vx, car.vz) / CARP.boostMax;
      s.setBoost(car.boosting);
      s.engine(clamp(speed, 0, 1), clamp(Math.abs(this.input.thr), 0, 1), !this.world.frozen);
    } else {
      s.setBoost(false);
      s.engine(0, 0, false);
    }
  }

  // ================================================================ the room closed

  onClose(reason) {
    if (reason === 'left' || reason === 'moved') return;
    const text = reason === 'kicked' ? 'YOU WERE REMOVED' : reason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : 'DISCONNECTED';
    const button = reason === 'disconnected' ? 'REJOIN' : reason === 'replaced' ? 'PLAY HERE' : 'PLAY';
    this.ui.showClosed(text, button, async () => {
      this.ui.hideClosed();
      try {
        const room = await this.ow.rooms.join(JOIN_OPTIONS);
        this.mode = 'play';
        this.attachRoom(room);
        this.room.hideLobby?.(false);
        const w = this.world;
        for (const c of [...w.cars]) w.removeCar(c.id);
        w.kickoff();
      } catch (e) {
        this.ui.showClosed('NO CONNECTION', 'RETRY', () => this.onClose('disconnected'));
      }
    });
  }
}
