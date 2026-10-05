// The drawing code can't run without a GPU here, but everything that builds and moves objects can: these tests build the
// stadium, the cars, the ball and the effects against a stub canvas and step them, to catch undefined names, bad geometry
// merges and NaN positions that a parse check never finds.

import test from 'node:test';
import assert from 'node:assert/strict';

const ctx = new Proxy(
  {},
  {
    get(t, p) {
      if (p === 'createRadialGradient' || p === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (p in t) return t[p];
      return () => {};
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  },
);
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext: () => ctx, style: {} };
  },
};

const THREE = await import('three');
const { buildStage } = await import('../src/render/stage.js');
const { CarView } = await import('../src/render/cars.js');
const { BallView } = await import('../src/render/ballview.js');
const { Fx } = await import('../src/render/fx.js');
const { CameraRig } = await import('../src/render/rig.js');
const { World } = await import('../src/sim/world.js');
const { makeCar } = await import('../src/sim/car.js');
const { mulberry32 } = await import('../src/sim/rng.js');

function allFinite(obj) {
  let ok = true;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
}

test('the stadium builds at every quality and stays inside its draw-call budget', () => {
  for (const quality of ['low', 'medium', 'high']) {
    const stage = buildStage({ quality });
    let meshes = 0;
    stage.root.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isSprite || o.isLine) meshes++;
    });
    assert.ok(meshes > 15 && meshes < 70, `${quality}: ${meshes} drawn objects in the stage`);
    stage.update(1.5, 720);
    stage.setBoard(2, 1, '2:41', false);
    stage.setBoard(2, 1, '2:41', false);
    stage.setBoard(3, 1, 'OT', true);
    const world = new World(1);
    world.pads[2].cd = 3;
    stage.updatePads(world.pads, 2);
    world.pads[2].cd = 0;
    stage.updatePads(world.pads, 2.1);
    stage.focusSun(12.3, -7.7);
    stage.setShadowSize(quality === 'low' ? 0 : 1024);
    assert.ok(allFinite(stage.root));
  }
});

test('cars build, move, flip and burn without a NaN; many cars share their geometry', () => {
  const scene = new THREE.Scene();
  const world = new World(2);
  for (let i = 0; i < 8; i++) {
    const c = makeCar(`c${i}`, 1 + (i % 2), i === 0 ? 'local' : i < 4 ? 'bot' : 'remote');
    c.slot = i >> 1;
    c.accent = i;
    world.addCar(c);
  }
  world.kickoff();
  const views = world.cars.map((c) => new CarView(c, c.id === 'c0'));
  for (const v of views) scene.add(v.group);
  const geoms = new Set();
  const gl = new Set();
  scene.traverse((o) => {
    if (o.isMesh) {
      geoms.add(o.geometry);
      gl.add(o);
    }
  });
  assert.ok(geoms.size < gl.size * 0.5, `${geoms.size} geometries for ${gl.size} meshes`);
  assert.ok(gl.size / 8 <= 14, `${gl.size / 8} meshes a car`);
  const rng = mulberry32(3);
  const e = new THREE.Vector3();
  for (let i = 0; i < 300; i++) {
    for (const c of world.cars) {
      c.thr = 1;
      c.steer = Math.sin(i / 20 + c.slot);
      c.boostIn = i % 90 < 40;
      c.pitchIn = Math.round(rng() * 2 - 1);
      if (i % 70 === 3) c.jumpIn = true;
      if (i % 70 === 12) {
        c.jumpIn = true;
        c.thr = 1;
      }
    }
    world.step(1 / 60);
    for (const v of views) {
      v.update(1 / 60, 0.5, i / 60);
      if (i % 5 === 0) assert.ok(Number.isFinite(v.exhaustWorld(e).x));
    }
  }
  assert.ok(allFinite(scene));
  views[0].pulse(1);
  views[0].setShadowBlob(false);
  views[0].update(0.016, 1, 5);
  for (const v of views) v.dispose();
});

