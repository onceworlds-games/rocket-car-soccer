// The 3D view: renderer, scene, camera and every drawn thing, driven each frame from the simulation's state. Nothing here
// decides anything; it draws what the world says and turns events (a hit, a goal, a pad) into sparks and light.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BALL_R, PX } from '../sim/consts.js';
import { clamp } from '../sim/rng.js';
import { buildStage } from './stage.js';
import { CarView } from './cars.js';
import { BallView } from './ballview.js';
import { Fx } from './fx.js';
import { CameraRig } from './rig.js';
import { TEAMS } from './palette.js';

const SHADOW_SIZE = { low: 0, medium: 1024, high: 2048 };
const _v = new THREE.Vector3();

export class View {
  /**
   * `canvas` is the one full-window canvas. `quality` is 'low' | 'medium' | 'high'. In `poster` mode the buffer is kept so the
   * frame can be read back, and the random numbers are seeded so the same frame is drawn every time.
   */
  constructor(canvas, { quality = 'high', poster = false, rand = Math.random } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.poster = poster;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: poster });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = SHADOW_SIZE[quality] > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x05070f, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1224, 130, 340);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.3, 900);
    this.rig = new CameraRig();

    try {
      const pm = new THREE.PMREMGenerator(r);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.3;
      pm.dispose();
    } catch (e) {
      // no float render targets here: the scene is lit without reflections
    }

    this.stage = buildStage({ quality });
    this.scene.add(this.stage.root);
    this.stage.setShadowSize(SHADOW_SIZE[quality]);
    this.fx = new Fx(this.scene, quality, rand);
    this.ball = new BallView();
    for (const o of this.ball.objects) this.scene.add(o);
    this.ball.setShadows(SHADOW_SIZE[quality] > 0);
    this.views = new Map();
    this.time = 0;
    this.slow = 1; // visual slow motion for effects and the camera: 1 normal
    this.width = 1;
    this.height = 1;
    this.lastFov = 0;
    this.meId = null;
    this.lastTeam = 0;
    this.focus = { x: 0, z: 0 };
    this.flash = 0;
    this._ex = new THREE.Vector3();
    document.addEventListener('visibilitychange', () => {
      this.dtSkip = true;
    });
  }

  setQuality(q) {
    this.quality = q;
    const size = SHADOW_SIZE[q] ?? 0;
    this.renderer.shadowMap.enabled = size > 0;
    this.stage.setShadowSize(size);
    this.ball.setShadows(size > 0);
    for (const v of this.views.values()) v.setShadowBlob(size === 0);
  }

  resize(cssW, cssH, pixelRatio) {
    this.width = Math.max(1, cssW);
    this.height = Math.max(1, cssH);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.fx.resize(this.height * pixelRatio, this.camera.fov);
    this.pr = pixelRatio;
  }

  /** Keeps one view per car in the world: makes the new ones, drops the gone ones. */
  syncCars(world, meId) {
    this.meId = meId;
    for (const c of world.cars) {
      let v = this.views.get(c.id);
      if (!v || v.car !== c) {
        if (v) this.dropCar(c.id);
        v = new CarView(c, c.id === meId);
        v.setShadowBlob(!this.renderer.shadowMap.enabled);
        this.views.set(c.id, v);
        this.scene.add(v.group);
      }
    }
    if (this.views.size !== world.cars.length || world.cars.some((c) => !this.views.has(c.id))) {
      for (const id of [...this.views.keys()]) if (!world.byId.has(id)) this.dropCar(id);
    }
  }

  dropCar(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    v.dispose();
    this.views.delete(id);
  }

  view(id) {
    return this.views.get(id) ?? null;
  }

  /** Where a world point lands on screen, in CSS pixels: { x, y, depth, on }. */
  project(x, y, z, out) {
    _v.set(x, y, z).project(this.camera);
    out.x = (_v.x * 0.5 + 0.5) * this.width;
    out.y = (-_v.y * 0.5 + 0.5) * this.height;
    out.depth = _v.z;
    out.on = _v.z > -1 && _v.z < 1 && out.x > -60 && out.x < this.width + 60 && out.y > -60 && out.y < this.height + 60;
    return out;
  }

  /** One frame. `dt` real seconds, `alpha` how far between fixed steps, `world` the simulation. */
  render(dt, alpha, world) {
    if (this.dtSkip) {
      dt = 0;
      this.dtSkip = false;
    }
    dt = Math.min(dt, 0.1);
    const vdt = dt * this.slow; // effects and the camera feel slow motion; the simulation does not
    this.time += vdt;
    const cam = this.camera;
    const rig = this.rig;
    this.stage.update(this.time, this.height * (this.pr || 1));
    this.stage.updatePads(world.pads, this.time);
    for (const v of this.views.values()) {
      v.update(vdt, alpha, this.time);
      const c = v.car;
      if (c.boosting && c.visible) {
        const e = v.exhaustWorld(this._ex);
        this.fx.flame(e.x, e.y, e.z, -Math.cos(v.hh), -Math.sin(v.hh), c.vx, c.vz);
      }
      if (c.ss && c.visible) {
        const t = TEAMS[c.team];
        this.fx.trail(v.x - Math.cos(v.hh) * 1.2, v.y - 0.2, v.z - Math.sin(v.hh) * 1.2, t ? t.glow : 0xffffff);
      }
    }
    const b = world.ball;
    this.ball.update(vdt, alpha, b, this.lastTeam);
    if (Math.hypot(b.vx, b.vy, b.vz) > 30) {
      const t = TEAMS[this.lastTeam];
      this.fx.trail(this.ball.x, this.ball.y, this.ball.z, t ? t.glow : 0xdfe8ff, 1.5);
    }
    this.fx.update(vdt);

    cam.position.set(rig.px, rig.py, rig.pz);
    cam.up.set(0, 1, 0);
    cam.lookAt(rig.tx, rig.ty, rig.tz);
    if (rig.roll) cam.rotateZ(rig.roll);
    if (Math.abs(cam.fov - rig.fov) > 0.01) {
      cam.fov = rig.fov;
      cam.updateProjectionMatrix();
      this.fx.resize(this.height * (this.pr || 1), cam.fov);
    }
    this.stage.focusSun(this.focus.x, this.focus.z);
    this.renderer.render(this.scene, cam);
  }

  // ------------------------------------------------------------ events turned into light and sparks

  /** The ball was hit: sparks scaled by how hard. */
  hitFx(x, y, z, power, team) {
    const t = TEAMS[team];
    const hex = t ? t.glow : 0xffffff;
    this.fx.burst(x, y, z, clamp(power * 0.9, 6, 34), 6 + power * 0.18, 0xfff0c8, 0.2, 0.5, 12, 0.2);
    this.fx.burst(x, y, z, clamp(power * 0.4, 3, 14), 4 + power * 0.1, hex, 0.3, 0.6, 8, 0.2);
    if (power > 34) this.fx.ring(x, Math.max(0.15, y - BALL_R + 0.15), z, hex, 1.2, 5 + power * 0.08, 0.35, 'floor', 0.7);
  }

  wallFx(x, y, z, power) {
    this.fx.burst(x, y, z, clamp(power * 0.6, 3, 16), 3 + power * 0.1, 0xdfe8ff, 0.16, 0.4, 14, 0.1);
  }

  landFx(x, z, impact) {
    this.fx.dust(x, z, clamp(impact * 0.6, 3, 10), clamp(impact / 14, 0.4, 1.2));
  }

  padFx(x, z, big) {
    this.fx.burst(x, 0.5, z, big ? 40 : 14, big ? 9 : 5, 0xffc93a, 0.22, 0.8, -4, 1.2);
    if (big) this.fx.ring(x, 0.15, z, 0xffc93a, 1, 6, 0.6, 'floor', 0.8);
  }

  jumpFx(x, z, power = 1) {
    this.fx.dust(x, z, 5, power);
  }

  /** A goal in the net on side `sx` (+1 is the orange goal, so blue scored): explosion, rings, beam, sparks and confetti. */
  goalFx(team, bp) {
    const t = TEAMS[team];
    const hex = t.glow;
    const sx = bp[0] > 0 ? 1 : -1;
    const x = sx * (PX + 2.5);
    this.fx.ring(x, 3, bp[2] * 0.6, hex, 1.5, 24, 1.1, 'x', 1);
    this.fx.ring(x, 0.2, bp[2] * 0.6, hex, 2, 36, 1.4, 'floor', 0.9);
    this.fx.burst(x - sx * 1.5, Math.max(1.8, bp[1]), bp[2], 130, 28, hex, 0.3, 1.3, 14, 0.4);
    this.fx.burst(x - sx * 1.5, Math.max(1.8, bp[1]), bp[2], 80, 20, 0xffffff, 0.22, 1.0, 14, 0.4);
    this.fx.beam(x, bp[2] * 0.6, hex, 3.4, 2.0, 0.55);
    this.fx.beam(x, bp[2] * 0.6, 0xffffff, 1.4, 1.4, 0.5);
    this.fx.confetti(sx * (PX - 3), 11, bp[2] * 0.5, 130, 13, 11);
    this.flash = 1;
  }

  /** The winning side: confetti over the pitch and beams in its colour. */
  winFx(team) {
    const t = TEAMS[team] || TEAMS[1];
    this.fx.confetti(0, 16, 0, 160, 24, 8);
    this.fx.beam(-14, -8, t.glow, 2.2, 3, 0.4);
    this.fx.beam(14, 8, t.glow, 2.2, 3, 0.4);
  }

  /** Speed of the camera's reaction to a hard moment. */
  shake(amount) {
    this.rig.addTrauma(amount);
  }

  setReduced(on) {
    this.rig.shakeOn = !on;
    this.rig.fovKick = !on;
    this.fx.reduced = on;
  }

  dispose() {
    this.renderer.dispose();
  }
}

