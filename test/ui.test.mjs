import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, El } from './dom.mjs';

installDom();
globalThis.performance ??= { now: () => Date.now() };
const { UI } = await import('../src/ui/ui.js');

function make() {
  const root = new El('div');
  const calls = [];
  const ui = new UI(root, {
    onPlay: () => calls.push('play'),
    onSetting: (id, v) => calls.push(['setting', id, v]),
    onCam: () => calls.push('cam'),
    onInvite: () => calls.push('invite'),
  });
  return { root, ui, calls };
}

test('the title has one Play button; a tap anywhere on it plays', () => {
  const { root, ui, calls } = make();
  ui.showTitle(true);
  assert.equal(ui.title.hidden, false);
  const buttons = root.find((e) => e.tagName === 'BUTTON' && !e.hidden && !e.parent.hidden && e.parent === ui.title);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent.startsWith('PLAY'), true);
  ui.title.dispatch('pointerdown');
  assert.deepEqual(calls, ['play']);
  ui.showTitle(false);
  assert.equal(ui.title.hidden, true);
});

test('score, clock, boost ring and the cam switch show what they are told', () => {
  const { ui } = make();
  ui.showHud(true);
  ui.setScore(2, 1);
  assert.equal(ui.numB.textContent, '2');
  assert.equal(ui.numO.textContent, '1');
  ui.setScore(3, 1);
  assert.ok(ui.numB._classes.has('bump'), 'a goal bumps the number');
  ui.setClock('2:41');
  assert.equal(ui.clock.textContent, '2:41');
  ui.setClock('OT', 'ot');
  assert.equal(ui.clock.className, 'mid ot');
  ui.setBoost(100, false);
  assert.equal(ui.boostNum.textContent, '100');
  assert.equal(Number(ui.boostFill.style.strokeDashoffset), 0);
  ui.setBoost(0, false);
  assert.ok(ui.boost.className.includes('empty'));
  ui.setBoost(50, true);
  assert.ok(ui.boost.className.includes('on'));
  assert.ok(Math.abs(Number(ui.boostFill.style.strokeDashoffset) - (2 * Math.PI * 40) / 2) < 0.01);
  ui.setCam(true);
  assert.ok(ui.cam._classes.has('on'));
  ui.cam.dispatch('pointerdown');
});

test('callouts, the countdown and the goal banner come and go', () => {
  const { ui } = make();
  ui.say('GOAL!', 'Nova', '#ff8420', 2000, 'ASSIST Kai');
  assert.equal(ui.callout.hidden, false);
  assert.equal(ui.callBig.textContent, 'GOAL!');
  assert.equal(ui.callSub.textContent, 'Nova');
  assert.equal(ui.callSub2.textContent, 'ASSIST Kai');
  ui.say('SAVE!', '', '#fff', 1000, '', true);
  assert.equal(ui.callSub.style.display, 'none');
  ui.tick(performance.now() + 5000);
  assert.equal(ui.callout.hidden, true);
  ui.countdown('3');
  assert.equal(ui.count.hidden, false);
  assert.equal(ui.count.textContent, '3');
  ui.countdown('2');
  assert.equal(ui.count.textContent, '2');
  ui.countdown(null);
  assert.equal(ui.count.hidden, true);
  ui.setBanner('SCORE IN ORANGE GOAL', '#ffa24a');
  assert.equal(ui.banner.hidden, false);
  assert.equal(ui.banner.textContent, 'SCORE IN ORANGE GOAL');
  ui.setBanner('', '');
  assert.equal(ui.banner.hidden, true);
  ui.flash();
});

