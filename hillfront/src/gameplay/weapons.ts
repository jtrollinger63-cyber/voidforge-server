/**
 * Weapon definitions: pure game-balance data (no rendering). All names are original/fictional.
 * Numbers are game abstractions tuned for readable fights, not real-world ballistics.
 */

export type WeaponId = 'knife' | 'p50' | 'm9' | 'a5' | 't12' | 'r7';
export type WeaponSlot = 'primary' | 'secondary' | 'melee';
export type GripSet = 'rifle' | 'sidearm' | 'blade';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  blurb: string;
  slot: WeaponSlot;
  gripSet: GripSet;
  auto: boolean;
  /** damage per bullet / pellet */
  damage: number;
  pellets: number;
  headMul: number;
  /** fraction of damage that goes to health while armored (rest is soaked by armor) */
  armorPen: number;
  rpm: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  equipTime: number;
  /** spread cone half-angle in degrees */
  spreadBase: number;
  spreadMove: number;
  spreadJump: number;
  crouchMul: number;
  /** view punch added per shot (degrees) and its recovery rate (1/s) */
  kick: number;
  kickYaw: number;
  recover: number;
  range: number;
  /** multiplicative damage loss per 10 m */
  falloff: number;
  price: number;
  killReward: number;
  moveMul: number;
  /** third-person world model id inside weapons3p.glb */
  model3p: { vanguard: string; garrison: string };
  /** first-person viewmodel clip names once a CuiGames GLB is imported (see weapons/profiles.ts) */
  fov: number;
}

const ATTACKER_RIFLE = 'attacker-rifle', DEFENDER_CARBINE = 'defender-carbine';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'Field Knife', blurb: 'Silent and fast. Backstabs hurt.', slot: 'melee', gripSet: 'blade', auto: false,
    damage: 45, pellets: 1, headMul: 1, armorPen: 0.9, rpm: 110, mag: 1, reserve: 0, reloadTime: 0, equipTime: 0.35,
    spreadBase: 0, spreadMove: 0, spreadJump: 0, crouchMul: 1, kick: 0, kickYaw: 0, recover: 10, range: 1.7, falloff: 1, price: 0, killReward: 1500, moveMul: 1.06,
    model3p: { vanguard: 'combat-knife', garrison: 'combat-knife' }, fov: 70,
  },
  p50: {
    id: 'p50', name: 'P50 Heavy Pistol', blurb: 'Hard-hitting sidearm. Reliable on every budget.', slot: 'secondary', gripSet: 'sidearm', auto: false,
    damage: 34, pellets: 1, headMul: 3.1, armorPen: 0.55, rpm: 380, mag: 12, reserve: 36, reloadTime: 2.0, equipTime: 0.4,
    spreadBase: 0.35, spreadMove: 3.0, spreadJump: 6, crouchMul: 0.7, kick: 1.0, kickYaw: 0.25, recover: 7, range: 70, falloff: 0.9, price: 0, killReward: 300, moveMul: 1.0,
    model3p: { vanguard: 'service-pistol', garrison: 'service-pistol' }, fov: 70,
  },
  m9: {
    id: 'm9', name: 'M9 Compact SMG', blurb: 'Cheap, fast and forgiving. Great close in, and pays well per kill.', slot: 'primary', gripSet: 'rifle', auto: true,
    damage: 24, pellets: 1, headMul: 3.0, armorPen: 0.6, rpm: 780, mag: 30, reserve: 120, reloadTime: 2.2, equipTime: 0.5,
    spreadBase: 0.8, spreadMove: 3.6, spreadJump: 7, crouchMul: 0.75, kick: 0.5, kickYaw: 0.28, recover: 6, range: 55, falloff: 0.86, price: 1250, killReward: 600, moveMul: 0.98,
    model3p: { vanguard: 'full-smg', garrison: 'full-smg' }, fov: 70,
  },
  a5: {
    id: 'a5', name: 'A5 Carbine', blurb: 'The all-rounder. Accurate bursts, punishing sprays.', slot: 'primary', gripSet: 'rifle', auto: true,
    damage: 32, pellets: 1, headMul: 4.0, armorPen: 0.78, rpm: 600, mag: 30, reserve: 90, reloadTime: 2.4, equipTime: 0.6,
    spreadBase: 0.25, spreadMove: 5.0, spreadJump: 8, crouchMul: 0.65, kick: 0.85, kickYaw: 0.35, recover: 5.5, range: 100, falloff: 0.94, price: 2700, killReward: 300, moveMul: 0.9,
    model3p: { vanguard: ATTACKER_RIFLE, garrison: DEFENDER_CARBINE }, fov: 68,
  },
  t12: {
    id: 't12', name: 'T12 Auto Shotgun', blurb: 'Devastating in tight streets. Weak beyond the arch.', slot: 'primary', gripSet: 'rifle', auto: true,
    damage: 11, pellets: 8, headMul: 1.8, armorPen: 0.5, rpm: 170, mag: 8, reserve: 32, reloadTime: 2.9, equipTime: 0.7,
    spreadBase: 4.4, spreadMove: 5.5, spreadJump: 8, crouchMul: 0.85, kick: 2.4, kickYaw: 0.6, recover: 4.5, range: 28, falloff: 0.7, price: 1800, killReward: 900, moveMul: 0.92,
    model3p: { vanguard: 'pump-shotgun', garrison: 'pump-shotgun' }, fov: 70,
  },
  r7: {
    id: 'r7', name: 'R7 Marksman', blurb: 'Semi-auto precision. One good hit changes the round.', slot: 'primary', gripSet: 'rifle', auto: false,
    damage: 82, pellets: 1, headMul: 3.0, armorPen: 0.86, rpm: 150, mag: 10, reserve: 30, reloadTime: 3.0, equipTime: 0.8,
    spreadBase: 0.08, spreadMove: 7.5, spreadJump: 10, crouchMul: 0.5, kick: 2.2, kickYaw: 0.4, recover: 4.0, range: 140, falloff: 0.97, price: 3000, killReward: 300, moveMul: 0.84,
    model3p: { vanguard: 'marksman-rifle', garrison: 'marksman-rifle' }, fov: 55,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const BUYABLE_PRIMARY: WeaponId[] = ['m9', 't12', 'a5', 'r7'];

export interface BuyItem { id: string; name: string; price: number; kind: 'weapon' | 'armor' | 'kit'; weapon?: WeaponId; team?: 'vanguard' | 'garrison'; }
export const BUY_ITEMS: BuyItem[] = [
  { id: 'p50', name: WEAPONS.p50.name, price: 0, kind: 'weapon', weapon: 'p50' },
  { id: 'm9', name: WEAPONS.m9.name, price: WEAPONS.m9.price, kind: 'weapon', weapon: 'm9' },
  { id: 't12', name: WEAPONS.t12.name, price: WEAPONS.t12.price, kind: 'weapon', weapon: 't12' },
  { id: 'a5', name: WEAPONS.a5.name, price: WEAPONS.a5.price, kind: 'weapon', weapon: 'a5' },
  { id: 'r7', name: WEAPONS.r7.name, price: WEAPONS.r7.price, kind: 'weapon', weapon: 'r7' },
  { id: 'armor', name: 'Plate Carrier + Helmet', price: 650, kind: 'armor' },
  { id: 'kit', name: 'Disarm Kit', price: 400, kind: 'kit', team: 'garrison' },
];

/** damage multiplier by distance (metres) */
export function falloffMul(def: WeaponDef, dist: number): number {
  return Math.pow(def.falloff, Math.max(0, dist) / 10);
}
