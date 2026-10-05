// Player input: keyboard plus the platform's touch controls, boiled down to what a car takes each step.
// W A S D / arrows drive, Space jumps, Shift boosts, C switches ball cam, holding R puts a stuck car back. On a phone the
// platform draws an analog stick (steer and throttle) and the Jump, Boost and Ball cam buttons, which also press keys.

const DEADZONE = 0.12;
const JUMP_DEDUPE_MS = 70; // a key and the touch poll can both report one press
const CAM_DEDUPE_MS = 220;
const RESET_HOLD_MS = 900;

export class Input {
  constructor(ow) {
    this.ow = ow;
    this.keys = new Set();
    this.jumpQueued = false;
    this.camToggled = false;
    this.resetQueued = false;
    this.enter = false;
    this.rDown = 0; // when R went down: held for a moment, it puts a stuck car back
    this.lastJump = -1e9;
    this.lastCam = -1e9;
    this.prevPadJump = false;
    this.prevPadCam = false;
    this.used = { drive: false, jump: false, boost: false };
    // read by the car each step
    this.thr = 0;
    this.steer = 0;
    this.boost = false;
    this.onKey = (e) => this.key(e, true);
    this.onKeyUp = (e) => this.key(e, false);
    this.onBlur = () => {
      this.keys.clear();
      this.rDown = 0;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  key(e, down) {
    const code = e.code || '';
    if (down) {
      if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(code);
      if (code === 'Space') this.queueJump();
      else if (code === 'KeyC') this.toggleCam();
      else if (code === 'KeyR') this.rDown = performance.now();
      else if (code === 'Enter') this.enter = true;
    } else {
      this.keys.delete(code);
      if (code === 'KeyR') this.rDown = 0;
    }
  }

  queueJump() {
    const t = performance.now();
    if (t - this.lastJump < JUMP_DEDUPE_MS) return;
    this.lastJump = t;
    this.jumpQueued = true;
  }

  toggleCam() {
    const t = performance.now();
    if (t - this.lastCam < CAM_DEDUPE_MS) return;
    this.lastCam = t;
    this.camToggled = true;
  }

  /** Reads the keys and the stick once per frame; the values stay until the next call. */
  poll() {
    const k = this.keys;
    let thr = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let boost = k.has('ShiftLeft') || k.has('ShiftRight');
    const c = this.ow.controls;
    try {
      if (c) {
        const s = c.stick;
        if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) {
          const sx = Math.abs(s.x) < DEADZONE ? 0 : s.x;
          const sy = Math.abs(s.y) < DEADZONE ? 0 : s.y;
          thr += -sy;
          steer += sx;
        }
        if (c.pressed) {
          if (c.pressed('boost')) boost = true;
          const pj = !!c.pressed('jump');
          if (pj && !this.prevPadJump) this.queueJump();
          this.prevPadJump = pj;
          const pc = !!c.pressed('cam');
          if (pc && !this.prevPadCam) this.toggleCam();
          this.prevPadCam = pc;
        }
      }
    } catch (e) {
      // controls are optional: keep the keyboard
    }
    if (this.rDown && performance.now() - this.rDown > RESET_HOLD_MS) {
      this.rDown = 0;
      this.resetQueued = true;
    }
    this.thr = thr < -1 ? -1 : thr > 1 ? 1 : thr;
    this.steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
    this.boost = boost;
    if (this.thr !== 0 || this.steer !== 0) this.used.drive = true;
    if (boost) this.used.boost = true;
  }

  takeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    if (j) this.used.jump = true;
    return j;
  }

  takeCam() {
    const c = this.camToggled;
    this.camToggled = false;
    return c;
  }

  takeReset() {
    const r = this.resetQueued;
    this.resetQueued = false;
    return r;
  }

  takeEnter() {
    const e = this.enter;
    this.enter = false;
    return e;
  }

  /** Forget anything pressed (a screen changed). */
  flush() {
    this.rDown = 0;
    this.jumpQueued = false;
    this.camToggled = false;
    this.resetQueued = false;
    this.enter = false;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