test('the ball view builds a two-tone ball and follows the ball', () => {
  const b = new BallView();
  const colors = b.mesh.geometry.attributes.color;
  const darks = new Set();
  for (let i = 0; i < colors.count; i += 3) darks.add(colors.getX(i) < 0.5 ? 1 : 0);
  assert.equal(darks.size, 2, 'both white and dark panels');
  const world = new World(1);
  world.ball.x = 9;
  world.ball.y = 8;
  world.ball.vx = 20;
  b.update(0.016, 1, world.ball, 2);
  b.update(0.016, 1, world.ball, 0);
  assert.equal(b.group.position.x, 9);
  assert.ok(b.ring.material.opacity > 0.3, 'the ring shows when the ball is high');
  world.ball.y = 1.9;
  b.update(0.016, 1, world.ball, 1);
  assert.equal(b.ring.material.opacity, 0);
  assert.ok(allFinite(b.group) && allFinite(b.floor));
});

test('effects spawn, move and fade, and reduced motion calms them', () => {
  const scene = new THREE.Scene();
  for (const q of ['low', 'medium', 'high']) {
    const fx = new Fx(scene, q, mulberry32(4));
    fx.resize(720, 75);
    fx.burst(0, 3, 0, 100, 20, 0xff8420);
    fx.flame(1, 1, 1, -1, 0, 5, 0);
    fx.trail(2, 1, 2, 0x2f7bff);
    fx.dust(3, 3);
    fx.ring(0, 3, 0, 0xff8420, 1, 20, 1, 'x');
    fx.ring(0, 0.2, 0, 0xff8420, 1, 20, 1, 'floor');
    fx.beam(0, 0, 0xffffff, 3, 1.5);
    fx.confetti(0, 10, 0, 300, 10, 10);
    let lit = 0;
    for (let i = 0; i < fx.max; i++) if (fx.life[i] > 0) lit++;
    assert.ok(lit > 20);
    for (let i = 0; i < 400; i++) fx.update(1 / 60);
    for (let i = 0; i < fx.max * 3; i++) assert.ok(Number.isFinite(fx.pos[i]));
    let left = 0;
    for (let i = 0; i < fx.max; i++) if (fx.life[i] > 0) left++;
    assert.equal(left, 0, 'everything burns out');
    assert.equal(fx.confAlive, 0);
    fx.reduced = true;
    assert.ok(fx.count(40) < 40 * fx.scale);
    fx.clear();
  }
});

test('the chase camera sits behind the car, looks ahead, stays inside the walls and snaps on a reset', () => {
  const rig = new CameraRig();
  const car = { x: -10, y: 0.6, z: 0, h: 0, vx: 20, vz: 0 };
  const ball = { x: 10, y: 1.9, z: 0 };
  rig.snapChase(car, ball, true);
  assert.ok(Math.abs(rig.x - -20) < 0.01 && rig.y > 3 && Math.abs(rig.z) < 0.01, `${rig.x} ${rig.y} ${rig.z}`);
  car.x = -38;
  car.z = 24;
  car.h = Math.PI;
  for (let i = 0; i < 120; i++) rig.chase(1 / 60, car, ball, false);
  assert.ok(Math.abs(rig.x) <= 40 && Math.abs(rig.z) <= 26 && rig.y >= 1.5, `${rig.x} ${rig.y} ${rig.z}`);
  // ball cam with the ball behind the car falls back to the car's heading
  rig.snapChase({ x: 0, y: 0.6, z: 0, h: 0, vx: 0, vz: 0 }, { x: -30, y: 2, z: 0 }, true);
  assert.ok(Math.abs(rig.yaw) < 0.2, `yaw ${rig.yaw}`);
  rig.addTrauma(1);
  rig.chase(1 / 60, car, ball, true);
  assert.ok(rig.trauma > 0.9 && Number.isFinite(rig.px) && Number.isFinite(rig.roll));
  rig.shakeOn = false;
  rig.chase(1 / 60, car, ball, true);
  assert.equal(rig.px, rig.x);
  for (const m of ['orbit', 'spectate']) for (let i = 0; i < 60; i++) rig[m](1 / 60, ball);
  for (let i = 0; i < 60; i++) rig.celebrate(1 / 60, 1, [41, 2, 3]);
  for (const v of [rig.px, rig.py, rig.pz, rig.tx, rig.ty, rig.tz, rig.fov]) assert.ok(Number.isFinite(v));
});
