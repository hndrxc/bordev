import { create } from 'zustand';
import type { GameSession } from '../game/GameSession';
import { screenToGround } from '../render/iso';
import type { EntityKind } from '../sim/entity';
import { getUnitData } from '../data/units';
import { getBuildingData } from '../data/buildings';
import type { World } from '../sim/world';
import { getResearchDefinition } from '../sim/systems/research';

export interface HudResources {
  food: number;
  gold: number;
  faithUsed: number;
  faithProduced: number;
  pop: number;
  popCap: number;
  age: 1 | 2 | 3;
  faction: string;
  lowFaith: boolean;
}

export interface SelectedEntityData {
  id: number;
  kind: EntityKind;
  type: string;
  name: string;
  player?: number;
  hp: number;
  maxHp: number;
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
  trainingProgress?: number;
  trainingQueueCount?: number;
  trainingUnitType?: string;
  researchUpgradeId?: string;
  researchName?: string;
  /** Fraction 0..1 of the active research completed. */
  researchProgress?: number;
}

export interface MinimapUnit {
  x: number;
  z: number;
  player: number;
  kind: EntityKind;
}

export interface MinimapData {
  mapSize: number;
  tiles: Uint8Array | null;
  units: readonly MinimapUnit[];
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
  placementBuilding: string | null;
}

/** Player-wide facts the command card needs to re-render research/unit unlock state. */
export interface HudProgression {
  /** Completed upgrade ids, sorted. */
  upgrades: readonly string[];
  /** Distinct completed living building types the player owns, sorted. */
  buildingTypes: readonly string[];
}

export interface HudState {
  resources: HudResources;
  selection: readonly SelectedEntityData[];
  orders: HudOrders;
  progression: HudProgression;
  status: string;
  statusTimestamp: number;
  minimap: MinimapData;
  reset: () => void;
}

