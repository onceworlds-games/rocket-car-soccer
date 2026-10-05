// The stadium: pitch, walls, goals and nets, stands full of camera flashes, floodlights, a sky, scoreboards and boost pads.
// Static pieces are merged into a few meshes; only the pads, the crowd's flashes and the scoreboards change.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PX, PZ, WALL_H, CEIL, GOAL_HW, GOAL_H, GOAL_D, PADS, PAD_SMALL, PAD_BIG } from '../sim/consts.js';
import { mulberry32 } from '../sim/rng.js';
import { TEAMS, FONT } from './palette.js';

const BLUE = TEAMS[1];
const ORANGE = TEAMS[2];

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round gradient, white in the middle to clear at the edge: sprites, glows and shadows. */
export function glowTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]) {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(c);
}

function tint(geom, hex) {
  const col = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

// ---------------------------------------------------------------- the pitch texture

const FIELD_W = 2 * (PX + GOAL_D); // the floor runs into both nets
const FIELD_H = 2 * PZ;

function drawPitch(g, W, H) {
  const X = (x) => ((x + PX + GOAL_D) / FIELD_W) * W;
  const Z = (z) => ((z + PZ) / FIELD_H) * H;
  g.fillStyle = '#0a1c18';
  g.fillRect(0, 0, W, H);
  // turf stripes
  const n = 16;
  const sw = (2 * PX) / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? '#1b7653' : '#125a3f';
    g.fillRect(X(-PX + i * sw), 0, X(-PX + (i + 1) * sw) - X(-PX + i * sw) + 1, H);
  }
  // inside the nets
  g.fillStyle = '#0b2431';
  g.fillRect(0, 0, X(-PX), H);
  g.fillRect(X(PX), 0, W - X(PX), H);
  // the two ends are tinted with their team's colour so the goals read from anywhere
  for (const [sx, col] of [[-1, BLUE.css], [1, ORANGE.css]]) {
    const x0 = X(sx * PX);
    const x1 = X(sx * (PX - 16));
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, `${col}66`);
    grad.addColorStop(1, `${col}00`);
    g.fillStyle = grad;
    g.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
    g.fillStyle = `${col}40`;
    g.fillRect(sx < 0 ? 0 : X(PX), Z(-GOAL_HW), sx < 0 ? X(-PX) : W - X(PX), Z(GOAL_HW) - Z(-GOAL_HW));
  }
  // lines
  const lw = (W / FIELD_W) * 0.28;
  g.strokeStyle = 'rgba(233,240,255,0.92)';
  g.lineWidth = lw;
  g.lineJoin = 'round';
  g.strokeRect(X(-PX), Z(-PZ + 0.1), X(PX) - X(-PX), Z(PZ - 0.1) - Z(-PZ + 0.1));
  g.beginPath();
  g.moveTo(X(0), Z(-PZ));
  g.lineTo(X(0), Z(PZ));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), (W / FIELD_W) * 9, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(233,240,255,0.95)';
  g.beginPath();
  g.arc(X(0), Z(0), (W / FIELD_W) * 0.7, 0, Math.PI * 2);
  g.fill();
  for (const sx of [-1, 1]) {
    // the box in front of each goal and the smaller one inside it
    g.strokeRect(sx < 0 ? X(-PX) : X(PX - 10), Z(-14), X(10) - X(0), Z(14) - Z(-14));
    g.strokeRect(sx < 0 ? X(-PX) : X(PX - 4), Z(-GOAL_HW - 1), X(4) - X(0), Z(GOAL_HW + 1) - Z(-GOAL_HW - 1));
  }
  // faint boost-pad hints and a centre mark
  g.globalAlpha = 0.18;
  g.lineWidth = lw * 0.6;
  g.beginPath();
  g.arc(X(0), Z(0), (W / FIELD_W) * 3.2, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
}

function pitchTexture() {
  const c = makeCanvas(2048, Math.round((2048 * FIELD_H) / FIELD_W));
  drawPitch(c.getContext('2d'), c.width, c.height);
  const t = canvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** The net: a diamond mesh of bright lines on black, tinted and added over the scene. */
function netTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(64, 0);
  g.lineTo(128, 64);
  g.lineTo(64, 128);
  g.closePath();
  g.stroke();
  const t = canvasTexture(c, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function plane(w, h, repX, repY) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repX, uv.getY(i) * repY);
  return g;
}

function placed(geom, x, y, z, ry = 0, rx = 0, rz = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  geom.applyMatrix4(m);
  return geom;
}

// ---------------------------------------------------------------- walls

