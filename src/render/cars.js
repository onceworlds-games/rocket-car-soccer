// A car on screen: a chunky low-poly sports car with a wedge nose, a cabin, a wing, four wheels that spin and steer, the
// team colour with the player's own accent stripe, a rocket flame at the back and a light under it. All cars share their
// geometry; each has two or three meshes of its own. Parts that never move relative to each other are merged.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACCENTS, CARP } from '../sim/consts.js';
import { wrapPi, clamp } from '../sim/rng.js';
import { TEAMS } from './palette.js';
import { glowTexture } from './stage.js';

const WHEEL_R = 0.42;
const TAU = Math.PI * 2;

const ni = (g) => (g.index ? g.toNonIndexed() : g);

function extrudeProfile(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

function box(w, h, d, x, y, z) {
  return ni(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
}

function colored(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

let shared = null;

/** Geometry and materials every car uses, built once. */
function parts() {
  if (shared) return shared;
  const body = extrudeProfile(
    [
      [-1.6, -0.38],
      [1.6, -0.38],
      [1.63, -0.12],
      [1.0, 0.1],
      [0.62, 0.14],
      [-1.45, 0.17],
      [-1.6, 0.02],
    ],
    1.8,
  );
  const wing = [box(0.6, 0.07, 1.74, -1.5, 0.56, 0), box(0.1, 0.34, 0.1, -1.44, 0.37, 0.52), box(0.1, 0.34, 0.1, -1.44, 0.37, -0.52), box(0.62, 0.22, 0.05, -1.5, 0.6, 0.88), box(0.62, 0.22, 0.05, -1.5, 0.6, -0.88)];
  const paint = mergeGeometries([ni(body), ...wing.map(ni)]);

  const cabin = extrudeProfile(
    [
      [-0.78, 0.14],
      [-0.42, 0.6],
      [0.4, 0.6],
      [0.82, 0.14],
    ],
    1.5,
  );
  const trim = mergeGeometries([
    colored(ni(cabin), 0x0c1220),
    colored(box(3.0, 0.14, 1.7, 0, -0.43, 0), 0x07090f),
    colored(box(2.0, 0.2, 0.06, 0.1, -0.3, 0.9), 0x10151f),
    colored(box(2.0, 0.2, 0.06, 0.1, -0.3, -0.9), 0x10151f),
    colored(box(0.14, 0.14, 1.5, 1.62, -0.32, 0), 0x07090f),
  ].map(ni));

  const top = [
    [-1.45, 0.17],
    [-0.78, 0.17],
    [-0.42, 0.61],
    [0.4, 0.61],
    [0.82, 0.15],
    [1.0, 0.11],
    [1.63, -0.11],
  ];
  const band = [...top.map(([x, y]) => [x, y + 0.016]), ...top.map(([x, y]) => [x, y - 0.07]).reverse()];
  const stripe = extrudeProfile(band, 0.36);

  const tire = (z) => colored(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.36, 18).rotateX(Math.PI / 2).translate(0, 0, z), 0x0a0b10);
  const rim = (z) => colored(new THREE.CylinderGeometry(0.27, 0.27, 0.39, 8).rotateX(Math.PI / 2).translate(0, 0, z), 0xc9cfdc);
  const wheels = mergeGeometries([tire(0.87), tire(-0.87), rim(0.87), rim(-0.87)]);

  const lights = mergeGeometries([
    colored(box(0.08, 0.12, 0.36, 1.62, -0.22, 0.5), 0xfff2cc),
    colored(box(0.08, 0.12, 0.36, 1.62, -0.22, -0.5), 0xfff2cc),
    colored(box(0.08, 0.1, 0.42, -1.62, 0.06, 0.52), 0xff2a2a),
    colored(box(0.08, 0.1, 0.42, -1.62, 0.06, -0.52), 0xff2a2a),
  ].map(ni));

  const flameOuter = new THREE.ConeGeometry(0.36, 2.6, 12, 1, true).translate(0, 1.3, 0).rotateZ(Math.PI / 2);
  const flameInner = new THREE.ConeGeometry(0.2, 1.7, 10, 1, true).translate(0, 0.85, 0).rotateZ(Math.PI / 2);
  const glowGeom = new THREE.PlaneGeometry(3.1, 1.75).rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(2.3, 2.6, 48).rotateX(-Math.PI / 2);
  const blob = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const glow = glowTexture([[0, 'rgba(255,255,255,0.9)'], [0.6, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const shadowTex = glowTexture([[0, 'rgba(0,0,0,0.55)'], [0.65, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]);

  shared = {
    geom: { paint, trim, stripe, wheels, lights, flameOuter, flameInner, glow: glowGeom, ring, blob },
    mat: {
      trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.6, flatShading: true }),
      wheels: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, flatShading: true }),
      lights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      flameOuter: new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      flameInner: new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      blob: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }),
    },
    glowTex: glow,
    paint: new Map(),
    accent: new Map(),
    under: new Map(),
    ring: new Map(),
  };
  return shared;
}

