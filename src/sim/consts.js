// Numbers shared by the simulation, the rules and the renderer. Units are metres and seconds.
// x runs along the pitch (goals at x = ±PX), z across it, y is up. Blue defends x = -PX and attacks +x.

export const STEP = 1 / 60;

export const PX = 40; // half length: the goal lines
export const PZ = 26; // half width
export const WALL_H = 6;
export const CEIL = 18;
export const GOAL_HW = 7; // half width of a goal mouth (14 wide)
export const GOAL_H = 6;
export const GOAL_D = 5;
export const CORNER = 8; // size of the 45 degree corner walls

export const BALL_R = 1.9;

export const CAR_HX = 1.6; // half of 3.2 long
export const CAR_HY = 0.6; // half of 1.2 high
export const CAR_HZ = 0.9; // half of 1.8 wide
export const CAR_R = 1.3; // circle used against walls and other cars
export const CAR_Y = CAR_HY; // height of a grounded car's centre

export const TEAM_BLUE = 1;
export const TEAM_ORANGE = 2;
export const MAX_TEAM = 4;

/** Car tuning. */
export const CARP = {
  accel: 22,
  reverse: 14,
  reverseMax: 14,
  brake: 40,
  coast: 6,
  max: 23,
  boostMax: 33,
  boostAccel: 28,
  overspeed: 12,
  boostUse: 33,
  boostRegen: 4,
  turnLow: 2.6,
  turnHigh: 1.6,
  grip: 9,
  gravity: 30,
  jumpV: 9,
  doubleJumpV: 8,
  dodgeV: 10,
  dodgeWindow: 1.2,
  dodgeTime: 0.45,
  airYaw: 1.3,
  airPitch: 2.3,
  airBoost: 40,
  airMax: 36,
  airDrag: 0.02,
  wallBounce: 0.25,
  kickoffBoost: 33,
  supersonic: 0.95,
};

/** Ball tuning. */
export const BALLP = {
  gravity: 22,
  rest: 0.7,
  drag: 0.03,
  max: 60,
  groundFriction: 0.18,
  minBounce: 1.4,
};

/** Car against ball. */
export const HITP = {
  inflate: 0.15,
  restitution: 0.6, // separation speed as a share of the approach speed (the 1.6 impulse)
  power: 6,
  dodge: 8,
  recoil: 0.12,
  lift: 0.4, // share of the contact normal's upward part that drives the ball
};

export const PAD_SMALL = { amount: 12, cooldown: 4, radius: 2.4 };
export const PAD_BIG = { amount: 100, cooldown: 10, radius: 3.2 };
/** Boost pads: six small ones along the sides and the middle, four big ones in the corners. */
export const PADS = [
  { x: 0, z: 19, big: false },
  { x: 0, z: -19, big: false },
  { x: 21, z: 12, big: false },
  { x: 21, z: -12, big: false },
  { x: -21, z: 12, big: false },
  { x: -21, z: -12, big: false },
  { x: 33, z: 20, big: true },
  { x: 33, z: -20, big: true },
  { x: -33, z: 20, big: true },
  { x: -33, z: -20, big: true },
];

/** Lobby settings the host picks. */
export const TIME_OPTIONS = [
  { value: 120, label: '2:00' },
  { value: 180, label: '3:00' },
  { value: 300, label: '5:00' },
];
export const SIZE_OPTIONS = [
  { value: 1, label: '1v1' },
  { value: 2, label: '2v2' },
  { value: 3, label: '3v3' },
];
export const DEFAULT_TIME = 180;
export const DEFAULT_SIZE = 3;

/** Match timing, in match milliseconds. */
export const KICKOFF_MS = 3000;
export const GOAL_MS = 3000;
export const END_MS = 1800;
export const RESULTS_MS = 9000;
export const OT_CAP_MS = 300000;

export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

/** Own-accent stripe colours (hex) a car can wear on top of its team colour. */
export const ACCENTS = ['#ffffff', '#c6ff3d', '#ff3dcb', '#ffe23d', '#3dffd9', '#b67bff', '#111418', '#ff5d5d'];
