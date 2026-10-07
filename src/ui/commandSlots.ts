import {
  isProductionType,
  isTownCenterType,
  isWorkerType,
} from '../data/roles';
import { getBuildingData } from '../data/buildings';
import { ALL_UNITS, getUnitData } from '../data/units';
import type { Faction } from '../data/types';
import type { BuildingEntity } from '../sim/entity';
import type { World } from '../sim/world';
import {
  getResearchAvailability,
  getResearchDefinition,
  listResearchDefinitions,
  type ResearchDefinition,
} from '../sim/systems/research';

export interface CommandSlotContext {
  age: number;
  faction: Faction;
  townCenterCount: number;
  /** Live world: building-scoped slot state (busy, queue, research) is read from it so mouse and hotkeys agree. */
  world: World;
}

export function getCommandSlotContext(
  world: World | undefined,
): CommandSlotContext | null {
  const player = world?.players[0];
  if (!world || !player) return null;
  let townCenterCount = 0;
  for (const entity of world.entities) {
    if (
      entity?.kind === 'building' &&
      entity.player === 0 &&
      entity.hp > 0 &&
      isTownCenterType(entity.type)
    )
      townCenterCount++;
  }
  return { age: player.age, faction: player.faction, townCenterCount, world };
}

const clansTypes: Readonly<Record<string, string>> = {
  cottage: 'longhouse',
  farm: 'field',
  storehouse: 'hoard',
  chapel: 'war_shrine',
  keep: 'great_hall',
  barracks: 'mead_hall',
  archery_range: 'hunters_lodge',
  stable: 'horse_pen',
  siege_workshop: 'ram_shed',
  stone_tower: 'watchtower',
  stone_wall: 'palisade',
  stone_gate: 'palisade_gate',
};

function gateBuildingSlots(
  slots: CommandSlot[],
  context: CommandSlotContext | null,
): CommandSlot[] {
  for (const slot of slots) {
    if (!slot.buildingType) continue;
    if (context?.faction === 'clans')
      slot.buildingType = clansTypes[slot.buildingType] ?? slot.buildingType;
    const data = getBuildingData(slot.buildingType);
    const requiredAge =
      data && data.isTownCenter && context && context.townCenterCount > 0
        ? (data.additionalAge ?? data.age)
        : data?.age;
    slot.action = 'build';
    slot.disabled =
      !context ||
      !data ||
      data.faction !== context.faction ||
      requiredAge === undefined ||
      context.age < requiredAge;
    slot.reason = !context
      ? 'Simulation not ready'
      : slot.disabled
        ? `Requires Age ${requiredAge}`
        : undefined;
    slot.tooltip = `${data?.name ?? slot.label} [${slot.key}]${slot.reason ? ` (${slot.reason})` : ''}`;
    if (data) slot.label = data.name.replace(' (Town Center)', '');
  }
  return slots;
}

export type CardAction =
  | 'move'
  | 'stop'
  | 'hold'
  | 'attackMove'
  | 'economic'
  | 'military'
  | 'delete'
  | 'back'
  | 'build'
  | 'train'
  | 'research'
  | 'cancelResearch';

export interface CommandSlot {
  key: string;
  label: string;
  action: CardAction | null;
  disabled: boolean;
  reason?: string;
  id?: string;
  tooltip?: string;
  buildingType?: string;
  unitType?: string;
  /** Research/upgrade id (`age_2`, `age_3`, `heavy_plough`, ...) for `research` slots. */
  upgradeId?: string;
  /** Building the train/research/cancelResearch order targets, resolved from the live selection. */
  buildingId?: number;
}

export const CARD_KEYS = [
  'Q',
  'W',
  'E',
  'R',
  'T',
  'A',
  'S',
  'D',
  'F',
  'G',
  'Z',
  'X',
  'C',
  'V',
  'B',
] as const;

type SelectedBuilding = { kind: string; type: string; id?: number };

