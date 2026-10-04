import { create } from 'zustand';
import type { GameSession } from '../game/GameSession';
import { screenToGround, type IsoView } from '../render/iso';
import type { EntityKind } from '../sim/entity';
import { CROWN_UNITS } from '../data/units';
import { CROWN_BUILDINGS } from '../data/buildings';

export interface HudResources {
  food: number;
  gold: number;
  faithUsed: number;
  faithProduced: number;
  pop: number;
  popCap: number;
  age: 1 | 2 | 3;
  faction: string;
}

export interface SelectedEntityData {
  id: number;
  kind: EntityKind;
  type: string;
  name: string;
  player?: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  pop?: number;
  faith?: number;
  attack?: number;
  range?: number;
  meleeArmor?: number;
  pierceArmor?: number;
  speed?: number;
  goldRemaining?: number;
  built?: boolean;
  buildProgress?: number;
}

export interface MinimapUnit {
  id: number;
  x: number;
  z: number;
  player: number;
  kind: EntityKind;
  type: string;
}

export interface MinimapData {
  mapSize: number;
  tiles: Uint8Array | null;
  units: readonly MinimapUnit[];
  cameraView: IsoView | null;
  viewportCorners:
    | readonly [
        { x: number; z: number },
        { x: number; z: number },
        { x: number; z: number },
        { x: number; z: number },
      ]
    | null;
}

export interface HudOrders {
  mode: 'move' | 'attackMove' | null;
  submenu: 'economic' | 'military' | null;
}

export interface HudState {
  resources: HudResources;
  selection: readonly SelectedEntityData[];
  orders: HudOrders;
  status: string;
  minimap: MinimapData;
  setStatus: (message: string) => void;
  setOrdersMode: (mode: 'move' | 'attackMove' | null) => void;
  setOrdersSubmenu: (submenu: 'economic' | 'military' | null) => void;
  reset: () => void;
}

export function getEntityDisplayName(entity: {
  kind: EntityKind;
  type?: string;
}): string {
  const t = entity.type ?? '';
  if (t === 'peasant') return CROWN_UNITS.peasant.name;
  if (t === 'spearman') return CROWN_UNITS.spearman.name;
  if (t === 'ox_cart') return CROWN_UNITS.ox_cart.name;
  if (t === 'keep') return CROWN_BUILDINGS.keep.name;
  if (t === 'cottage') return CROWN_BUILDINGS.cottage.name;
  if (t === 'farm') return CROWN_BUILDINGS.farm.name;
  if (t === 'gold_mine' || entity.kind === 'mine') return 'Gold Mine';
  if (t.startsWith('tree')) return 'Tree';
  if (t.startsWith('rock')) return 'Rock';
  return t
    ? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Unknown';
}

const INITIAL_RESOURCES: HudResources = {
  food: 0,
  gold: 0,
  faithUsed: 0,
  faithProduced: 0,
  pop: 0,
  popCap: 0,
  age: 1,
  faction: 'crown',
};

const INITIAL_ORDERS: HudOrders = {
  mode: null,
  submenu: null,
};

const INITIAL_MINIMAP: MinimapData = {
  mapSize: 128,
  tiles: null,
  units: [],
  cameraView: null,
  viewportCorners: null,
};

export const useHudStore = create<HudState>((set) => ({
  resources: INITIAL_RESOURCES,
  selection: [],
  orders: INITIAL_ORDERS,
  status: '',
  minimap: INITIAL_MINIMAP,
  setStatus: (message: string) => set({ status: message }),
  setOrdersMode: (mode) => set((s) => ({ orders: { ...s.orders, mode } })),
  setOrdersSubmenu: (submenu) =>
    set((s) => ({ orders: { ...s.orders, submenu } })),
  reset: () =>
    set({
      resources: INITIAL_RESOURCES,
      selection: [],
      orders: INITIAL_ORDERS,
      status: '',
      minimap: INITIAL_MINIMAP,
    }),
}));

export function setHudStatus(message: string): void {
  useHudStore.setState({ status: message });
}

export function resetHud(): void {
  useHudStore.getState().reset();
}

