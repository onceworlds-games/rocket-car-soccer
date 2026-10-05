// The View end to end with a renderer that draws nothing: every frame it builds the scene graph, moves the cars, the ball,
// the effects and the camera, and walks the whole graph for NaN. Plus the store-art scenes and badges.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, ctx2d } from './dom.mjs';

installDom();
globalThis.requestAnimationFrame = () => 0;
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
const THREE = await import('three');
const { View } = await import('../src/render/view.js');
const { World } = await import('../src/sim/world.js');
const { makeCar } = await import('../src/sim/car.js');
const { mulberry32 } = await import('../src/sim/rng.js');

function fakeRenderer() {
  const r = {
    outputColorSpace: '',
    toneMapping: 0,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, type: 0 },
    drawn: 0,
    size: null,
    setClearColor() {},
    setPixelRatio(v) {
      this.pr = v;
    },
    setSize(w, h, style) {
      this.size = [w, h, style];
    },
    render(scene, camera) {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      this.drawn++;
      let objects = 0;
      scene.traverseVisible((o) => {
        if (o.isMesh || o.isPoints || o.isSprite) objects++;
        for (const e of o.matrixWorld.elements) if (!Number.isFinite(e)) throw new Error(`NaN matrix on ${o.type}`);
      });
      this.objects = objects;
    },
    dispose() {},
  };
  return r;
}

function makeView(quality = 'high') {
  const renderer = fakeRenderer();
  const view = new View({}, { quality, renderer, rand: mulberry32(2) });
  view.resize(1280, 720, 1);
  return { view, renderer };
}

test('a view draws a world of cars, a ball and a camera frame after frame, and keeps the cars and effects in step', () => {
  for (const quality of ['low', 'medium', 'high']) {
    const { view, renderer } = makeView(quality);
    assert.equal(renderer.size[0], 1280);
    assert.equal(renderer.shadowMap.enabled, quality !== 'low');
    const world = new World(5);
    for (let i = 0; i < 8; i++) {
      const c = makeCar(`c${i}`, 1 + (i % 2), i === 0 ? 'local' : 'bot');
      c.slot = i >> 1;
      c.bot = i > 0;
      world.addCar(c);
    }
    world.kickoff();
    view.syncCars(world, 'c0');
    assert.equal(view.views.size, 8);
    const me = world.byId.get('c0');
    for (let i = 0; i < 600; i++) {
      me.thr = 1;
      me.steer = Math.sin(i / 50);
      me.boostIn = i % 100 < 50;
      if (i % 120 === 10) me.jumpIn = true;
      if (i % 120 === 22) me.jumpIn = true;
      world.step(1 / 60);
      view.rig.chase(1 / 60, me, world.ball, i % 200 < 100);
      view.focus.x = me.x;
      view.focus.z = me.z;
      view.lastTeam = i % 3;
      view.render(1 / 60, 0.5, world);
      if (i === 100) view.hitFx(5, 2, 0, 50, 1);
      if (i === 150) view.goalFx(1, [42, 2, 1]);
      if (i === 200) view.wallFx(10, 3, 5, 30);
      if (i === 220) view.landFx(3, 3, 12);
      if (i === 250) view.padFx(33, 20, true);
      if (i === 300) view.winFx(1);
      if (i === 350) {
        view.setReduced(true);
        view.setQuality('low');
      }
      if (i === 400) view.setQuality(quality);
      if (i === 450) view.slow = 0.3;
      if (i === 500) view.slow = 1;
    }
    assert.equal(renderer.drawn, 600);
    assert.ok(renderer.objects < 200, `${renderer.objects} drawn objects`);
    const out = {};
    view.project(me.x, me.y, me.z, out);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && typeof out.on === 'boolean');
    world.removeCar('c3');
    view.syncCars(world, 'c0');
    assert.equal(view.views.size, 7);
    view.shake(0.5);
    view.render(0, 0, world);
    view.dispose();
  }
});

test('the view survives a world with no cars, a hidden tab and a huge frame time', () => {
  const { view } = makeView();
  const world = new World(1);
  view.syncCars(world, null);
  view.render(5, 0, world);
  view.dtSkip = true;
  view.render(0.05, 0, world);
  view.rig.orbit(0.016, world.ball);
  view.rig.spectate(0.016, world.ball);
  view.render(0.016, 0, world);
  assert.ok(Number.isFinite(view.camera.position.x));
});

test('every store picture stages and renders, holds its frame, and the badges draw', async () => {
  const { runPoster } = await import('../src/poster.js');
  for (const name of ['cover', 'action', 'win', 'icon']) {
    const canvas = { style: {}, getContext: () => ctx2d() };
    document.getElementById = (id) => (id === 'gl' ? canvas : { style: {} });
    document.body.dataset.ready = '';
    let queue = [];
    globalThis.requestAnimationFrame = (cb) => queue.push(cb);
    const renderer = fakeRenderer();
    await runPoster(name, { renderer });
    for (let i = 0; i < 6 && queue.length; i++) {
      const cbs = queue;
      queue = [];
      for (const cb of cbs) cb(0);
    }
    assert.equal(document.body.dataset.ready, '1', `${name} is ready`);
    assert.ok(renderer.drawn > 30, `${name}: ${renderer.drawn} frames drawn`);
    assert.ok(renderer.objects > 20, `${name}: ${renderer.objects} objects in the frame`);
    const [w, h] = name === 'icon' ? [512, 512] : [1280, 720];
    assert.equal(renderer.size[0], w);
    assert.equal(renderer.size[1], h);
    assert.equal(renderer.pr, 1, 'pixel ratio 1');
  }
  for (const id of ['first-goal', 'hat-trick', 'aerial', 'first-win', 'other']) {
    const canvas = { style: {}, getContext: () => ctx2d() };
    document.getElementById = (n) => (n === 'gl' ? canvas : { style: {} });
    document.body.dataset.ready = '';
    await runPoster(`badge-${id}`);
    assert.equal(document.body.dataset.ready, '1');
    assert.equal(canvas.width, 256);
    assert.equal(canvas.height, 256);
  }
});