/** Live building behind a selected card entry, or undefined when the world cannot confirm it. */
function resolveBuilding(
  selected: SelectedBuilding,
  context: CommandSlotContext | null,
): BuildingEntity | undefined {
  if (!context || selected.id === undefined) return undefined;
  const ent = context.world.getEntity(selected.id);
  return ent && ent.kind === 'building' ? ent : undefined;
}

function describeCost(food: number, gold: number, seconds: number): string {
  const parts: string[] = [];
  if (food > 0) parts.push(`${food} food`);
  if (gold > 0) parts.push(`${gold} gold`);
  parts.push(`${seconds}s`);
  return parts.join(', ');
}

/** Why `building` cannot take another `unitType` order right now (undefined = it can). */
function getTrainBlockReason(
  building: BuildingEntity | undefined,
  unitType: string,
  context: CommandSlotContext | null,
): string | undefined {
  if (!context) return 'Simulation not ready';
  const unit = getUnitData(unitType, context.faction);
  if (!unit || unit.faction !== context.faction) return 'Unavailable';
  if (context.age < unit.age) return `Requires Age ${unit.age}`;
  if (!building) return undefined;
  if (!building.built || building.hp <= 0) return 'Under construction';
  if (building.research) return 'Researching: cancel research to train';
  if (building.trainingQueue.length >= 5) return 'Training queue full';
  const player = context.world.players[0];
  if (player) {
    const lacksFood = player.food < unit.food;
    const lacksGold = player.gold < unit.gold;
    if (lacksFood || lacksGold) {
      return `Not enough ${lacksFood && lacksGold ? 'food and gold' : lacksFood ? 'food' : 'gold'}`;
    }
  }
  return undefined;
}

function buildTrainSlot(
  key: string,
  unitType: string,
  candidates: readonly SelectedBuilding[],
  context: CommandSlotContext | null,
): CommandSlot {
  const unit = getUnitData(unitType, context?.faction);
  const name = unit?.name ?? unitType;
  let chosen: BuildingEntity | undefined;
  let reason: string | undefined;
  let first = true;
  for (const candidate of candidates) {
    const building = resolveBuilding(candidate, context);
    const blocked = getTrainBlockReason(building, unitType, context);
    if (first) {
      chosen = building;
      reason = blocked;
      first = false;
    }
    if (blocked === undefined) {
      chosen = building;
      reason = undefined;
      break;
    }
  }
  const cost = unit
    ? ` - ${describeCost(unit.food, unit.gold, unit.trainTime)}`
    : '';
  return {
    key,
    id: `train-${unitType.replace(/_/g, '-')}`,
    label: `Train ${name}`,
    action: 'train',
    unitType,
    buildingId: chosen?.id,
    disabled: reason !== undefined,
    reason,
    tooltip: `Train ${name} [${key}]${cost}${reason ? ` (${reason})` : ''}`,
  };
}

function buildResearchSlot(
  key: string,
  def: ResearchDefinition,
  candidates: readonly SelectedBuilding[],
  context: CommandSlotContext | null,
): CommandSlot {
  let buildingId: number | undefined;
  let reason: string | undefined = context ? undefined : 'Simulation not ready';
  if (context) {
    let first = true;
    for (const candidate of candidates) {
      if (candidate.id === undefined) continue;
      const result = getResearchAvailability(
        context.world,
        0,
        candidate.id,
        def.id,
      );
      if (first || result.allowed) {
        buildingId = candidate.id;
        reason = result.allowed ? undefined : (result.reason ?? 'Unavailable');
        first = false;
      }
      if (result.allowed) break;
    }
    if (first) reason = 'Unavailable';
  }
  const effect =
    def.kind === 'upgrade' && def.effectDescription
      ? ` ${def.effectDescription}.`
      : '';
  return {
    key,
    id: `research-${def.id.replace(/_/g, '-')}`,
    label: def.name,
    action: 'research',
    upgradeId: def.id,
    buildingId,
    disabled: reason !== undefined,
    reason,
    tooltip: `${def.name} [${key}] - ${describeCost(def.food, def.gold, def.time)}.${effect}${reason ? ` (${reason})` : ''}`,
  };
}

