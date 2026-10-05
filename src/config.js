// The room this game asks for, and a few helpers every module shares.

import { TIME_OPTIONS, SIZE_OPTIONS, DEFAULT_TIME, DEFAULT_SIZE } from './sim/consts.js';

/** What `rooms.join` is given, on the first join and again after a closed room. */
export const JOIN_OPTIONS = {
  maxPlayers: 8,
  teams: 2,
  minPlayers: 1,
  lobby: 'bar',
  settings: [
    { id: 'time', label: 'Time', options: TIME_OPTIONS.map((o) => ({ ...o })), default: DEFAULT_TIME },
    { id: 'size', label: 'Teams', options: SIZE_OPTIONS.map((o) => ({ ...o })), default: DEFAULT_SIZE },
  ],
};

/** The lobby's settings as the interface lists them. */
export const SETTING_LIST = [
  { id: 'time', label: 'TIME', options: TIME_OPTIONS },
  { id: 'size', label: 'TEAMS', options: SIZE_OPTIONS },
];

/** A setting value taken from the room, kept to what this game offers. */
export function settingValue(settings, id) {
  const list = id === 'time' ? TIME_OPTIONS : SIZE_OPTIONS;
  const v = settings ? settings[id] : undefined;
  if (list.some((o) => o.value === v)) return v;
  return id === 'time' ? DEFAULT_TIME : DEFAULT_SIZE;
}

/** m:ss, rounding up so the clock reads 0:01 until it is really over. */
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
