// The interface, as DOM over the canvas: title, lobby settings, the in-game HUD, name tags, callouts, countdown and the
// results podium. Names and everything else that comes from other players is set with textContent, never innerHTML.

import { TEAMS } from '../render/palette.js';

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const RING = 2 * Math.PI * 40;
const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH'];

/** Puts a player's face (or their initial while it loads, or when there is none) into a circle. */
function setAvatar(el, url, name) {
  const initial = (String(name || '?').trim()[0] || '?').toUpperCase();
  const key = url ? `u:${url}` : `i:${initial}`;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  if (!url) {
    el.textContent = initial;
    return;
  }
  const img = document.createElement('img');
  img.crossOrigin = 'anonymous';
  img.alt = '';
  img.draggable = false;
  img.onerror = () => {
    el.textContent = initial;
  };
  img.src = url;
  el.textContent = '';
  el.appendChild(img);
}

export class UI {
  /** `handlers`: onPlay(), onSetting(id, value), onCam(), onInvite(). */
  constructor(root, handlers) {
    this.root = root;
    this.hd = handlers;
    this.callUntil = 0;
    this.bannerUntil = 0;
    this.countText = '';
    this.scores = [-1, -1];
    this.tagMap = new Map();
    this.settingEls = new Map();
    this.lastBoost = -1;
    this.reduced = false;
    root.textContent = '';

    // title
    this.title = h('div', 'title');
    const logo = h('div', 'logo');
    logo.append(h('div', 'a outline', 'ROCKET CAR'), h('div', 'b', 'SOCCER'), h('div', 'bar'));
    this.play = h('button', 'play');
    this.play.type = 'button';
    this.play.append('PLAY', h('small', '', 'ENTER'));
    this.title.append(logo, this.play);
    this.title.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handlers.onPlay();
    });
    this.play.addEventListener('click', () => handlers.onPlay()); // Enter or Space on the focused button

    // hud
    this.hud = h('div', 'hud');
    this.score = h('div', 'score');
    const sb = h('div', 'side b');
    this.numB = h('span', 'num', '0');
    this.youB = h('span', 'you-tag b', 'YOU');
    this.youB.hidden = true;
    sb.append(h('span', 'sym t1'), this.numB);
    this.clock = h('div', 'mid', '0:00');
    const so = h('div', 'side o');
    this.numO = h('span', 'num', '0');
    this.youO = h('span', 'you-tag o', 'YOU');
    this.youO.hidden = true;
    so.append(this.numO, h('span', 'sym t2'));
    this.score.append(sb, this.clock, so, this.youB, this.youO);

    this.boost = h('div', 'boost');
    this.boost.innerHTML =
      '<svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="40"></circle><circle class="fill" cx="50" cy="50" r="40"></circle></svg>';
    this.boostFill = this.boost.querySelector('.fill');
    this.boostFill.style.strokeDasharray = `${RING}`;
    this.boostVal = h('div', 'val outline');
    this.boostNum = h('span', '', '33');
    this.boostVal.append(this.boostNum, h('i', '', 'BOOST'));
    this.boost.appendChild(this.boostVal);

    this.cam = h('button', 'cam');
    this.cam.type = 'button';
    this.cam.append(h('span', '', 'BALL CAM'), h('span', 'key', 'C'));
    this.cam.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handlers.onCam();
    });
    this.watching = h('div', 'watching', 'WATCHING');
    this.tags = h('div', 'tags');
    this.arrow = h('div', 'arrow');
    this.arrow.appendChild(h('i'));
    this.arrow.hidden = true;
    this.callout = h('div', 'callout');
    this.callBig = h('div', 'big outline');
    this.callSub = h('div', 'sub outline');
    this.callSub2 = h('div', 'sub2 outline');
    this.callout.append(this.callBig, this.callSub, this.callSub2);
    this.callout.hidden = true;
    this.count = h('div', 'count outline');
    this.count.hidden = true;
    this.banner = h('div', 'banner');
    this.banner.hidden = true;
    this.flashEl = h('div', 'flash');
    this.hud.append(this.tags, this.score, this.boost, this.cam, this.watching, this.arrow, this.callout, this.count, this.banner, this.flashEl);

    // lobby
    this.lobby = h('div', 'lobby');
    this.settings = h('div', 'settings');
    this.invite = h('button', 'invite', '+ INVITE');
    this.invite.type = 'button';
    this.invite.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handlers.onInvite();
    });
    this.invite.hidden = true;
    this.hint = h('div', 'hint outline', '');
    this.legend = h('div', 'legend outline');
    this.legendItems = {};
    for (const [id, keys, label] of [['drive', 'W A S D', 'DRIVE'], ['jump', 'SPACE', 'JUMP'], ['boost', 'SHIFT', 'BOOST']]) {
      const it = h('div', 'item');
      it.append(h('kbd', '', keys), h('span', '', label));
      this.legend.appendChild(it);
      this.legendItems[id] = it;
    }
    this.lobby.append(this.settings, this.invite, this.hint, this.legend);

    this.results = null;
    this.closed = null;
    root.append(this.hud, this.lobby, this.title);
    this.showTitle(false);
    this.showHud(false);
    this.showLobby(false);
  }

  // ------------------------------------------------------------ switches

  showTitle(on) {
    this.title.hidden = !on;
  }

  showHud(on) {
    this.hud.hidden = !on;
  }

  showLobby(on) {
    this.lobby.hidden = !on;
  }

  setTouch(on) {
    this.root.classList.toggle('touch', !!on);
  }

  setSpectating(on) {
    this.root.classList.toggle('spectating', !!on);
    this.watching.hidden = !on;
    this.boost.hidden = !!on;
    this.cam.hidden = !!on;
  }

  setReduced(on) {
    this.reduced = !!on;
    document.body.classList.toggle('reduced', !!on);
  }

  // ------------------------------------------------------------ the hud

  setScore(b, o) {
    if (this.scores[0] !== b) {
      this.numB.textContent = String(b);
      if (this.scores[0] >= 0 && b > this.scores[0]) this.bump(this.numB);
      this.scores[0] = b;
    }
    if (this.scores[1] !== o) {
      this.numO.textContent = String(o);
      if (this.scores[1] >= 0 && o > this.scores[1]) this.bump(this.numO);
      this.scores[1] = o;
    }
  }

  /** Marks your side on the scoreboard (1 blue, 2 orange, 0 for none). */
  setMyTeam(team) {
    this.youB.hidden = team !== 1;
    this.youO.hidden = team !== 2;
  }

  bump(el) {
    if (this.reduced) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /** `mode`: '' | 'ot' | 'low'. */
  setClock(text, mode = '') {
    if (this.clock.textContent !== text) this.clock.textContent = text;
    const cls = `mid ${mode}`.trim();
    if (this.clock.className !== cls) this.clock.className = cls;
  }

  setBoost(v, boosting) {
    const r = Math.round(v);
    if (r === this.lastBoost && boosting === this.lastBoosting) return;
    this.lastBoost = r;
    this.lastBoosting = boosting;
    this.boostNum.textContent = String(r);
    this.boostFill.style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(100, v)) / 100));
    this.boost.className = `boost${boosting ? ' on' : ''}${r < 8 ? ' empty' : ''}`;
  }

  setCam(on) {
    this.cam.classList.toggle('on', !!on);
    this.cam.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** A big word in the middle of the screen for `ms`. */
  say(big, sub = '', color = '#fff', ms = 1800, sub2 = '', small = false) {
    this.callBig.textContent = big;
    this.callBig.style.color = color;
    this.callSub.textContent = sub;
    this.callSub.style.display = sub ? '' : 'none';
    this.callSub2.textContent = sub2;
    this.callSub2.style.display = sub2 ? '' : 'none';
    this.callout.className = `callout${small ? ' small' : ''}`;
    this.callout.hidden = false;
    if (!this.reduced) {
      void this.callout.offsetWidth;
      this.callout.classList.add('pop');
    }
    this.callUntil = performance.now() + ms;
  }

  hideSay() {
    this.callout.hidden = true;
    this.callUntil = 0;
  }

  /** The big 3-2-1-GO: pass the text, or null to clear. */
  countdown(text, color = '#fff') {
    if (text === null || text === undefined) {
      if (!this.count.hidden) this.count.hidden = true;
      this.countText = '';
      return;
    }
    if (text === this.countText && !this.count.hidden) return;
    this.countText = text;
    this.count.textContent = text;
    this.count.style.color = color;
    this.count.hidden = false;
    this.count.classList.remove('pop');
    if (!this.reduced) {
      void this.count.offsetWidth;
      this.count.classList.add('pop');
    }
  }

  /** A short line under the clock, for the goal: "SCORE IN ORANGE GOAL". */
  setBanner(text, color) {
    if (!text) {
      this.banner.hidden = true;
      return;
    }
    if (this.banner.textContent !== text) {
      this.banner.textContent = text;
      this.banner.style.borderBottomColor = color || '#ffd23d';
      this.banner.hidden = false;
      this.banner.style.animation = 'none';
      void this.banner.offsetWidth;
      this.banner.style.animation = '';
    } else this.banner.hidden = false;
  }

  flash() {
    if (this.reduced) return;
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  /** Housekeeping each frame: callouts that ran out. */
  tick(now) {
    if (this.callUntil && now > this.callUntil) this.hideSay();
  }

  // ------------------------------------------------------------ name tags

  beginTags() {
    for (const t of this.tagMap.values()) t.used = false;
  }

  /** One name tag at a screen position. `avatar` is a URL or null. */
  tag(id, name, team, x, y, alpha, ready, avatar) {
    let t = this.tagMap.get(id);
    if (!t) {
      const el = h('div', 'tag');
      const sym = h('span', 'sym');
      const av = h('span', 'av');
      const nm = h('span', 'nm');
      const rd = h('span', 'ready', 'READY');
      el.append(av, sym, nm, rd);
      this.tags.appendChild(el);
      t = { el, sym, av, nm, rd, team: 0, name: null, used: true, shown: true, ready: null };
      this.tagMap.set(id, t);
    }
    t.used = true;
    if (t.team !== team) {
      t.team = team;
      t.el.className = `tag t${team}`;
      t.sym.className = `sym t${team}`;
    }
    if (t.name !== name) {
      t.name = name;
      t.nm.textContent = name;
    }
    if (t.ready !== ready) {
      t.ready = ready;
      t.rd.hidden = !ready;
    }
    setAvatar(t.av, avatar, name);
    if (!t.shown) {
      t.el.style.display = '';
      t.shown = true;
    }
    t.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
    t.el.style.opacity = String(alpha);
  }

  endTags() {
    for (const [id, t] of this.tagMap) {
      if (t.used) continue;
      if (t.shown) {
        t.el.style.display = 'none';
        t.shown = false;
      }
      // a tag that hasn't been wanted for a while is dropped for good
      t.idle = (t.idle || 0) + 1;
      if (t.idle > 600) {
        t.el.remove();
        this.tagMap.delete(id);
      }
    }
    for (const t of this.tagMap.values()) if (t.used) t.idle = 0;
  }

  /** The arrow over your own car, or hidden. */
  setArrow(on, x, y, color) {
    this.arrow.hidden = !on;
    if (!on) return;
    this.arrow.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    this.arrow.firstChild.style.background = color;
  }

  // ------------------------------------------------------------ lobby

  /** `list`: [{ id, label, value, options: [{ value, label }] }]. The host can tap a value to step to the next one. */
  setSettings(list, isHost) {
    for (const s of list) {
      let e = this.settingEls.get(s.id);
      if (!e) {
        const btn = h('button', 'setting');
        btn.type = 'button';
        const lab = h('span', 'lab');
        const val = h('span', 'val outline');
        btn.append(lab, val);
        btn.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          if (!e.host) return;
          const i = e.options.findIndex((o) => o.value === e.value);
          const next = e.options[(i + 1) % e.options.length];
          this.hd.onSetting(s.id, next.value);
        });
        this.settings.appendChild(btn);
        e = { btn, lab, val, host: false, options: s.options, value: s.value };
        this.settingEls.set(s.id, e);
      }
      e.options = s.options;
      e.value = s.value;
      const opt = s.options.find((o) => o.value === s.value);
      const text = opt ? opt.label : String(s.value);
      if (e.val.textContent !== text) e.val.textContent = text;
      if (e.lab.textContent !== s.label) e.lab.textContent = s.label;
      if (e.host !== isHost) {
        e.host = isHost;
        e.btn.classList.toggle('host', isHost);
        e.btn.disabled = !isHost;
        e.btn.setAttribute('aria-label', isHost ? `${s.label}: ${text}. Change` : `${s.label}: ${text}`);
      }
    }
  }

  setHint(text) {
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  showInviteButton(on) {
    this.invite.hidden = !on;
  }

  setLegend(on) {
    this.legend.hidden = !on;
    this.legend.style.opacity = on ? '1' : '0';
  }

  legendUsed(id) {
    this.legendItems[id]?.classList.add('used');
  }

  // ------------------------------------------------------------ results

  /**
   * model: { head, color, score: [b, o], rows: [{ id, name, team, pts, mvp, you, avatar }], you: rank index or -1 }.
   * Rows are sorted best first. The top three stand on a podium; anyone lower is told their place.
   */
  showResults(model) {
    this.hideResults();
    const r = h('div', 'results');
    const head = h('div', 'head outline', model.head);
    head.style.color = model.color;
    const final = h('div', 'final outline');
    const nb = h('span', '', String(model.score[0]));
    nb.style.color = TEAMS[1].glowCss;
    const no = h('span', '', String(model.score[1]));
    no.style.color = TEAMS[2].glowCss;
    final.append(h('span', 'sym t1'), nb, h('span', 'dash', '-'), no, h('span', 'sym t2'));
    const pod = h('div', 'podium');
    const order = [1, 0, 2];
    for (const i of order) {
      const row = model.rows[i];
      if (!row) continue;
      const p = h('div', `pod p${i + 1} t${row.team}`);
      const av = h('div', 'av');
      setAvatar(av, row.avatar, row.name);
      const nm = h('div', 'nm outline', row.name);
      const step = h('div', 'step');
      step.append(h('span', '', String(row.pts)), h('small', '', 'PTS'));
      if (row.mvp) p.append(h('div', 'mvp', 'MVP'));
      p.append(av, nm, step);
      pod.appendChild(p);
    }
    r.append(head, final, pod);
    if (model.you >= 3) r.appendChild(h('div', 'you', `YOU: ${ORD[model.you] || `${model.you + 1}TH`}`));
    this.root.appendChild(r);
    this.results = r;
  }

  /** One message and one button, for a room that closed: you were removed, you moved to another tab, the connection went. */
  showClosed(text, button, onClick) {
    this.hideClosed();
    const c = h('div', 'closed');
    const msg = h('div', 'msg outline', text);
    const btn = h('button', 'play', button);
    btn.type = 'button';
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onClick();
    });
    c.append(msg, btn);
    this.root.appendChild(c);
    this.closed = c;
  }

  hideClosed() {
    if (this.closed) {
      this.closed.remove();
      this.closed = null;
    }
  }

  hideResults() {
    if (this.results) {
      this.results.remove();
      this.results = null;
    }
  }
}