const T = 1.4; // wall thickness
const WALLS = [
  [-32, 26, 0, 26],
  [0, 26, 32, 26],
  [32, 26, 40, 18],
  [40, 18, 40, GOAL_HW],
  [40, -GOAL_HW, 40, -18],
  [40, -18, 32, -26],
  [32, -26, 0, -26],
  [0, -26, -32, -26],
  [-32, -26, -40, -18],
  [-40, -18, -40, -GOAL_HW],
  [-40, GOAL_HW, -40, 18],
  [-40, 18, -32, 26],
];

function buildWalls() {
  const body = [];
  const blue = [];
  const orange = [];
  const glassBlue = [];
  const glassOrange = [];
  for (const [x0, z0, x1, z1] of WALLS) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    // the wall's normal pointing out of the arena
    let nx = -dz / len;
    let nz = dx / len;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const ry = -Math.atan2(dz, dx);
    body.push(placed(new THREE.BoxGeometry(len + 0.02, WALL_H, T), mx + (nx * T) / 2, WALL_H / 2, mz + (nz * T) / 2, ry));
    const list = mx < 0 ? blue : orange;
    // light strip along the top and another low on the inside
    list.push(placed(new THREE.BoxGeometry(len + 0.02, 0.45, 0.28), mx - nx * 0.14, WALL_H - 0.3, mz - nz * 0.14, ry));
    list.push(placed(new THREE.BoxGeometry(len + 0.02, 0.18, 0.2), mx - nx * 0.1, 0.12, mz - nz * 0.1, ry));
    // the ball bounces off an invisible barrier above the wall, up to the ceiling: a very faint glass shows where
    (mx < 0 ? glassBlue : glassOrange).push(placed(new THREE.PlaneGeometry(len, CEIL - WALL_H), mx, (CEIL + WALL_H) / 2, mz, ry));
  }
  // and above the two goal mouths
  for (const sx of [-1, 1]) (sx < 0 ? glassBlue : glassOrange).push(placed(new THREE.PlaneGeometry(2 * GOAL_HW, CEIL - WALL_H), sx * PX, (CEIL + WALL_H) / 2, 0, Math.PI / 2));
  return { body: mergeGeometries(body), blue: mergeGeometries(blue), orange: mergeGeometries(orange), glassBlue: mergeGeometries(glassBlue), glassOrange: mergeGeometries(glassOrange) };
}

// ---------------------------------------------------------------- goals

function buildGoal(sx) {
  const frame = [];
  const th = 0.5;
  for (const sz of [-1, 1]) {
    frame.push(placed(new THREE.BoxGeometry(th, GOAL_H, th), sx * PX, GOAL_H / 2, sz * GOAL_HW));
    frame.push(placed(new THREE.BoxGeometry(th, GOAL_H, th), sx * (PX + GOAL_D), GOAL_H / 2, sz * GOAL_HW));
    frame.push(placed(new THREE.BoxGeometry(GOAL_D, th * 0.8, th * 0.8), sx * (PX + GOAL_D / 2), GOAL_H, sz * GOAL_HW));
    frame.push(placed(new THREE.BoxGeometry(GOAL_D, th * 0.6, th * 0.6), sx * (PX + GOAL_D / 2), 0.15, sz * GOAL_HW));
  }
  frame.push(placed(new THREE.BoxGeometry(th, th, 2 * GOAL_HW + th), sx * PX, GOAL_H, 0));
  frame.push(placed(new THREE.BoxGeometry(th * 0.8, th * 0.8, 2 * GOAL_HW), sx * (PX + GOAL_D), GOAL_H, 0));
  const net = [
    placed(plane(2 * GOAL_HW, GOAL_H, 2 * GOAL_HW, GOAL_H), sx * (PX + GOAL_D), GOAL_H / 2, 0, (-sx * Math.PI) / 2),
    placed(plane(GOAL_D, GOAL_H, GOAL_D, GOAL_H), sx * (PX + GOAL_D / 2), GOAL_H / 2, GOAL_HW, 0),
    placed(plane(GOAL_D, GOAL_H, GOAL_D, GOAL_H), sx * (PX + GOAL_D / 2), GOAL_H / 2, -GOAL_HW, 0),
    placed(plane(GOAL_D, 2 * GOAL_HW, GOAL_D, 2 * GOAL_HW), sx * (PX + GOAL_D / 2), GOAL_H, 0, 0, Math.PI / 2),
  ];
  return { frame: mergeGeometries(frame), net: mergeGeometries(net) };
}

// ---------------------------------------------------------------- stands, crowd, towers

const TIERS = 7;
const TIER_D = 3.4;

