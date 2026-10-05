// Store art, drawn by the game itself. With `?poster=<name>` the page skips the room and the SDK and draws one staged,
// deterministic frame with the real renderer (a fixed seed, the action frozen at its best moment, no interface), then sets
// document.body.dataset.ready = '1'. Names: cover, action, win (1280x720), icon (512x512) and badge-<id> (256x256).

import { World } from './sim/world.js';
import { makeCar } from './sim/car.js';
import { mulberry32 } from './sim/rng.js';
import { CAR_Y, BALL_R } from './sim/consts.js';
import { View } from './render/view.js';
import { FONT } from './render/palette.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

function placeCarAt(world, id, team, x, y, z, h, o = {}) {
  const c = makeCar(id, team, 'remote');
  c.accent = o.accent ?? 0;
  c.slot = o.slot ?? 0;
  world.addCar(c);
  c.x = c.px = x;
  c.y = c.py = y;
  c.z = c.pz = z;
  c.h = c.ph = h;
  c.p = c.pp = o.p ?? 0;
  const speed = o.speed ?? 0;
  c.vx = Math.cos(h) * speed;
  c.vz = Math.sin(h) * speed;
  c.vy = o.vy ?? 0;
  c.ground = y <= CAR_Y + 0.05;
  c.boosting = !!o.boost;
  c.ss = !!o.ss;
  c.dodge = o.dodge ?? 0;
  c.dodgeA = o.dodgeA ?? 0;
  return c;
}

function setBall(world, x, y, z, vx = 0, vy = 0, vz = 0) {
  const b = world.ball;
  b.x = b.px = x;
  b.y = b.py = y;
  b.z = b.pz = z;
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
}

// ---------------------------------------------------------------- the five 3D scenes

function stageCover(view, world) {
  view.stage.setBoard(2, 1, '1:42');
  // an orange car in the air about to hit the ball toward the blue goal, a blue car racing below it
  setBall(world, -30.5, 5.6, 1.5, -16, 6, 0);
  placeCarAt(world, 'o1', 2, -26.2, 4.4, 1.2, Math.PI + 0.05, { p: 0.5, boost: true, speed: 26, vy: 6, accent: 1, dodge: 0 });
  placeCarAt(world, 'b1', 1, -31.5, CAR_Y, -3.6, 0.5, { boost: true, speed: 20, accent: 3, ss: true });
  placeCarAt(world, 'b2', 1, -34, CAR_Y, 9, -0.4, { speed: 10, accent: 5, slot: 1 });
  view.lastTeam = 2;
  view.focus.x = -26;
  view.focus.z = 0;
  view.rig.place(-20.2, 1.7, -4.4, -30.2, 3.9, 1.6, 58);
  return () => view.hitFx(-29.4, 5.4, 1.4, 62, 2);
}

function stageAction(view, world) {
  view.stage.setBoard(3, 2, '0:31');
  // blue has just scored in the orange net: the ball is in it and the blast is going off
  setBall(world, 42.6, 2.4, 1.4, 6, 1, 0);
  placeCarAt(world, 'b1', 1, 35.5, 1.6, -3.5, 0.15, { p: 0.08, boost: true, speed: 22, vy: 1, accent: 1, dodge: 0 });
  placeCarAt(world, 'o1', 2, 33, CAR_Y, 6.5, Math.PI - 0.5, { speed: 12, accent: 2 });
  view.lastTeam = 1;
  view.focus.x = 32;
  view.focus.z = 0;
  view.rig.place(30.5, 4.0, -9.5, 40.5, 3.0, 1.2, 60);
  return () => view.goalFx(1, [42.6, 2.4, 1.4]);
}