test('name tags: one per player, reused, hidden when unwanted, text never parsed as markup', () => {
  const { ui } = make();
  ui.beginTags();
  ui.tag('a', '<img src=x onerror=alert(1)>', 1, 100, 50, 1, true, 'https://example.test/a.svg');
  ui.tag('b', 'Bea', 2, 300, 80, 0.5, false, null);
  ui.endTags();
  assert.equal(ui.tags.children.length, 2);
  const a = ui.tagMap.get('a');
  assert.equal(a.nm.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(a.nm.children.length, 0, 'the name is text, not elements');
  assert.equal(a.av.children[0].crossOrigin, 'anonymous');
  assert.equal(a.rd.hidden, false);
  assert.ok(ui.tagMap.get('b').av.textContent === 'B', 'a letter stands in for a missing face');
  assert.ok(a.el.style.transform.includes('100px'));
  ui.beginTags();
  ui.tag('a', 'Ann', 1, 120, 60, 1, false, 'https://example.test/a.svg');
  ui.endTags();
  assert.equal(ui.tags.children.length, 2, 'the same element is reused');
  assert.equal(ui.tagMap.get('b').shown, false);
  assert.equal(ui.tagMap.get('b').el.style.display, 'none');
  for (let i = 0; i < 700; i++) {
    ui.beginTags();
    ui.tag('a', 'Ann', 1, 120, 60, 1, false, null);
    ui.endTags();
  }
  assert.equal(ui.tagMap.has('b'), false, 'a tag nobody wants any more is dropped');
  ui.setArrow(true, 10, 20, '#fff');
  assert.equal(ui.arrow.hidden, false);
  ui.setArrow(false, 0, 0, '#fff');
  assert.equal(ui.arrow.hidden, true);
});

test('lobby settings: big values, the host steps through the options, the others only look', () => {
  const { ui, calls } = make();
  const list = [
    { id: 'time', label: 'TIME', value: 180, options: [{ value: 120, label: '2:00' }, { value: 180, label: '3:00' }, { value: 300, label: '5:00' }] },
    { id: 'size', label: 'TEAMS', value: 3, options: [{ value: 1, label: '1v1' }, { value: 2, label: '2v2' }, { value: 3, label: '3v3' }] },
  ];
  ui.setSettings(list, true);
  const t = ui.settingEls.get('time');
  assert.equal(t.val.textContent, '3:00');
  assert.equal(ui.settingEls.get('size').val.textContent, '3v3');
  t.btn.dispatch('pointerdown');
  ui.settingEls.get('size').btn.dispatch('pointerdown');
  assert.deepEqual(calls, [['setting', 'time', 300], ['setting', 'size', 1]]);
  ui.setSettings(list, false);
  t.btn.dispatch('pointerdown');
  assert.equal(calls.length, 2, 'a non-host tap does nothing');
  assert.equal(t.btn.disabled, true);
  ui.setHint('Hit the ball into their goal');
  assert.equal(ui.hint.textContent, 'Hit the ball into their goal');
  ui.showInviteButton(true);
  ui.invite.dispatch('pointerdown');
  assert.ok(calls.includes('invite'));
  ui.setLegend(true);
  ui.legendUsed('jump');
  assert.ok(ui.legendItems.jump._classes.has('used'));
  ui.setSpectating(true);
  assert.equal(ui.watching.hidden, false);
  assert.equal(ui.boost.hidden, true);
  ui.setSpectating(false);
  assert.equal(ui.watching.hidden, true);
});

test('results: a podium of three, your place when you are lower, and the closed-room card', () => {
  const { ui, root } = make();
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, team: 1 + (i % 2), pts: 600 - i * 90, mvp: i === 0, you: i === 4, avatar: i === 0 ? 'https://example.test/x.svg' : null }));
  ui.showResults({ head: 'BLUE WINS', color: '#4d9dff', score: [3, 2], rows, you: 4 });
  assert.ok(ui.results);
  const text = ui.results.textContent;
  assert.ok(text.includes('BLUE WINS') && text.includes('MVP') && text.includes('YOU: 5TH'), text);
  assert.equal(ui.results.find((e) => e._classes.has('pod')).length, 3);
  ui.showResults({ head: 'DRAW', color: '#fff', score: [1, 1], rows: rows.slice(0, 2), you: 0 });
  assert.equal(root.find((e) => e._classes.has('results')).length, 1, 'a new card replaces the old one');
  assert.ok(!ui.results.textContent.includes('YOU:'));
  ui.hideResults();
  assert.equal(ui.results, null);
  let pressed = 0;
  ui.showClosed('YOU WERE REMOVED', 'PLAY', () => pressed++);
  const btn = ui.closed.find((e) => e.tagName === 'BUTTON')[0];
  btn.dispatch('pointerdown');
  assert.equal(pressed, 1);
  ui.hideClosed();
  assert.equal(ui.closed, null);
});