/** First selected building with an active research, so the card can offer its cancel button. */
function findResearchingBuilding(
  candidates: readonly SelectedBuilding[],
  context: CommandSlotContext | null,
): BuildingEntity | undefined {
  for (const candidate of candidates) {
    const building = resolveBuilding(candidate, context);
    if (building?.research) return building;
  }
  return undefined;
}

export function getCommandSlots(
  selection: readonly {
    kind: string;
    type: string;
    player?: number;
    id?: number;
  }[],
  submenu: 'economic' | 'military' | null,
  context: CommandSlotContext | null,
): readonly CommandSlot[] {
  // Only player 0 entities can be commanded
  const own = selection.filter((e) => e.player === 0);

  // Default: 15 empty slots
  const slots: CommandSlot[] = CARD_KEYS.map((key) => ({
    key,
    label: '',
    action: null,
    disabled: true,
  }));

  if (own.length === 0) {
    return slots;
  }

  const hasWorker = own.some((e) => e.kind === 'unit' && isWorkerType(e.type));
  const hasUnit = own.some((e) => e.kind === 'unit');
  const hasBuilding = own.some((e) => e.kind === 'building');

  // 1. Economic Submenu (only available if own worker selected)
  if (hasWorker && submenu === 'economic') {
    slots[0] = {
      key: 'Q',
      id: 'cottage',
      label: 'Cottage',
      action: 'build',
      buildingType: 'cottage',
      disabled: false,
      tooltip: 'Build Cottage [Q]',
    };
    slots[1] = {
      key: 'W',
      id: 'farm',
      label: 'Farm',
      action: 'build',
      buildingType: 'farm',
      disabled: false,
      tooltip: 'Build Farm [W]',
    };
    slots[2] = {
      key: 'E',
      id: 'storehouse',
      label: 'Storehouse',
      action: 'build',
      buildingType: 'storehouse',
      disabled: false,
      tooltip: 'Build Storehouse [E]',
    };
    slots[3] = {
      key: 'R',
      id: 'chapel',
      label: 'Chapel',
      action: 'build',
      buildingType: 'chapel',
      disabled: false,
      tooltip: 'Build Chapel [R]',
    };
    slots[4] = {
      key: 'T',
      id: 'keep',
      label: 'Keep',
      action: 'build',
      buildingType: 'keep',
      disabled: false,
      tooltip: 'Build Keep [T]',
    };
    slots[14] = {
      key: 'B',
      id: 'back',
      label: 'Back',
      action: 'back',
      disabled: false,
      tooltip: 'Back [Esc / B]',
    };
    return gateBuildingSlots(slots, context);
  }

  // 2. Military Submenu (only available if own worker selected)
  if (hasWorker && submenu === 'military') {
    slots[0] = {
      key: 'Q',
      id: 'barracks',
      label: 'Barracks',
      action: 'build',
      buildingType: 'barracks',
      disabled: false,
      tooltip: 'Build Barracks [Q]',
    };
    slots[1] = {
      key: 'W',
      id: 'archery-range',
      label: 'Archery',
      action: 'build',
      buildingType: 'archery_range',
      disabled: false,
    };
    slots[2] = {
      key: 'E',
      id: 'stable',
      label: 'Stable',
      action: 'build',
      buildingType: 'stable',
      disabled: false,
    };
    slots[3] = {
      key: 'R',
      id: 'siege-workshop',
      label: 'Siege',
      action: 'build',
      buildingType: 'siege_workshop',
      disabled: false,
    };
    slots[4] = {
      key: 'T',
      id: 'stone-tower',
      label: 'Tower',
      action: 'build',
      buildingType: 'stone_tower',
      disabled: false,
    };
    slots[5] = {
      key: 'A',
      id: 'stone-wall',
      label: 'Wall',
      action: 'build',
      buildingType: 'stone_wall',
      disabled: false,
    };
    slots[6] = {
      key: 'S',
      id: 'stone-gate',
      label: 'Gate',
      action: 'build',
      buildingType: 'stone_gate',
      disabled: false,
    };
    slots[14] = {
      key: 'B',
      id: 'back',
      label: 'Back',
      action: 'back',
      disabled: false,
      tooltip: 'Back [Esc / B]',
    };
    return gateBuildingSlots(slots, context);
  }

  // 3. Unit Commands
  if (hasUnit) {
    slots[0] = {
      key: 'Q',
      id: 'move',
      label: 'Move',
      action: 'move',
      disabled: false,
      tooltip: 'Move [Q]',
    };
    slots[1] = {
      key: 'W',
      id: 'stop',
      label: 'Stop',
      action: 'stop',
      disabled: false,
      tooltip: 'Stop [W]',
    };
    slots[2] = {
      key: 'E',
      id: 'hold',
      label: 'Hold',
      action: 'hold',
      disabled: false,
      tooltip: 'Hold Position [E]',
    };
    slots[3] = {
      key: 'R',
      id: 'attack-move',
      label: 'Attack-Move',
      action: 'attackMove',
      disabled: false,
      tooltip: 'Attack-Move [R]',
    };

    if (hasWorker) {
      slots[5] = {
        key: 'A',
        id: 'economic',
        label: 'Economic',
        action: 'economic',
        disabled: false,
        tooltip: 'Economic Buildings [A]',
      };
      slots[6] = {
        key: 'S',
        id: 'military',
        label: 'Military',
        action: 'military',
        disabled: false,
        tooltip: 'Military Buildings [S]',
      };
    }

    slots[10] = {
      key: 'Z',
      id: 'delete',
      label: 'Delete',
      action: 'delete',
      disabled: false,
      tooltip: 'Delete Units [Delete / Z]',
    };
    return slots;
  }

  // 4. Building Commands
  if (hasBuilding) {
    const buildings = own.filter((e) => e.kind === 'building');
    const types: string[] = [];
    for (const b of buildings) {
      if (!types.includes(b.type)) types.push(b.type);
    }

    // Train slots: Q, W, E, R (every unit the selected building types produce)
    let trainIdx = 0;
    for (const type of types) {
      for (const unit of ALL_UNITS) {
        if (unit.from !== type || trainIdx > 3) continue;
        slots[trainIdx] = buildTrainSlot(
          CARD_KEYS[trainIdx],
          unit.id,
          buildings.filter((b) => b.type === type),
          context,
        );
        trainIdx++;
      }
    }

    if (types.some((t) => isProductionType(t))) {
      slots[4] = {
        key: 'T',
        id: 'set-rally',
        label: 'Set Rally',
        action: null,
        disabled: true,
        reason: 'Right-click ground, a unit or a building to set rally',
        tooltip:
          'Set Rally Point (Right-click ground, a unit or a building to set rally)',
      };
    }

    // Research slots: A, S, D, F, G (ages first, then upgrades)
    let researchIdx = 5;
    for (const type of types) {
      for (const def of listResearchDefinitions(type)) {
        if (researchIdx > 9) break;
        slots[researchIdx] = buildResearchSlot(
          CARD_KEYS[researchIdx],
          def,
          buildings.filter((b) => b.type === type),
          context,
        );
        researchIdx++;
      }
    }

    slots[10] = {
      key: 'Z',
      id: 'delete',
      label: 'Delete',
      action: 'delete',
      disabled: false,
      tooltip: 'Delete Building [Delete / Z]',
    };

    const researching = findResearchingBuilding(buildings, context);
    if (researching) {
      const upgradeId = researching.research?.upgradeId ?? '';
      const def = getResearchDefinition(researching.faction, upgradeId);
      slots[11] = {
        key: 'X',
        id: 'cancel-research',
        label: 'Cancel Research',
        action: 'cancelResearch',
        buildingId: researching.id,
        upgradeId,
        disabled: false,
        tooltip: `Cancel ${def?.name ?? 'Research'} and refund its cost [X]`,
      };
    }
    return slots;
  }

  return slots;
}
