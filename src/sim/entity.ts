import type { AttackType, Faction, UnitTag } from '../data/types.js';

export type EntityKind = 'unit' | 'building' | 'mine' | 'doodad' | 'projectile';

export type UnitOrderKind =
  | 'idle'
  | 'move'
  | 'attackMove'
  | 'attack'
  | 'hold'
  | 'stop'
  | 'build'
  | 'repair'
  | 'farm'
  | 'pinMine';

export interface UnitOrder {
  kind: UnitOrderKind;
  x?: number;
  z?: number;
  targetId?: number;
  targetRef?: BuildingEntity | MineEntity;
}

export type CartPhase =
  'toMine' | 'waiting' | 'loading' | 'toDropOff' | 'unloading' | 'idle';

export interface CartState {
  phase: CartPhase;
  carriedGold: number;
  ticks: number;
  mineId?: number;
  mineRef?: MineEntity;
  dropOffId?: number;
  dropOffRef?: BuildingEntity;
  pinnedMineId?: number;
  pinnedMineRef?: MineEntity;
}

export interface TrainingItem {
  unitType: string;
  progress: number;
  food: number;
  gold: number;
}

export interface UnitEntity {
  id: number;
  kind: 'unit';
  player: number;
  type: string;
  faction: Faction;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  radius: number;
  speed: number;
  baseSpeed: number;
  facing: number;
  hp: number;
  maxHp: number;
  pop: number;
  lineOfSight: number;
  tags: readonly UnitTag[];
  order?: UnitOrder;
  orders: UnitOrder[];
  orderGeneration: number;
  path?: { x: number; z: number }[];
  pathTarget?: { x: number; z: number };
  pathPending?: boolean;
  stuckTicks: number;
  stuckProgressX: number;
  stuckProgressZ: number;
  stuckLastCheckTick: number;
  attack?: number;
  attackType?: AttackType | null;
  range?: number;
  minRange?: number;
  cooldown?: number;
  meleeArmor?: number;
  pierceArmor?: number;
  bonus?: Partial<Record<UnitTag, number>>;
  loadedSpeed?: number;
  loaded?: boolean;
  formationSlotX?: number;
  formationSlotZ?: number;
  workAnimation?: 'work' | 'load';
  workStartedTick?: number;
  cart?: CartState;
}

export interface BuildingEntity {
  id: number;
  kind: 'building';
  player: number;
  type: string;
  faction: Faction;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  built: boolean;
  buildProgress: number;
  pop: number;
  faith: number;
  lineOfSight: number;
  meleeArmor: number;
  pierceArmor: number;
  role?: string;
  isTownCenter?: boolean;
  isDropOff?: boolean;
  isGate?: boolean;
  rallyPoint?: { x: number; z: number };
  orientation?: 'horizontal' | 'vertical';
  trainingQueue: TrainingItem[];
}

export interface MineEntity {
  id: number;
  kind: 'mine';
  type: 'gold_mine';
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  width: number;
  height: number;
  goldRemaining: number;
}

export interface DoodadEntity {
  id: number;
  kind: 'doodad';
  type: string;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
}

export interface ProjectileEntity {
  id: number;
  kind: 'projectile';
  player: number;
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  speed: number;
  targetId: number;
  damage: number;
  attackType: AttackType;
}

export type Entity =
  UnitEntity | BuildingEntity | MineEntity | DoodadEntity | ProjectileEntity;