function buildStands() {
  const geoms = [];
  for (let i = 0; i < TIERS; i++) {
    const h = 2.4 + i * 2.3;
    const shade = i % 2 ? 0x1a2240 : 0x121a35;
    for (const s of [-1, 1]) {
      geoms.push(tint(placed(new THREE.BoxGeometry(2 * (54 + i * TIER_D), h, TIER_D), 0, h / 2, s * (31 + i * TIER_D)), shade));
      geoms.push(tint(placed(new THREE.BoxGeometry(TIER_D, h + 0.04, 2 * (33 + i * TIER_D)), s * (51 + i * TIER_D), (h + 0.04) / 2, 0), shade));
    }
  }
  return mergeGeometries(geoms);
}

function buildCrowd(density) {
  const rng = mulberry32(77);
  const pos = [];
  const col = [];
  const phase = [];
  const flash = [];
  const palette = [BLUE.hex, ORANGE.hex, 0xdfe6ff, 0x8ea0d8, 0x3b4466, 0xff5a7a, 0xe7f0ff].map((h) => new THREE.Color(h));
  const per = Math.round(120 * density);
  for (let i = 0; i < TIERS; i++) {
    const h = 2.4 + i * 2.3;
    for (const s of [-1, 1]) {
      for (let k = 0; k < per; k++) {
        pos.push((rng() * 2 - 1) * (52 + i * TIER_D), h + 0.55, s * (31 + i * TIER_D + (rng() - 0.5) * TIER_D * 0.8));
        const c = palette[Math.floor(rng() * palette.length)];
        col.push(c.r, c.g, c.b);
        phase.push(rng());
        flash.push(rng() < 0.16 ? 1 : 0);
      }
      for (let k = 0; k < per * 0.6; k++) {
        pos.push(s * (51 + i * TIER_D + (rng() - 0.5) * TIER_D * 0.8), h + 0.6, (rng() * 2 - 1) * (30 + i * TIER_D));
        const c = palette[Math.floor(rng() * palette.length)];
        col.push(c.r, c.g, c.b);
        phase.push(rng());
        flash.push(rng() < 0.16 ? 1 : 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  g.setAttribute('aFlash', new THREE.Float32BufferAttribute(flash, 1));
  g.computeBoundingSphere();
  return g;
}

const CROWD_VERT = `
uniform float uTime;
uniform float uScale;
uniform float uSize;
attribute vec3 aColor;
attribute float aPhase;
attribute float aFlash;
varying vec3 vColor;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float f = 0.0;
  if (aFlash > 0.5) f = pow(max(0.0, sin(uTime * (1.2 + aPhase * 0.9) + aPhase * 41.0)), 70.0);
  vColor = aColor * (0.4 + 2.2 * f);
  vA = 0.5 + 0.5 * f;
  float size = uSize * (1.0 + 2.4 * f);
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.0, 18.0);
}`;
const CROWD_FRAG = `
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vColor, vA * a);
  #include <colorspace_fragment>
}`;

function buildTowers() {
  const poles = [];
  const heads = [];
  const glows = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 62;
      const z = sz * 44;
      poles.push(placed(new THREE.BoxGeometry(1.4, 44, 1.4), x, 22, z));
      const head = new THREE.Object3D();
      head.position.set(x, 42, z);
      head.lookAt(0, 6, 0);
      head.updateMatrix();
      heads.push(new THREE.BoxGeometry(11, 6.5, 0.9).applyMatrix4(head.matrix));
      glows.push(new THREE.Vector3(x - sx * 3, 42, z - sz * 3));
    }
  }
  return { poles: mergeGeometries(poles), heads: mergeGeometries(heads), glows };
}

// ---------------------------------------------------------------- the stage

/**
 * Builds the whole stadium into `root`. `opts.quality` is 'low' | 'medium' | 'high'. Returns what the view needs to keep
 * it alive: update(time), setBoard(), updatePads(), focusSun().
 */
export function buildStage(opts = {}) {
  const quality = opts.quality || 'high';
  const root = new THREE.Group();
  root.name = 'stage';

  // light: a cool sun that casts the cars' shadows, and a sky/ground fill
  const hemi = new THREE.HemisphereLight(0x7f9fe6, 0x1c2840, 1.35);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xd2deff, 2.2);
  sun.position.set(30, 60, 20);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = quality !== 'low';
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 2.5;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  root.add(sun);
  root.add(sun.target);

  // the floor, with the apron round it
  const pitchTex = pitchTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_W, FIELD_H).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.34, metalness: 0.12 }),
  );
  floor.receiveShadow = true;
  root.add(floor);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(520, 520).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a1020, roughness: 0.95, metalness: 0 }));
  apron.position.y = -0.04;
  root.add(apron);

  // walls and their light strips
  const walls = buildWalls();
  root.add(new THREE.Mesh(walls.body, new THREE.MeshStandardMaterial({ color: 0x1b2540, roughness: 0.42, metalness: 0.55 })));
  for (const [geom, team] of [[walls.blue, BLUE], [walls.orange, ORANGE]]) {
    root.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: new THREE.Color(team.glow).multiplyScalar(1.15), toneMapped: false })));
  }
  for (const [geom, team] of [[walls.glassBlue, BLUE], [walls.glassOrange, ORANGE]]) {
    root.add(
      new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: team.glow, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })),
    );
  }

  // goals
  const netTex = netTexture();
  for (const [sx, team] of [[-1, BLUE], [1, ORANGE]]) {
    const goal = buildGoal(sx);
    root.add(new THREE.Mesh(goal.frame, new THREE.MeshBasicMaterial({ color: new THREE.Color(team.glow).multiplyScalar(1.2), toneMapped: false })));
    root.add(
      new THREE.Mesh(
        goal.net,
        new THREE.MeshBasicMaterial({ map: netTex, color: new THREE.Color(team.glow).multiplyScalar(0.8), transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      ),
    );
  }

  // stands and the crowd's flashes
  root.add(new THREE.Mesh(buildStands(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05 })));
  const crowdMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 500 }, uSize: { value: 0.9 } },
    vertexShader: CROWD_VERT,
    fragmentShader: CROWD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const crowd = new THREE.Points(buildCrowd(quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1), crowdMat);
  crowd.frustumCulled = false;
  root.add(crowd);

  // floodlights
  const towers = buildTowers();
  root.add(new THREE.Mesh(towers.poles, new THREE.MeshStandardMaterial({ color: 0x151c30, roughness: 0.7, metalness: 0.5 })));
  root.add(new THREE.Mesh(towers.heads, new THREE.MeshBasicMaterial({ color: 0xf2f6ff, toneMapped: false })));
  const glowTex = glowTexture();
  for (const p of towers.glows) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfdcff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    s.position.copy(p);
    s.scale.set(34, 34, 1);
    root.add(s);
  }

  // sky and stars
  const skyGeom = new THREE.SphereGeometry(480, 32, 16);
  {
    const pos = skyGeom.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x02040b);
    const mid = new THREE.Color(0x0b1430);
    const low = new THREE.Color(0x1d2f5c);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 480);
      if (t < 0.25) c.copy(low).lerp(mid, t / 0.25);
      else c.copy(mid).lerp(top, Math.min(1, (t - 0.25) / 0.6));
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    skyGeom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  const sky = new THREE.Mesh(skyGeom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  root.add(sky);
  {
    const rng = mulberry32(5);
    const pts = [];
    for (let i = 0; i < 420; i++) {
      const a = rng() * Math.PI * 2;
      const e = 0.12 + rng() * 1.25;
      const r = 470;
      pts.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false, depthWrite: false }));
    stars.renderOrder = -9;
    root.add(stars);
  }

  // scoreboards over both ends, sharing one live texture
  const boardCanvas = makeCanvas(1024, 384);
  const boardTex = canvasTexture(boardCanvas);
  const board = { b: -1, o: -1, text: '', ot: false };
  function drawBoard() {
    const g = boardCanvas.getContext('2d');
    g.fillStyle = '#060a15';
    g.fillRect(0, 0, 1024, 384);
    g.fillStyle = BLUE.css;
    g.fillRect(0, 0, 18, 384);
    g.fillStyle = ORANGE.css;
    g.fillRect(1006, 0, 18, 384);
    g.fillStyle = '#10182c';
    g.fillRect(18, 0, 988, 384);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = BLUE.glowCss;
    g.font = `46px ${FONT}`;
    g.fillText('BLUE', 190, 62);
    g.fillStyle = ORANGE.glowCss;
    g.fillText('ORANGE', 834, 62);
    g.fillStyle = '#ffffff';
    g.font = `200px ${FONT}`;
    g.fillText(String(Math.max(0, board.b)), 190, 218);
    g.fillText(String(Math.max(0, board.o)), 834, 218);
    g.font = `120px ${FONT}`;
    g.fillStyle = board.ot ? '#ffd23d' : '#ffffff';
    g.fillText(board.text || '', 512, 190);
    boardTex.needsUpdate = true;
  }
  drawBoard();
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
  const boardBody = [];
  const boardFaces = [];
  for (const sx of [-1, 1]) {
    boardBody.push(placed(new THREE.BoxGeometry(30, 11.5, 2.2), sx * 66, 31, 0, (-sx * Math.PI) / 2));
    boardBody.push(placed(new THREE.BoxGeometry(1.2, 22, 1.2), sx * 66, 14, 11, 0));
    boardBody.push(placed(new THREE.BoxGeometry(1.2, 22, 1.2), sx * 66, 14, -11, 0));
    boardFaces.push(placed(new THREE.PlaneGeometry(28, 10.5), sx * (66 - 1.15), 31, 0, (-sx * Math.PI) / 2));
  }
  root.add(new THREE.Mesh(mergeGeometries(boardBody), new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.6, metalness: 0.6 })));
  root.add(new THREE.Mesh(mergeGeometries(boardFaces), boardMat));

  // boost pads
  const padDisc = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.08, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), PADS.length);
  const padRing = new THREE.InstancedMesh(new THREE.RingGeometry(1.0, 1.22, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), PADS.length);
  const padBeamGeom = new THREE.CylinderGeometry(1.3, 1.5, 9, 16, 1, true);
  padBeamGeom.translate(0, 4.5, 0);
  const beams = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const ps = new THREE.Vector3();
  PADS.forEach((p, i) => {
    const r = (p.big ? PAD_BIG.radius : PAD_SMALL.radius) * 0.62;
    m4.compose(ps.set(p.x, 0.06, p.z), q, sc.set(r, 1, r));
    padDisc.setMatrixAt(i, m4);
    m4.compose(ps.set(p.x, 0.09, p.z), q, sc.set(r * 1.18, 1, r * 1.18));
    padRing.setMatrixAt(i, m4);
    if (p.big) {
      const beam = new THREE.Mesh(padBeamGeom, new THREE.MeshBasicMaterial({ color: 0xffd23d, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.set(p.x, 0, p.z);
      beam.userData.pad = i;
      root.add(beam);
      beams.push(beam);
    }
  });
  const GOLD = new THREE.Color(0xffc93a);
  const SPENT = new THREE.Color(0x1c2a3a);
  const WHITE = new THREE.Color(0xfff3c4);
  const padState = new Float32Array(PADS.length).fill(-1);
  const tmp = new THREE.Color();
  for (let i = 0; i < PADS.length; i++) {
    padDisc.setColorAt(i, GOLD);
    padRing.setColorAt(i, WHITE);
  }
  padDisc.instanceColor.needsUpdate = true;
  padRing.instanceColor.needsUpdate = true;
  root.add(padDisc, padRing);

  return {
    root,
    sun,
    hemi,
    crowdMat,
    /** Advances the crowd's flashes (seconds) and sizes their points to the drawing buffer's height (pixels). */
    update(time, bufferHeight) {
      crowdMat.uniforms.uTime.value = time;
      crowdMat.uniforms.uScale.value = Math.max(200, bufferHeight * 0.5);
    },
    setBoard(b, o, text, ot = false) {
      if (board.b === b && board.o === o && board.text === text && board.ot === ot) return;
      board.b = b;
      board.o = o;
      board.text = text;
      board.ot = ot;
      drawBoard();
    },
    redrawBoard: drawBoard,
    /** Pads glow gold when they have boost and go dark while they rest. */
    updatePads(pads, time) {
      let colorChanged = false;
      for (let i = 0; i < PADS.length; i++) {
        const ready = pads[i].cd <= 0 ? 1 : 0;
        if (padState[i] !== ready) {
          padState[i] = ready;
          padDisc.setColorAt(i, ready ? GOLD : SPENT);
          tmp.copy(ready ? WHITE : SPENT);
          padRing.setColorAt(i, tmp);
          colorChanged = true;
        }
      }
      if (colorChanged) {
        padDisc.instanceColor.needsUpdate = true;
        padRing.instanceColor.needsUpdate = true;
      }
      for (const b of beams) {
        const ready = padState[b.userData.pad] === 1;
        b.visible = ready;
        if (ready) b.material.opacity = 0.16 + 0.07 * Math.sin(time * 3 + b.userData.pad);
      }
    },
    /** Moves the shadow-casting sun over the action, snapped to its texel grid so shadows hold still. */
    focusSun(x, z) {
      const step = 72 / sun.shadow.mapSize.x;
      const fx = Math.round(x / (step * 8)) * step * 8;
      const fz = Math.round(z / (step * 8)) * step * 8;
      sun.position.set(fx + 30, 60, fz + 20);
      sun.target.position.set(fx, 0, fz);
      sun.target.updateMatrixWorld();
    },
    setShadowSize(size) {
      if (size <= 0) {
        sun.castShadow = false;
        return;
      }
      sun.castShadow = true;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
    },
  };
}
