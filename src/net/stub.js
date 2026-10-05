// What the game runs against when its file is opened on its own, with no platform around it: a solo room that is always in
// its lobby and a minimal `onceworlds`. Enough that nothing throws and the pitch can be driven round.

export function makeStub() {
  const t0 = Date.now();
  const listeners = new Map();
  const me = { id: 'you', name: 'You', presence: null, team: 1, connected: true };
  const room = {
    id: 'solo',
    kind: 'solo',
    teams: 2,
    me,
    players: new Map([[me.id, me]]),
    get online() {
      return [me];
    },
    host: me.id,
    isHost: true,
    connected: true,
    state: {},
    match: { phase: 'lobby', n: 0, min: 1 },
    settings: { time: 180, size: 3 },
    participants: [],
    spectators: [],
    spectating: false,
    running: false,
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    matchNow: () => Date.now() - t0,
    isParticipant: () => false,
    setState(k, v) {
      if (v === null || v === undefined) delete this.state[k];
      else this.state[k] = v;
    },
    setPresence(p) {
      me.presence = p;
    },
    presenceAt: (id) => (id === me.id ? me.presence : null),
    send() {},
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    setSetting(id, value) {
      this.settings = { ...this.settings, [id]: value };
    },
    setReady() {},
    clearReady() {},
    hideLobby() {},
    endMatch() {},
    startMatch() {},
    setOpen() {},
    leave() {},
  };
  const ow = {
    mode: 'standalone',
    now: () => Date.now() - t0 + 1e6,
    on() {},
    settings: {
      quality: 'high',
      reducedMotion: false,
      pixelRatio: (max = 2) => Math.min(window.devicePixelRatio || 1, max),
      on() {},
    },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    player: { get: async () => ({ id: me.id, name: me.name, guest: true }), avatarUrl: async () => null },
    save: { get: async () => null, set: async () => {}, delete: async () => {} },
    badges: { award: async () => false },
    leaderboards: { submit: async () => null },
    ui: { setOrientation() {}, showInvite() {}, setMenuPosition() {}, requestFullscreen() {} },
    rooms: { join: async () => room, on() {} },
  };
  return { ow, room };
}