export function publishHud(session: GameSession): void {
  if (!session) return;

  const sim = session.sim;
  const world = sim?.world;
  const p0 = world?.players?.[0];

  const resources: HudResources = p0
    ? {
        food: p0.food,
        gold: p0.gold,
        faithUsed: p0.faithUsed,
        faithProduced: p0.faithProduced,
        pop: p0.pop,
        popCap: p0.popCap,
        age: p0.age,
        faction: p0.faction,
      }
    : INITIAL_RESOURCES;

  // Read input safely using property guards
  const sessionObj: unknown = session;
  let selectedIds: readonly number[] = [];
  let ordersMode: 'move' | 'attackMove' | null = null;
  let ordersSubmenu: 'economic' | 'military' | null = null;

  if (sessionObj && typeof sessionObj === 'object' && 'input' in sessionObj) {
    const input = sessionObj.input;
    if (input && typeof input === 'object') {
      if (
        'selection' in input &&
        input.selection &&
        typeof input.selection === 'object' &&
        'ids' in input.selection
      ) {
        const ids = input.selection.ids;
        if (Array.isArray(ids)) {
          selectedIds = ids;
        }
      }
      if (
        'orders' in input &&
        input.orders &&
        typeof input.orders === 'object'
      ) {
        const ord = input.orders;
        if (
          'mode' in ord &&
          (ord.mode === 'move' ||
            ord.mode === 'attackMove' ||
            ord.mode === null)
        ) {
          ordersMode = ord.mode;
        }
        if (
          'submenu' in ord &&
          (ord.submenu === 'economic' ||
            ord.submenu === 'military' ||
            ord.submenu === null)
        ) {
          ordersSubmenu = ord.submenu;
        }
      }
    }
  }

  // Snapshot selection immutably (deep enough copy so it doesn't mutate)
  const selectedList: SelectedEntityData[] = [];
  for (const id of selectedIds) {
    const raw = world?.getEntity?.(id);
    if (!raw || raw.kind === 'projectile') continue;

    const entData: SelectedEntityData = {
      id: raw.id,
      kind: raw.kind,
      type: 'type' in raw ? raw.type : '',
      name: getEntityDisplayName(raw),
      player: 'player' in raw ? raw.player : undefined,
      hp: 'hp' in raw ? raw.hp : 0,
      maxHp: 'maxHp' in raw ? raw.maxHp : 0,
      x: raw.x,
      z: raw.z,
      pop: 'pop' in raw ? raw.pop : undefined,
      faith: 'faith' in raw ? raw.faith : undefined,
      attack: 'attack' in raw ? raw.attack : undefined,
      range: 'range' in raw ? raw.range : undefined,
      meleeArmor: 'meleeArmor' in raw ? raw.meleeArmor : undefined,
      pierceArmor: 'pierceArmor' in raw ? raw.pierceArmor : undefined,
      speed: 'speed' in raw ? raw.speed : undefined,
      goldRemaining: 'goldRemaining' in raw ? raw.goldRemaining : undefined,
      built: 'built' in raw ? raw.built : undefined,
      buildProgress: 'buildProgress' in raw ? raw.buildProgress : undefined,
    };
    selectedList.push(entData);
  }

  // Orders state snapshot
  const orders: HudOrders = {
    mode: ordersMode,
    submenu: ordersSubmenu,
  };

  // Minimap snapshot
  const map = session.map;
  const mapSize = map?.size ?? 128;
  const tiles = map?.tiles ?? null;

  const snapshotEntities = session.snapshot?.entities ?? [];
  const minimapUnits: MinimapUnit[] = [];

  for (const ent of snapshotEntities) {
    if (ent.kind === 'projectile' || ent.kind === 'doodad') continue;
    minimapUnits.push({
      id: ent.id,
      x: ent.x,
      z: ent.z,
      player: ent.player ?? -1,
      kind: ent.kind,
      type: ent.type ?? '',
    });
  }

  const camera = session.renderer?.camera;
  const view = camera?.view ? { ...camera.view } : null;

  let viewportCorners:
    | readonly [
        { x: number; z: number },
        { x: number; z: number },
        { x: number; z: number },
        { x: number; z: number },
      ]
    | null = null;

  if (view) {
    const c0 = screenToGround(0, 0, view);
    const c1 = screenToGround(view.width, 0, view);
    const c2 = screenToGround(view.width, view.height, view);
    const c3 = screenToGround(0, view.height, view);
    viewportCorners = [c0, c1, c2, c3];
  }

  useHudStore.setState((prev) => ({
    resources,
    selection: selectedList,
    orders,
    status: prev.status, // preserve status between publications!
    minimap: {
      mapSize,
      tiles,
      units: minimapUnits,
      cameraView: view,
      viewportCorners,
    },
  }));
}
