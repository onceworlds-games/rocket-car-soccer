// Colours and the display font, shared by the 3D scene and the interface.

export const FONT = '"Russo One", "Arial Black", Impact, system-ui, sans-serif';

/** Team looks, indexed by team number (1 blue, 2 orange). Hex strings for CSS and numbers for three.js. */
export const TEAMS = [
  null,
  { name: 'BLUE', css: '#2f7bff', hex: 0x2f7bff, glow: 0x4d9dff, glowCss: '#4d9dff', dark: '#10285c', symbol: 'circle' },
  { name: 'ORANGE', css: '#ff8420', hex: 0xff8420, glow: 0xffa24a, glowCss: '#ffa24a', dark: '#5c2a08', symbol: 'triangle' },
];

export const INK = '#070b16';
export const PANEL = 'rgba(8, 12, 24, 0.82)';
export const LINE = '#e9f0ff';
export const GOLD = '#ffd23d';