function paintMaterial(team) {
  const s = parts();
  let m = s.paint.get(team);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: TEAMS[team]?.hex ?? 0x888888, roughness: 0.32, metalness: 0.4, flatShading: true });
    s.paint.set(team, m);
  }
  return m;
}

function accentMaterial(hex) {
  const s = parts();
  let m = s.accent.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.4, metalness: 0.2, emissive: new THREE.Color(hex), emissiveIntensity: 0.28, flatShading: true });
    s.accent.set(hex, m);
  }
  return m;
}

function glowMaterial(map, team, opacity, key) {
  const s = parts();
  const cache = s[key];
  let m = cache.get(team);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(TEAMS[team]?.glow ?? 0xffffff), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    cache.set(team, m);
  }
  return m;
}

const _euler = new THREE.Euler(0, 0, 0, 'XYZ');
const _qFlip = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export class CarView {
  /** `me`: this page's own car (it gets a ring on the floor and a brighter glow). */
  constructor(car, me = false) {
    const s = parts();
    this.car = car;
    this.me = me;
    this.group = new THREE.Group(); // at the car's position, turned to its heading: the ring and shadow hang from it on the floor
    this.root = new THREE.Group(); // the car itself, tilted, flipped and squashed
    this.group.add(this.root);

    const accent = ACCENTS[car.accent % ACCENTS.length];
    this.paint = new THREE.Mesh(s.geom.paint, paintMaterial(car.team));
    this.trim = new THREE.Mesh(s.geom.trim, s.mat.trim);
    this.stripe = new THREE.Mesh(s.geom.stripe, accentMaterial(accent));
    this.lights = new THREE.Mesh(s.geom.lights, s.mat.lights);
    for (const m of [this.paint, this.trim, this.stripe]) m.castShadow = true;
    this.front = new THREE.Group();
    this.front.position.set(1.0, -0.18, 0);
    this.rear = new THREE.Group();
    this.rear.position.set(-1.0, -0.18, 0);
    this.wheelF = new THREE.Mesh(s.geom.wheels, s.mat.wheels);
    this.wheelR = new THREE.Mesh(s.geom.wheels, s.mat.wheels);
    this.wheelF.castShadow = this.wheelR.castShadow = true;
    this.front.add(this.wheelF);
    this.rear.add(this.wheelR);
    this.under = new THREE.Mesh(s.geom.glow, glowMaterial(s.glowTex, car.team, me ? 0.7 : 0.5, 'under').clone());
    this.under.position.y = -0.52;
    this.flame = new THREE.Group();
    this.flame.position.set(-1.62, -0.02, 0);
    this.flame.add(new THREE.Mesh(s.geom.flameOuter, s.mat.flameOuter), new THREE.Mesh(s.geom.flameInner, s.mat.flameInner));
    this.flame.visible = false;
    this.root.add(this.paint, this.trim, this.stripe, this.lights, this.front, this.rear, this.under, this.flame);

    this.blob = new THREE.Mesh(s.geom.blob, s.mat.blob.clone());
    this.blob.scale.set(4.2, 1, 2.6);
    this.blob.position.y = 0.045;
    this.blob.renderOrder = 1;
    this.group.add(this.blob);
    this.ring = null;
    if (me) {
      this.ring = new THREE.Mesh(s.geom.ring, glowMaterial(null, car.team, 0.9, 'ring').clone());
      this.ring.position.y = 0.07;
      this.ring.renderOrder = 2;
      this.group.add(this.ring);
    }

    this.spin = 0;
    this.steerVis = 0;
    this.pitchVis = 0;
    this.rollVis = 0;
    this.lastH = car.h;
    this.flameLevel = 0;
    this.squash = 0;
    this.x = car.x;
    this.y = car.y;
    this.z = car.z;
    this.hh = car.h;
    this.exhaust = new THREE.Vector3(-1.9, -0.02, 0);
  }

  /** A hard landing or a kick squashes the car for a moment. */
  pulse(amount) {
    this.squash = Math.max(this.squash, clamp(amount, 0, 1));
  }

  setShadowBlob(on) {
    this.blob.visible = on;
  }

  /** World position of the exhaust, into `out`. */
  exhaustWorld(out) {
    this.group.updateMatrixWorld(true);
    return out.copy(this.exhaust).applyMatrix4(this.root.matrixWorld);
  }

  update(dt, alpha, time) {
    const c = this.car;
    const k = c.kind === 'remote' ? 1 : alpha;
    this.x = c.px + (c.x - c.px) * k;
    this.y = c.py + (c.y - c.py) * k;
    this.z = c.pz + (c.z - c.pz) * k;
    this.hh = c.ph + wrapPi(c.h - c.ph) * k;
    const pitch = c.pp + (c.p - c.pp) * k;
    this.group.visible = c.visible;
    this.group.position.set(this.x, this.y, this.z);

    const cosH = Math.cos(this.hh);
    const sinH = Math.sin(this.hh);
    const vf = c.vx * cosH + c.vz * sinH;
    const speedFrac = clamp(Math.abs(vf) / CARP.boostMax, 0, 1);
    if (dt > 0) {
      this.spin += (c.ground ? vf : vf * 0.4) * (dt / WHEEL_R);
      const yawRate = wrapPi(this.hh - this.lastH) / dt;
      const steerTarget = c.ground ? clamp(yawRate / 2.4, -1, 1) * (vf >= -0.5 ? 1 : -1) : 0;
      this.steerVis += (steerTarget - this.steerVis) * Math.min(1, dt * 14);
      this.pitchVis += (pitch - this.pitchVis) * Math.min(1, dt * 16);
      const rollTarget = c.ground ? -this.steerVis * speedFrac * 0.09 : 0;
      this.rollVis += (rollTarget - this.rollVis) * Math.min(1, dt * 8);
      this.squash = Math.max(0, this.squash - dt * 4.5);
      const flameTarget = c.boosting ? 1 : 0;
      this.flameLevel += (flameTarget - this.flameLevel) * Math.min(1, dt * (flameTarget > this.flameLevel ? 22 : 9));
    }
    this.lastH = this.hh;

    this.group.rotation.set(0, -this.hh, 0);
    _euler.set(this.rollVis, 0, this.pitchVis, 'XYZ');
    this.root.quaternion.setFromEuler(_euler);
    if (c.dodge > 0) {
      const p = clamp(1 - c.dodge / CARP.dodgeTime, 0, 1);
      const e = p * p * (3 - 2 * p);
      _axis.set(Math.sin(c.dodgeA), 0, -Math.cos(c.dodgeA));
      _qFlip.setFromAxisAngle(_axis, e * TAU);
      this.root.quaternion.multiply(_qFlip);
    }
    this.front.rotation.y = -this.steerVis * 0.5;
    this.wheelF.rotation.z = -this.spin;
    this.wheelR.rotation.z = -this.spin;

    const sq = this.squash;
    this.root.scale.set(1 + sq * 0.07, 1 - sq * 0.16, 1 + sq * 0.07);

    const fl = this.flameLevel;
    this.flame.visible = fl > 0.03;
    if (this.flame.visible) {
      const flick = 0.86 + 0.14 * Math.sin(time * 71 + this.car.slot * 3) + 0.06 * Math.sin(time * 123);
      this.flame.scale.set((0.35 + 0.85 * fl) * flick, fl * (0.85 + 0.15 * flick), fl * (0.85 + 0.15 * flick));
    }
    this.under.material.opacity = (this.me ? 0.7 : 0.5) + 0.25 * fl;

    // the shadow and ring stay on the floor under the car, turning with its heading
    const lift = clamp((this.y - 0.6) / 8, 0, 1);
    this.blob.position.y = 0.045 - this.y;
    this.blob.material.opacity = 1 - lift * 0.6;
    if (this.ring) {
      this.ring.position.y = 0.07 - this.y;
      const pulse = 1 + 0.04 * Math.sin(time * 5);
      this.ring.scale.set(pulse, 1, pulse);
      this.ring.material.opacity = clamp(0.55 + 0.25 * Math.sin(time * 5) - lift * 0.3, 0, 1);
    }
  }

  /** Frees what this car owns (its shared geometry and materials stay). */
  dispose() {
    this.under.material.dispose();
    this.blob.material.dispose();
    if (this.ring) this.ring.material.dispose();
  }
}
