// Entry: store-art posters draw one staged frame and need nothing else; the game joins its room first (before anything
// heavy is built, so a reload doesn't miss its seat) and then builds the world.

import './ui/style.css';
import { JOIN_OPTIONS } from './config.js';

const poster = new URLSearchParams(location.search).get('poster');

async function boot() {
  if (poster) {
    const { runPoster } = await import('./poster.js');
    await runPoster(poster);
    return;
  }
  let ow = window.onceworlds;
  let room = null;
  let stub = null;
  const standalone = async () => {
    const { makeStub } = await import('./net/stub.js');
    stub = makeStub();
    ow = stub.ow;
    room = stub.room;
  };
  if (!ow) await standalone();
  else {
    try {
      ow.ui?.setOrientation?.('landscape');
    } catch (e) {
      // not every phone lets a page ask
    }
    try {
      room = await ow.rooms.join(JOIN_OPTIONS);
    } catch (e) {
      console.warn('[rocket-car-soccer] could not join a room, playing alone', e);
      await standalone();
    }
  }
  const [{ Game }, { View }, { UI }, { Sound }, { Input }] = await Promise.all([
    import('./game.js'),
    import('./render/view.js'),
    import('./ui/ui.js'),
    import('./audio.js'),
    import('./input.js'),
  ]);
  new Game({ ow, room, canvas: document.getElementById('gl'), root: document.getElementById('ui'), deps: { View, UI, Sound, Input } });
}

boot().catch((e) => {
  console.error('[rocket-car-soccer] failed to start', e);
});
