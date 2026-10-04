export interface CommandSlot {
  key: string;
  label: string;
  action: string | null;
  disabled: boolean;
  reason?: string;
  id?: string;
  tooltip?: string;
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

  const hasPeasant = own.some(
    (e) => e.type === 'peasant' || e.type === 'crown_peasant',
  );
  const hasMilitary = own.some(
    (e) =>
      e.type === 'spearman' ||
      e.type === 'crown_spearman' ||
      e.type === 'ox_cart',
  );
  const hasBuilding = own.some((e) => e.kind === 'building');
  const hasKeep = own.some((e) => e.type === 'keep' || e.type === 'crown_keep');

  // 1. Economic Submenu (only available if own peasant selected)
  if (hasPeasant && submenu === 'economic') {
    slots[0] = {
      key: 'Q',
      id: 'cottage',
      label: 'Cottage',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Cottage [Q] (Requires Milestone 5: Economy & Construction)',
    };
    slots[1] = {
      key: 'W',
      id: 'farm',
      label: 'Farm',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip: 'Build Farm [W] (Requires Milestone 5: Economy & Construction)',
    };
    slots[2] = {
      key: 'E',
      id: 'storehouse',
      label: 'Storehouse',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Storehouse [E] (Requires Milestone 5: Economy & Construction)',
    };
    slots[3] = {
      key: 'R',
      id: 'chapel',
      label: 'Chapel',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Chapel [R] (Requires Milestone 5: Economy & Construction)',
    };
    slots[4] = {
      key: 'T',
      id: 'keep',
      label: 'Keep',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip: 'Build Keep [T] (Requires Milestone 5: Economy & Construction)',
    };
    slots[14] = {
      key: 'B',
      id: 'back',
      label: 'Back',
      action: 'back',
      disabled: false,
      tooltip: 'Back [Esc / B]',
    };
    return slots;
  }

  // 2. Military Submenu (only available if own peasant selected)
  if (hasPeasant && submenu === 'military') {
    slots[0] = {
      key: 'Q',
      id: 'barracks',
      label: 'Barracks',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Barracks [Q] (Requires Milestone 5: Economy & Construction)',
    };
    slots[1] = {
      key: 'W',
      id: 'archery-range',
      label: 'Archery',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Archery Range [W] (Requires Milestone 5: Economy & Construction)',
    };
    slots[2] = {
      key: 'E',
      id: 'stable',
      label: 'Stable',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Stable [E] (Requires Milestone 5: Economy & Construction)',
    };
    slots[3] = {
      key: 'R',
      id: 'siege-workshop',
      label: 'Siege',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Siege Workshop [R] (Requires Milestone 5: Economy & Construction)',
    };
    slots[4] = {
      key: 'T',
      id: 'stone-tower',
      label: 'Tower',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Stone Tower [T] (Requires Milestone 5: Economy & Construction)',
    };
    slots[5] = {
      key: 'A',
      id: 'stone-wall',
      label: 'Wall',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Stone Wall [A] (Requires Milestone 5: Economy & Construction)',
    };
    slots[6] = {
      key: 'S',
      id: 'stone-gate',
      label: 'Gate',
      action: null,
      disabled: true,
      reason: 'Requires Milestone 5 (Economy & Construction)',
      tooltip:
        'Build Stone Gate [S] (Requires Milestone 5: Economy & Construction)',
    };
    slots[14] = {
      key: 'B',
      id: 'back',
      label: 'Back',
      action: 'back',
      disabled: false,
      tooltip: 'Back [Esc / B]',
    };
    return slots;
  }

  // 3. Unit Commands
  if (hasPeasant || hasMilitary) {
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

    if (hasPeasant) {
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
    if (hasKeep) {
      slots[0] = {
        key: 'Q',
        id: 'train-peasant',
        label: 'Train Peasant',
        action: null,
        disabled: true,
        reason: 'Requires Milestone 6 (Production)',
        tooltip: 'Train Peasant [Q] (Requires Milestone 6: Production)',
      };
      slots[1] = {
        key: 'W',
        id: 'train-ox-cart',
        label: 'Train Ox Cart',
        action: null,
        disabled: true,
        reason: 'Requires Milestone 6 (Production)',
        tooltip: 'Train Ox Cart [W] (Requires Milestone 6: Production)',
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