function stageWin(view, world) {
  view.stage.setBoard(4, 2, '0:00');
  // the winners in a row, one in the air, confetti and light beams behind them
  const z = [-7.2, 0, 7.2];
  placeCarAt(world, 'b1', 1, -1.5, CAR_Y, z[0], 0.9, { speed: 0, accent: 1 });
  placeCarAt(world, 'b2', 1, 1.2, CAR_Y, z[1], 0, { speed: 0, accent: 3, slot: 1 });
  placeCarAt(world, 'b3', 1, -1.5, CAR_Y, z[2], -0.9, { speed: 0, accent: 5, slot: 2 });
  setBall(world, -13, BALL_R, 0);
  view.lastTeam = 1;
  view.rig.place(9.5, 2.3, 0, -2, 2.3, 0, 58);
  return () => {
    view.fx.confetti(-2, 14, 0, 170, 26, 5);
    for (const zz of z) view.fx.beam(-9, zz * 1.5, 0x4d9dff, 1.8, 20, 0.34);
    view.fx.beam(-9, 0, 0xffffff, 1.2, 20, 0.3);
  };
}

function stageIcon(view, world) {
  view.stage.setBoard(0, 0, '');
  // one hero: an orange car boosting through the air toward the ball, low and from the side
  placeCarAt(world, 'o1', 2, 0, 1.55, 0, -0.55, { p: 0.3, boost: true, speed: 30, vy: 3, accent: 1, ss: true });
  setBall(world, 9.5, 3.6, -7.5);
  view.lastTeam = 2;
  view.rig.place(-7.09, 1.2, -6.08, -1.5, 1.5, 0, 48);
  return () => {};
}

const SCENES = { cover: stageCover, action: stageAction, win: stageWin, icon: stageIcon };

// ---------------------------------------------------------------- badges: a bold symbol on a coloured disc

function disc(g, c1, c2) {
  const grad = g.createRadialGradient(100, 80, 10, 128, 128, 128);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(128, 128, 120, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
}

function ball(g, x, y, r) {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#f4f6fb';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#141a30';
  const pent = (px, py, pr) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      g.lineTo(px + Math.cos(a) * pr, py + Math.sin(a) * pr);
    }
    g.closePath();
    g.fill();
  };
  pent(0, 0, r * 0.38);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pent(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98, r * 0.3);
  }
  g.lineWidth = Math.max(2, r * 0.07);
  g.strokeStyle = '#141a30';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function star(g, x, y, r, fill) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#6b4a00';
  g.lineJoin = 'round';
  g.stroke();
  g.restore();
}

