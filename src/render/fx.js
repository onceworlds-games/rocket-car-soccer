// Effects: additive sparks and flame puffs in one pool of points, expanding rings, light beams and confetti. Everything is
// pooled and reused: nothing is allocated while the game runs.

import * as THREE from 'three';
import { clamp } from '../sim/rng.js';

const VERT = `
uniform float uScale;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vC;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vC = aColor;
  vA = aAlpha;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 120.0);
}`;
const FRAG = `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vC, vA * a * a);
  #include <colorspace_fragment>
}`;

const CONFETTI = [0xff8420, 0x2f7bff, 0xffd23d, 0xffffff, 0xff3dcb, 0x3dffd9, 0xc6ff3d];

export class Fx {
  /** `quality` 'low' | 'medium' | 'high' sets how many particles the pool holds; `rand` is a 0..1 generator. */
  constructor(scene, quality = 'high', rand = Math.random) {
    this.rand = rand;
    this.quality = quality;
    this.scale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1;
    this.reduced = false;
    this.timeScale = 1;
    const N = (this.max = quality === 'low' ? 500 : quality === 'medium' ? 900 : 1500);
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N).fill(1);
    this.size0 = new Float32Array(N);
    this.alpha0 = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // rings and beams
    this.rings = [];
    const ringGeom = new THREE.RingGeometry(0.9, 1, 64);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.visible = false;
      m.renderOrder = 6;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, to: 1, from: 1, op: 1 });
    }
    this.beams = [];
    const beamGeom = new THREE.CylinderGeometry(1, 1, 70, 20, 1, true).translate(0, 35, 0);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(beamGeom, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.visible = false;
      m.renderOrder = 6;
      scene.add(m);
      this.beams.push({ mesh: m, life: 0, max: 1, r: 1, op: 0.5 });
    }

    // confetti
    this.nConf = quality === 'low' ? 70 : 160;
    this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.34), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), this.nConf);
    this.conf.frustumCulled = false;
    this.cPos = new Float32Array(this.nConf * 3);
    this.cVel = new Float32Array(this.nConf * 3);
    this.cRot = new Float32Array(this.nConf * 3);
    this.cRotV = new Float32Array(this.nConf * 3);
    this.cLife = new Float32Array(this.nConf);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    for (let i = 0; i < this.nConf; i++) this.conf.setColorAt(i, this._c.set(CONFETTI[i % CONFETTI.length]));
    this.conf.instanceColor.needsUpdate = true;
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < this.nConf; i++) this.conf.setMatrixAt(i, this._m);
    scene.add(this.conf);
    this.confCursor = 0;
    this.confAlive = 0;
  }

  /** Sets the point scale from the drawing buffer's height. */
  resize(bufferHeight, fovDeg) {
    this.material.uniforms.uScale.value = bufferHeight / (2 * Math.tan(((fovDeg || 70) * Math.PI) / 360));
  }

  /** One spark or puff. Colour as r,g,b 0..1; `grow` is how much its size changes over its life (0 = none, 1 = doubles). */
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, alpha = 1, grav = 0, drag = 0, grow = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size[i] = size;
    this.alpha0[i] = alpha;
    this.alpha[i] = alpha;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.grow[i] = grow;
  }

  /** How many particles to spawn for a nominal `n`: fewer on weaker settings and with reduced motion. */
  count(n) {
    return Math.max(this.reduced ? 0 : 1, Math.round(n * this.scale * (this.reduced ? 0.4 : 1)));
  }

  /** A burst of sparks outward from a point. `colorHex` is a number. */
  burst(x, y, z, n, speed, colorHex, size = 0.22, life = 0.7, grav = 14, up = 0.3) {
    const c = this._c.set(colorHex);
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.35) * Math.PI * 0.9;
      const s = speed * (0.35 + this.rand() * 0.75);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + speed * up, Math.sin(a) * Math.cos(e) * s, life * (0.6 + this.rand() * 0.6), size * (0.6 + this.rand() * 0.8), c.r * 1.2, c.g * 1.2, c.b * 1.2, 1, grav, 1.2, 0);
    }
  }

  /** A flame puff from an exhaust, thrown backwards (bx, bz: unit direction away from the car). */
  flame(x, y, z, bx, bz, cvx, cvz) {
    const k = this.count(2.4);
    for (let i = 0; i < k; i++) {
      const s = 7 + this.rand() * 7;
      const hot = this.rand();
      this.spawn(x, y, z, cvx * 0.35 + bx * s + (this.rand() - 0.5) * 2, (this.rand() - 0.5) * 1.5, cvz * 0.35 + bz * s + (this.rand() - 0.5) * 2, 0.22 + this.rand() * 0.2, 0.55 + this.rand() * 0.35, 1, 0.45 + hot * 0.45, 0.1 + hot * 0.25, 0.9, 0, 2.5, -0.6);
    }
  }

  /** A fading smear of light behind something supersonic. */
  trail(x, y, z, colorHex, size = 0.75) {
    if (this.reduced && this.rand() < 0.6) return;
    const c = this._c.set(colorHex);
    this.spawn(x, y, z, 0, 0.3, 0, 0.55, size, c.r, c.g, c.b, 0.7, 0, 0, -0.7);
  }

  /** A puff of dust off the floor. */
  dust(x, z, n = 6, strength = 1) {
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = (2 + this.rand() * 4) * strength;
      this.spawn(x, 0.2, z, Math.cos(a) * s, 0.8 + this.rand() * 1.4, Math.sin(a) * s, 0.5 + this.rand() * 0.3, 0.8 + this.rand() * 0.6, 0.55, 0.62, 0.78, 0.22, -2, 3, 1.2);
    }
  }

  /** A ring that grows from `from` to `to` (radius) over `life` seconds and fades. orient: 'floor' or 'x' (a ring in the goal's plane). */
  ring(x, y, z, colorHex, from, to, life, orient = 'floor', opacity = 0.9) {
    if (this.reduced) opacity *= 0.5;
    let r = this.rings.find((q) => q.life <= 0);
    if (!r) r = this.rings.reduce((a, b) => (a.life < b.life ? a : b));
    r.life = r.max = life;
    r.from = from;
    r.to = to;
    r.op = opacity;
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.set(orient === 'floor' ? -Math.PI / 2 : 0, orient === 'x' ? Math.PI / 2 : 0, 0);
    r.mesh.material.color.set(colorHex);
    r.mesh.visible = true;
  }

  /** A column of light standing on the floor. */
  beam(x, z, colorHex, radius, life, opacity = 0.5) {
    if (this.reduced) opacity *= 0.5;
    let b = this.beams.find((q) => q.life <= 0);
    if (!b) b = this.beams.reduce((a, c) => (a.life < c.life ? a : c));
    b.life = b.max = life;
    b.r = radius;
    b.op = opacity;
    b.mesh.position.set(x, 0, z);
    b.mesh.material.color.set(colorHex);
    b.mesh.visible = true;
  }

  /** Confetti raining down over a spot. */
  confetti(x, y, z, n = 100, spread = 10, upward = 12) {
    if (this.reduced) n = Math.round(n * 0.3);
    n = Math.min(n, this.nConf);
    for (let k = 0; k < n; k++) {
      const i = this.confCursor;
      this.confCursor = (this.confCursor + 1) % this.nConf;
      const i3 = i * 3;
      const a = this.rand() * Math.PI * 2;
      const s = this.rand() * spread;
      this.cPos[i3] = x + (this.rand() - 0.5) * 2;
      this.cPos[i3 + 1] = y;
      this.cPos[i3 + 2] = z + (this.rand() - 0.5) * 2;
      this.cVel[i3] = Math.cos(a) * s;
      this.cVel[i3 + 1] = upward * (0.5 + this.rand() * 0.8);
      this.cVel[i3 + 2] = Math.sin(a) * s;
      this.cRot[i3] = this.rand() * 6;
      this.cRot[i3 + 1] = this.rand() * 6;
      this.cRot[i3 + 2] = this.rand() * 6;
      this.cRotV[i3] = (this.rand() - 0.5) * 14;
      this.cRotV[i3 + 1] = (this.rand() - 0.5) * 14;
      this.cRotV[i3 + 2] = (this.rand() - 0.5) * 14;
      this.cLife[i] = 2.4 + this.rand() * 1.6;
    }
    this.confAlive = 1;
  }

  /** Advances everything by `dt` seconds (already scaled by the caller for slow motion). */
  update(dt) {
    const N = this.max;
    const pos = this.pos;
    const vel = this.vel;
    for (let i = 0; i < N; i++) {
      const l = this.life[i];
      if (l <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      const nl = l - dt;
      this.life[i] = nl;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.05 && this.grav[i] > 0) {
        pos[i3 + 1] = 0.05;
        vel[i3 + 1] = Math.abs(vel[i3 + 1]) * 0.35;
      }
      const t = clamp(nl / this.maxLife[i], 0, 1);
      this.alpha[i] = nl <= 0 ? 0 : this.alpha0[i] * Math.min(1, t * 2.2);
      this.size[i] = nl <= 0 ? 0 : this.size0[i] * (1 + this.grow[i] * (1 - t));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.max;
      const e = 1 - (1 - t) * (1 - t);
      const s = r.from + (r.to - r.from) * e;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = r.op * (1 - t) * (1 - t * 0.3);
    }
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      const t = 1 - b.life / b.max;
      const grow = Math.min(1, t * 6);
      b.mesh.scale.set(b.r * (0.4 + 0.6 * grow) * (1 - t * 0.4), 1, b.r * (0.4 + 0.6 * grow) * (1 - t * 0.4));
      b.mesh.material.opacity = b.op * (1 - t) * Math.min(1, t * 20 + 0.2);
    }

    if (this.confAlive) {
      let alive = 0;
      for (let i = 0; i < this.nConf; i++) {
        const l = this.cLife[i];
        const i3 = i * 3;
        if (l <= 0) {
          continue;
        }
        this.cLife[i] = l - dt;
        alive++;
        this.cVel[i3 + 1] -= 9 * dt;
        const drag = Math.max(0, 1 - 1.6 * dt);
        this.cVel[i3] *= drag;
        this.cVel[i3 + 2] *= drag;
        if (this.cVel[i3 + 1] < -5) this.cVel[i3 + 1] = -5;
        this.cPos[i3] += this.cVel[i3] * dt;
        this.cPos[i3 + 1] += this.cVel[i3 + 1] * dt;
        this.cPos[i3 + 2] += this.cVel[i3 + 2] * dt;
        this.cRot[i3] += this.cRotV[i3] * dt;
        this.cRot[i3 + 1] += this.cRotV[i3 + 1] * dt;
        this.cRot[i3 + 2] += this.cRotV[i3 + 2] * dt;
        const done = this.cLife[i] <= 0 || this.cPos[i3 + 1] < 0.05;
        if (done) {
          this.cLife[i] = 0;
          this._m.makeScale(0, 0, 0);
        } else {
          this._e.set(this.cRot[i3], this.cRot[i3 + 1], this.cRot[i3 + 2]);
          this._q.setFromEuler(this._e);
          this._m.compose(this._p.set(this.cPos[i3], this.cPos[i3 + 1], this.cPos[i3 + 2]), this._q, this._s.set(1, 1, 1));
        }
        this.conf.setMatrixAt(i, this._m);
      }
      this.conf.instanceMatrix.needsUpdate = true;
      if (alive === 0) this.confAlive = 0;
    }
  }

  /** Clears everything on screen (a new match, a reset). */
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const b of this.beams) {
      b.life = 0;
      b.mesh.visible = false;
    }
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < this.nConf; i++) {
      this.cLife[i] = 0;
      this.conf.setMatrixAt(i, this._m);
    }
    this.conf.instanceMatrix.needsUpdate = true;
    this.confAlive = 0;
  }
}