export function getEntityDisplayName(entity: {
  kind: EntityKind;
  type?: string;
}): string {
  if (entity.kind === 'mine' || entity.type === 'gold_mine') {
    return 'Gold Mine';
  }
  const t = entity.type ?? '';
  if (t) {
    const unit = getUnitData(t);
    if (unit) return unit.name;
    const building = getBuildingData(t);
    if (building) return building.name;
    if (t.startsWith('tree')) return 'Tree';
    if (t.startsWith('rock')) return 'Rock';
    return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'Unknown';
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
  lowFaith: false,
};

const INITIAL_ORDERS: HudOrders = {
  mode: null,
  submenu: null,
  placementBuilding: null,
};

const INITIAL_MINIMAP: MinimapData = {
  mapSize: 128,
  tiles: null,
  units: [],
  viewportCorners: null,
};

const INITIAL_PROGRESSION: HudProgression = { upgrades: [], buildingTypes: [] };

export const useHudStore = create<HudState>((set) => ({
  resources: INITIAL_RESOURCES,
  selection: [],
  orders: INITIAL_ORDERS,
  progression: INITIAL_PROGRESSION,
  status: '',
  statusTimestamp: 0,
  minimap: INITIAL_MINIMAP,
  reset: () =>
    set({
      resources: INITIAL_RESOURCES,
      selection: [],
      orders: INITIAL_ORDERS,
      progression: INITIAL_PROGRESSION,
      status: '',
      statusTimestamp: 0,
      minimap: INITIAL_MINIMAP,
    }),
}));

export type HudClock = () => number;

let customClock: HudClock | null = null;

export function setHudClock(clock: HudClock | null): void {
  customClock = clock;
}

function getHudNow(): number {
  if (customClock) return customClock();
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function setHudStatus(message: string): void {
  useHudStore.setState({
    status: message,
    statusTimestamp: message ? getHudNow() : 0,
  });
}

export function resetHud(): void {
  useHudStore.getState().reset();
}

function areResourcesEqual(a: HudResources, b: HudResources): boolean {
  return (
    a.food === b.food &&
    a.gold === b.gold &&
    a.faithUsed === b.faithUsed &&
    a.faithProduced === b.faithProduced &&
    a.pop === b.pop &&
    a.popCap === b.popCap &&
    a.age === b.age &&
    a.faction === b.faction &&
    a.lowFaith === b.lowFaith
  );
}

function areSelectionsEqual(
  a: readonly SelectedEntityData[],
  b: readonly SelectedEntityData[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const eA = a[i];
    const eB = b[i];
    if (
      eA.id !== eB.id ||
      eA.kind !== eB.kind ||
      eA.type !== eB.type ||
      eA.name !== eB.name ||
      eA.player !== eB.player ||
      eA.hp !== eB.hp ||
      eA.maxHp !== eB.maxHp ||
      eA.pop !== eB.pop ||
      eA.faith !== eB.faith ||
      eA.attack !== eB.attack ||
      eA.range !== eB.range ||
      eA.meleeArmor !== eB.meleeArmor ||
      eA.pierceArmor !== eB.pierceArmor ||
      eA.speed !== eB.speed ||
      eA.goldRemaining !== eB.goldRemaining ||
      eA.built !== eB.built ||
      eA.buildProgress !== eB.buildProgress ||
      eA.trainingProgress !== eB.trainingProgress ||
      eA.trainingQueueCount !== eB.trainingQueueCount ||
      eA.trainingUnitType !== eB.trainingUnitType ||
      eA.researchUpgradeId !== eB.researchUpgradeId ||
      eA.researchName !== eB.researchName ||
      eA.researchProgress !== eB.researchProgress
    ) {
      return false;
    }
  }
  return true;
}

function areMinimapUnitsEqual(
  a: readonly MinimapUnit[],
  b: readonly MinimapUnit[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const uA = a[i];
    const uB = b[i];
    if (
      uA.x !== uB.x ||
      uA.z !== uB.z ||
      uA.player !== uB.player ||
      uA.kind !== uB.kind
    ) {
      return false;
    }
  }
  return true;
}

function areViewportCornersEqual(
  a: MinimapData['viewportCorners'],
  b: MinimapData['viewportCorners'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < 4; i++) {
    if (a[i].x !== b[i].x || a[i].z !== b[i].z) return false;
  }
  return true;
}

function areStringListsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areProgressionsEqual(a: HudProgression, b: HudProgression): boolean {
  return (
    areStringListsEqual(a.upgrades, b.upgrades) &&
    areStringListsEqual(a.buildingTypes, b.buildingTypes)
  );
}

function collectProgression(world: World | undefined): HudProgression {
  const player = world?.players?.[0];
  if (!world || !player) return INITIAL_PROGRESSION;
  const upgrades = player.upgrades ? [...player.upgrades].sort() : [];
  const buildingTypes: string[] = [];
  for (const ent of world.entities ?? []) {
    if (
      ent?.kind === 'building' &&
      ent.player === 0 &&
      ent.built &&
      ent.hp > 0 &&
      !buildingTypes.includes(ent.type)
    ) {
      buildingTypes.push(ent.type);
    }
  }
  buildingTypes.sort();
  return { upgrades, buildingTypes };
}

export function publishHud(session: GameSession): void {
  if (!session) return;

  const sim = session.sim;
  const world = sim?.world;
  const p0 = world?.players?.[0];

  const nextResources: HudResources = p0
    ? {
        food: p0.food,
        gold: p0.gold,
        faithUsed: p0.faithUsed,
        faithProduced: p0.faithProduced,
        pop: p0.pop,
        popCap: p0.popCap,
        age: p0.age,
        faction: p0.faction,
        lowFaith: p0.lowFaith,
      }
    : INITIAL_RESOURCES;

  const selectedIds = session.input?.selection?.ids ?? [];
  const ordersMode = session.input?.orders?.mode ?? null;
  const ordersSubmenu = session.input?.orders?.submenu ?? null;

  const selectedList: SelectedEntityData[] = [];
  for (const id of selectedIds) {
    const raw = world?.getEntity?.(id);
    if (!raw || raw.kind === 'projectile') continue;

    let trainingProgress: number | undefined;
    let trainingQueueCount: number | undefined;
    let trainingUnitType: string | undefined;

    if (
      raw.kind === 'building' &&
      'trainingQueue' in raw &&
      Array.isArray(raw.trainingQueue) &&
      raw.trainingQueue.length > 0
    ) {
      const queue = raw.trainingQueue as readonly {
        unitType: string;
        progress: number;
      }[];
      trainingQueueCount = queue.length;
      const current = queue[0];
      if (current && typeof current === 'object') {
        trainingUnitType = current.unitType;
        const unitData = getUnitData(current.unitType);
        const totalTime = unitData?.trainTime ?? 20;
        trainingProgress =
          totalTime > 0
            ? Math.min(1, Math.max(0, current.progress / totalTime))
            : 1;
      }
    }

    let researchUpgradeId: string | undefined;
    let researchName: string | undefined;
    let researchProgress: number | undefined;
    if (raw.kind === 'building' && raw.research) {
      researchUpgradeId = raw.research.upgradeId;
      researchName =
        getResearchDefinition(raw.faction, researchUpgradeId)?.name ??
        researchUpgradeId;
      researchProgress =
        raw.research.time > 0
          ? Math.min(1, Math.max(0, raw.research.progress / raw.research.time))
          : 1;
    }

    const entData: SelectedEntityData = {
      id: raw.id,
      kind: raw.kind,
      type: 'type' in raw ? raw.type : '',
      name: getEntityDisplayName(raw),
      player: 'player' in raw ? raw.player : undefined,
      hp: 'hp' in raw ? raw.hp : 0,
      maxHp: 'maxHp' in raw ? raw.maxHp : 0,
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
      trainingProgress,
      trainingQueueCount,
      trainingUnitType,
      researchUpgradeId,
      researchName,
      researchProgress,
    };
    selectedList.push(entData);
  }

  const nextOrders: HudOrders = {
    mode: ordersMode,
    submenu: ordersSubmenu,
    placementBuilding: session.input?.orders?.placementBuilding ?? null,
  };
  const nextProgression = collectProgression(world);
  const map = session.map;
  const mapSize = map?.size ?? 128;
  const tiles = map?.tiles ?? null;

  const snapshotEntities = session.snapshot?.entities ?? [];
  const minimapUnits: MinimapUnit[] = [];

  for (const ent of snapshotEntities) {
    if (ent.kind === 'projectile' || ent.kind === 'doodad') continue;
    const isFootprint = ent.kind === 'building' || ent.kind === 'mine';
    const cx =
      isFootprint && ent.width != null ? ent.x + ent.width * 0.5 : ent.x;
    const cz =
      isFootprint && ent.height != null ? ent.z + ent.height * 0.5 : ent.z;
    minimapUnits.push({
      x: cx,
      z: cz,
      player: ent.player ?? -1,
      kind: ent.kind,
    });
  }

  const camera = session.renderer?.camera;
  const view = camera?.view ?? null;

  let nextViewportCorners: MinimapData['viewportCorners'] = null;

  if (view) {
    const insets = session.input?.camera?.viewportInsets ?? {
      top: 0,
      bottom: 0,
    };
    const top = insets.top;
    const bottom = insets.bottom;
    const c0 = screenToGround(0, top, view);
    const c1 = screenToGround(view.width, top, view);
    const c2 = screenToGround(view.width, view.height - bottom, view);
    const c3 = screenToGround(0, view.height - bottom, view);
    nextViewportCorners = [c0, c1, c2, c3];
  }

  const now = getHudNow();

  useHudStore.setState((prev) => {
    let nextStatus = prev.status;
    let nextStatusTimestamp = prev.statusTimestamp;
    if (nextStatus && now - nextStatusTimestamp >= 4000) {
      nextStatus = '';
      nextStatusTimestamp = 0;
    }

    const finalResources = areResourcesEqual(prev.resources, nextResources)
      ? prev.resources
      : nextResources;

    const finalSelection = areSelectionsEqual(prev.selection, selectedList)
      ? prev.selection
      : selectedList;

    const finalOrders =
      prev.orders.mode === nextOrders.mode &&
      prev.orders.submenu === nextOrders.submenu &&
      prev.orders.placementBuilding === nextOrders.placementBuilding
        ? prev.orders
        : nextOrders;

    const finalProgression = areProgressionsEqual(
      prev.progression,
      nextProgression,
    )
      ? prev.progression
      : nextProgression;
    const finalUnits = areMinimapUnitsEqual(prev.minimap.units, minimapUnits)
      ? prev.minimap.units
      : minimapUnits;

    const finalCorners = areViewportCornersEqual(
      prev.minimap.viewportCorners,
      nextViewportCorners,
    )
      ? prev.minimap.viewportCorners
      : nextViewportCorners;

    const finalMinimap =
      finalUnits === prev.minimap.units &&
      finalCorners === prev.minimap.viewportCorners &&
      mapSize === prev.minimap.mapSize &&
      tiles === prev.minimap.tiles
        ? prev.minimap
        : {
            mapSize,
            tiles,
            units: finalUnits,
            viewportCorners: finalCorners,
          };
    if (
      finalResources === prev.resources &&
      finalSelection === prev.selection &&
      finalOrders === prev.orders &&
      finalMinimap === prev.minimap &&
      finalProgression === prev.progression &&
      nextStatus === prev.status &&
      nextStatusTimestamp === prev.statusTimestamp
    ) {
      return prev;
    }

    return {
      resources: finalResources,
      selection: finalSelection,
      orders: finalOrders,
      progression: finalProgression,
      status: nextStatus,
      statusTimestamp: nextStatusTimestamp,
      minimap: finalMinimap,
    };
  });
}