function car(g, x, y, s, body) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(-60, 8);
  g.lineTo(-56, -10);
  g.lineTo(-22, -14);
  g.lineTo(-8, -34);
  g.lineTo(26, -34);
  g.lineTo(40, -14);
  g.lineTo(62, -8);
  g.lineTo(64, 8);
  g.closePath();
  g.fill();
  g.fillStyle = '#0c1220';
  g.beginPath();
  g.moveTo(-4, -30);
  g.lineTo(22, -30);
  g.lineTo(32, -15);
  g.lineTo(-14, -15);
  g.closePath();
  g.fill();
  g.fillStyle = '#10131c';
  for (const wx of [-36, 38]) {
    g.beginPath();
    g.arc(wx, 10, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d3d8e4';
    g.beginPath();
    g.arc(wx, 10, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#10131c';
  }
  g.restore();
}

function wings(g, x, y, s, color) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = color;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  for (const dir of [-1, 1]) {
    g.save();
    g.scale(dir, 1);
    g.beginPath();
    g.moveTo(14, -6);
    g.quadraticCurveTo(52, -50, 96, -44);
    g.quadraticCurveTo(76, -26, 84, -12);
    g.quadraticCurveTo(62, -12, 58, 2);
    g.quadraticCurveTo(40, 0, 36, 10);
    g.quadraticCurveTo(24, 8, 14, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  g.restore();
}

function trophy(g) {
  g.save();
  g.translate(128, 128);
  g.fillStyle = '#fff3b0';
  g.strokeStyle = '#7a5300';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  // handles
  g.beginPath();
  g.arc(-52, -22, 26, Math.PI * 0.5, Math.PI * 1.5);
  g.moveTo(52 + 0, -22 + 26);
  g.arc(52, -22, 26, Math.PI * 0.5, -Math.PI * 0.5, true);
  g.stroke();
  // cup
  g.beginPath();
  g.moveTo(-50, -56);
  g.lineTo(50, -56);
  g.quadraticCurveTo(50, 26, 0, 36);
  g.quadraticCurveTo(-50, 26, -50, -56);
  g.closePath();
  g.fill();
  g.stroke();
  // stem and base
  g.fillStyle = '#e8b520';
  g.fillRect(-9, 34, 18, 24);
  g.strokeRect(-9, 34, 18, 24);
  g.beginPath();
  g.rect(-34, 58, 68, 18);
  g.fill();
  g.stroke();
  star(g, 0, -14, 22, '#e8b520');
  g.restore();
}

function drawBadge(canvas, id) {
  const g = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 256;
  g.clearRect(0, 0, 256, 256);
  if (id === 'first-goal') {
    disc(g, '#4d9dff', '#103a9a');
    ball(g, 118, 136, 62);
    star(g, 184, 74, 40, '#ffd23d');
  } else if (id === 'hat-trick') {
    disc(g, '#ffa24a', '#a8420a');
    ball(g, 128, 84, 40);
    ball(g, 84, 164, 40);
    ball(g, 172, 164, 40);
  } else if (id === 'aerial') {
    disc(g, '#8f7bff', '#2a1a78');
    wings(g, 128, 142, 1.05, '#5ee9ff');
    car(g, 128, 150, 1.1, '#ff8420');
  } else if (id === 'first-win') {
    disc(g, '#ffd23d', '#b8650a');
    trophy(g);
  } else {
    disc(g, '#4d9dff', '#103a9a');
    ball(g, 128, 128, 62);
  }
}

// ---------------------------------------------------------------- run

export async function runPoster(name, { renderer = null } = {}) {
  const canvas = document.getElementById('gl');
  const root = document.getElementById('ui');
  const isBadge = name.startsWith('badge-');
  const key = isBadge ? 'badge' : SIZES[name] ? name : 'cover';
  const [W, H] = isBadge ? [256, 256] : SIZES[key];
  document.body.style.cssText = `margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#05070f`;
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;display:block`;
  root.style.display = 'none';
  try {
    await Promise.all([document.fonts.load(`64px "Russo One"`), document.fonts.load(`28px "Russo One"`)]);
    await document.fonts.ready;
  } catch (e) {
    // the fallback font will do
  }
  if (isBadge) {
    drawBadge(canvas, name.slice(6));
    document.body.dataset.ready = '1';
    return;
  }

  const rand = mulberry32(20261004);
  const view = new View(canvas, { quality: 'high', poster: true, rand, renderer });
  view.resize(W, H, 1);
  const world = new World(7);
  const fire = SCENES[key](view, world);
  view.syncCars(world, null);
  view.stage.redrawBoard();
  view.fx.resize(H, view.camera.fov);
  const frame = (t) => {
    view.render(t, 1, world);
  };
  // let the cars settle, the flames and sparks grow, then hold the frame
  for (let i = 0; i < 24; i++) frame(1 / 60);
  fire();
  const settle = key === 'win' ? 70 : key === 'action' ? 16 : 10;
  for (let i = 0; i < settle; i++) frame(1 / 60);
  view.freeze = true;

  if (key === 'cover') {
    const title = document.createElement('div');
    title.textContent = 'ROCKET CAR SOCCER';
    title.style.cssText = `position:fixed;left:0;right:0;top:34px;text-align:center;font:${H * 0.115}px ${FONT};color:#fff;letter-spacing:0.04em;transform:skewX(-8deg);text-shadow:0 5px 0 rgba(0,0,0,0.6),0 0 40px rgba(0,0,0,0.6);-webkit-text-stroke:3px rgba(5,8,18,0.75);paint-order:stroke fill`;
    document.body.appendChild(title);
  }

  const hold = () => {
    view.render(0, 1, world);
    requestAnimationFrame(hold);
  };
  view.render(0, 1, world);
  requestAnimationFrame(() => {
    view.render(0, 1, world);
    requestAnimationFrame(() => {
      document.body.dataset.ready = '1';
      hold();
    });
  });
}
