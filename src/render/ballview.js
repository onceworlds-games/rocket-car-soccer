// The ball: a faceted white sphere with dark panels, a halo tinted by the team that touched it last, a soft shadow on the
// floor and a ring that shrinks as the ball comes down, so its height reads at a glance.

import * as THREE from 'three';
import { BALL_R } from '../sim/consts.js';
import { clamp } from '../sim/rng.js';
import { TEAMS } from './palette.js';
import { glowTexture } from './stage.js';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Which triangles of the icosphere touch a vertex of the icosahedron it came from: those stay white; the middles go dark. */
function ballGeometry() {
  const g = new THREE.IcosahedronGeometry(BALL_R, 1);
  const base = [];
  for (const [a, b] of [[1, PHI], [-1, PHI], [1, -PHI], [-1, -PHI]]) {
    base.push(new THREE.Vector3(a, b, 0).normalize(), new THREE.Vector3(0, a, b).normalize(), new THREE.Vector3(b, 0, a).normalize());
  }
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const white = new THREE.Color(0xf4f6fb);
  const dark = new THREE.Color(0x141a30);
  const v = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    let corner = false;
    for (let i = 0; i < 3 && !corner; i++) {
      v.fromBufferAttribute(pos, f + i).normalize();
      for (const b of base) if (v.dot(b) > 0.9999) corner = true;
    }
    const c = corner ? white : dark;
    for (let i = 0; i < 3; i++) {
      col[(f + i) * 3] = c.r;
      col[(f + i) * 3 + 1] = c.g;
      col[(f + i) * 3 + 2] = c.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export class BallView {
  constructor() {
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, flatShading: true, emissive: new THREE.Color(0x000000), emissiveIntensity: 0.4 }));
    this.mesh.castShadow = true;
    this.group.add(this.mesh);

    const glow = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.halo.scale.set(8.5, 8.5, 1);
    this.group.add(this.halo);

    const shadowTex = glowTexture([[0, 'rgba(0,0,0,0.7)'], [0.6, 'rgba(0,0,0,0.38)'], [1, 'rgba(0,0,0,0)']]);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
    this.shadow.renderOrder = 1;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = 2;
    this.floor = new THREE.Group(); // shadow and ring: they sit on the pitch, not on the ball
    this.floor.add(this.shadow, this.ring);

    this.x = 0;
    this.y = BALL_R;
    this.z = 0;
    this.team = -1;
    this.tmp = new THREE.Color();
  }

  /** Both objects to add to the scene. */
  get objects() {
    return [this.group, this.floor];
  }

  setShadows(on) {
    this.mesh.castShadow = on;
  }

  update(dt, alpha, ball, lastTeam) {
    this.x = ball.px + (ball.x - ball.px) * alpha;
    this.y = ball.py + (ball.y - ball.py) * alpha;
    this.z = ball.pz + (ball.z - ball.pz) * alpha;
    this.group.position.set(this.x, this.y, this.z);

    const hs = Math.hypot(ball.vx, ball.vz);
    if (hs > 0.05 && dt > 0) {
      _axis.set(ball.vz, 0, -ball.vx).normalize();
      const ang = ((this.y < BALL_R + 0.1 ? hs : hs * 0.45) * dt) / BALL_R;
      _q.setFromAxisAngle(_axis, ang);
      this.mesh.quaternion.premultiply(_q);
    }

    if (lastTeam !== this.team) {
      this.team = lastTeam;
      const t = TEAMS[lastTeam];
      this.tmp.set(t ? t.glow : 0xffffff);
      this.halo.material.color.copy(this.tmp);
      this.halo.material.opacity = t ? 0.42 : 0.2;
      this.mesh.material.emissive.copy(t ? this.tmp : this.tmp.set(0x000000));
      this.mesh.material.emissiveIntensity = t ? 0.32 : 0;
      this.ring.material.color.set(t ? t.glow : 0xffffff);
    }

    // the shadow stays under the ball; the ring is wide when the ball is high and closes onto it as it lands
    const h = Math.max(0, this.y - BALL_R);
    this.floor.position.set(this.x, 0.035, this.z);
    const sh = BALL_R * (2.9 - Math.min(1, h / 14) * 1.0);
    this.shadow.scale.set(sh, 1, sh);
    this.shadow.material.opacity = clamp(1 - h / 22, 0.25, 1);
    const rr = BALL_R * (1.05 + Math.min(h, 16) * 0.2);
    this.ring.scale.set(rr, 1, rr);
    this.ring.material.opacity = clamp((h - 0.8) / 4, 0, 0.7);
  }
}
