import { isTownCenterType, isWorkerType } from '../data/roles';
import { getBuildingData } from '../data/buildings';
import type { Faction } from '../data/types';
import type { World } from '../sim/world';

export interface CommandSlotContext {
  age: number;
  faction: Faction;
  townCenterCount: number;
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
  return { age: player.age, faction: player.faction, townCenterCount };
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
  | 'train';

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

export function getCommandSlots(
  selection: readonly { kind: string; type: string; player?: number }[],
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
  const hasTownCenter = own.some((e) => isTownCenterType(e.type));

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
    if (hasTownCenter) {
      slots[0] = {
        key: 'Q',
        id: 'train-peasant',
        label: 'Train Peasant',
        action: 'train',
        unitType: 'peasant',
        disabled: false,
        tooltip: 'Train Peasant [Q]',
      };
      slots[1] = {
        key: 'W',
        id: 'train-ox-cart',
        label: 'Train Ox Cart',
        action: 'train',
        unitType: 'ox_cart',
        disabled: false,
        tooltip: 'Train Ox Cart [W]',
      };
    }

    slots[2] = {
      key: 'E',
      id: 'set-rally',
      label: 'Set Rally',
      action: null,
      disabled: true,
      reason: 'Right-click ground to set rally',
      tooltip: 'Set Rally Point (Right-click ground to set rally)',
    };

    slots[10] = {
      key: 'Z',
      id: 'delete',
      label: 'Delete',
      action: 'delete',
      disabled: false,
      tooltip: 'Delete Building [Delete / Z]',
    };
    return slots;
  }

  return slots;
}
