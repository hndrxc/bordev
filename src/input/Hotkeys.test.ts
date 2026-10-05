import { describe, it, expect, vi } from 'vitest';
import { Hotkeys } from './Hotkeys';
import type { GameSession } from '../game/GameSession';
import type { InputController } from './InputController';
import * as commandSlotsModule from '../ui/commandSlots';
function createHarness(options?: {
  debugEnabled?: boolean;
  selectedUnits?: readonly { kind: string; type: string; player?: number }[];
}) {
  const panKeys: { direction: string; pressed: boolean }[] = [];
  let centeredTownCenter = false;
  let centerOnCoords: { x: number; z: number } | null = null;

  const camera = {
    setPanKey: vi.fn(
      (direction: 'up' | 'down' | 'left' | 'right', pressed: boolean) => {
        panKeys.push({ direction, pressed });
      },
    ),
    centerOnTownCenter: vi.fn(() => {
      centeredTownCenter = true;
    }),
    centerOn: vi.fn((x: number, z: number) => {
      centerOnCoords = { x, z };
    }),
  };

  let lastGroupNum = -1;
  let lastGroupTime = 0;
  const assignedGroups: number[] = [];
  const selectedGroups: number[] = [];

  const selection = {
    ids: [1],
    assignGroup: vi.fn((groupNum: number) => {
      assignedGroups.push(groupNum);
    }),
    selectGroup: vi.fn((groupNum: number) => {
      selectedGroups.push(groupNum);
      const now = performance.now();
      if (lastGroupNum === groupNum && now - lastGroupTime < 300) {
        camera.centerOn(50, 50);
        lastGroupNum = -1;
      } else {
        lastGroupNum = groupNum;
        lastGroupTime = now;
      }
    }),
    cancelDrag: vi.fn(),
  };

  const executedOrders: string[] = [];
  const orders = {
    execute: vi.fn((action: string) => {
      executedOrders.push(action);
    }),
    submenu: null as 'economic' | 'military' | null,
  };

  let toggledDebugGrid = false;
  const renderer = {
    toggleDebugGrid: vi.fn(() => {
      toggledDebugGrid = true;
      return true;
    }),
  };

  const statusMessages: string[] = [];
  const session = {
    debugEnabled: options?.debugEnabled ?? false,
    showStatus: vi.fn((msg: string) => {
      statusMessages.push(msg);
    }),
    renderer,
    sim: {
      world: {
        getEntity: vi.fn((id: number) => {
          if (options?.selectedUnits && options.selectedUnits.length > 0) {
            const u = options.selectedUnits[0];
            return {
              id,
              kind: u.kind,
              type: u.type,
              player: u.player ?? 0,
              hp: 100,
            };
          }
          return {
            id,
            kind: 'unit',
            type: 'peasant',
            player: 0,
            hp: 100,
          };
        }),
      },
    },
  };

  let cycledWorker = false;
  const input = {
    camera,
    selection,
    orders,
    session,
    cycleIdleWorker: vi.fn(() => {
      cycledWorker = true;
    }),
  };

  const hotkeys = new Hotkeys(
    session as unknown as GameSession,
    input as unknown as InputController,
  );

  return {
    hotkeys,
    camera,
    selection,
    orders,
    session,
    renderer,
    panKeys,
    get centerOnCoords() {
      return centerOnCoords;
    },
    get centeredTownCenter() {
      return centeredTownCenter;
    },
    assignedGroups,
    selectedGroups,
    executedOrders,
    statusMessages,
    get toggledDebugGrid() {
      return toggledDebugGrid;
    },
    get cycledWorker() {
      return cycledWorker;
    },
  };
}

describe('Hotkeys', () => {
  it('autorepeat of a digit does not trigger double-tap centring', () => {
    const harness = createHarness();

    // First press: non-repeat -> selects group 1
    harness.hotkeys.handleKeyDown({ code: 'Digit1', repeat: false });
    expect(harness.selectedGroups).toEqual([1]);
    expect(harness.camera.centerOn).not.toHaveBeenCalled();

    // Holding the key: autorepeats arrive with repeat: true
    harness.hotkeys.handleKeyDown({ code: 'Digit1', repeat: true });
    harness.hotkeys.handleKeyDown({ code: 'Digit1', repeat: true });
    harness.hotkeys.handleKeyDown({ code: 'Digit1', repeat: true });

    // Autorepeat MUST NOT call selectGroup again or trigger double-tap centring
    expect(harness.selectedGroups).toEqual([1]);
    expect(harness.camera.centerOn).not.toHaveBeenCalled();

    // Second non-repeat press within 300 ms triggers double-tap centring
    harness.hotkeys.handleKeyDown({ code: 'Digit1', repeat: false });
    expect(harness.selectedGroups).toEqual([1, 1]);
    expect(harness.camera.centerOn).toHaveBeenCalledWith(50, 50);
  });

  it('repeat of W issues one stop', () => {
    const harness = createHarness();

    // Initial press issues stop
    harness.hotkeys.handleKeyDown({ code: 'KeyW', repeat: false });
    expect(harness.executedOrders).toEqual(['stop']);

    // Autorepeats while held MUST NOT issue extra stop orders
    harness.hotkeys.handleKeyDown({ code: 'KeyW', repeat: true });
    harness.hotkeys.handleKeyDown({ code: 'KeyW', repeat: true });

    expect(harness.executedOrders).toEqual(['stop']);
  });

  it('editable targets ignored', () => {
    const harness = createHarness({ debugEnabled: true });

    // Input target
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
    });
    expect(harness.executedOrders).toHaveLength(0);

    // Textarea target
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      target: { tagName: 'TEXTAREA' } as unknown as EventTarget,
    });
    expect(harness.selectedGroups).toHaveLength(0);

    // ContentEditable target
    harness.hotkeys.handleKeyDown({
      code: 'KeyH',
      target: { isContentEditable: true } as unknown as EventTarget,
    });
    expect(harness.centeredTownCenter).toBe(false);

    // Arrow pan ignored on editable target
    harness.hotkeys.handleKeyDown({
      code: 'ArrowUp',
      target: { tagName: 'input' } as unknown as EventTarget,
    });
    harness.hotkeys.handleKeyUp({
      code: 'ArrowUp',
      target: { tagName: 'input' } as unknown as EventTarget,
    });
    expect(harness.panKeys).toHaveLength(0);
  });

  it('AZERTY event (code: KeyQ, key: a) triggers slot Q', () => {
    const harness = createHarness();

    // On AZERTY, pressing the top-left key sends code: 'KeyQ', key: 'a'
    // Physical mapping ensures it triggers slot Q (Move), not slot A (Economic)
    harness.hotkeys.handleKeyDown({
      code: 'KeyQ',
      key: 'a',
      repeat: false,
    });

    expect(harness.executedOrders).toEqual(['move']);
  });

  it('Ctrl+Digit assigns, Digit recalls', () => {
    const harness = createHarness();

    // Ctrl+Digit assigns group
    harness.hotkeys.handleKeyDown({
      code: 'Digit2',
      ctrlKey: true,
      repeat: false,
    });
    expect(harness.assignedGroups).toEqual([2]);
    expect(harness.selectedGroups).toHaveLength(0);

    // Meta+Digit assigns group
    harness.hotkeys.handleKeyDown({
      code: 'Digit3',
      metaKey: true,
      repeat: false,
    });
    expect(harness.assignedGroups).toEqual([2, 3]);

    // Plain Digit recalls group
    harness.hotkeys.handleKeyDown({
      code: 'Digit2',
      repeat: false,
    });
    expect(harness.selectedGroups).toEqual([2]);
  });

  it('G runs an enabled card action, otherwise toggles the grid only when debugEnabled', () => {
    // 1. Slot G has no action, debugEnabled is true -> toggles debug grid
    const debugHarness = createHarness({ debugEnabled: true });
    debugHarness.hotkeys.handleKeyDown({ code: 'KeyG', repeat: false });
    expect(debugHarness.toggledDebugGrid).toBe(true);
    expect(debugHarness.executedOrders).toHaveLength(0);

    // 2. Slot G has no action, debugEnabled is false -> does NOT toggle grid
    const releaseHarness = createHarness({ debugEnabled: false });
    releaseHarness.hotkeys.handleKeyDown({ code: 'KeyG', repeat: false });
    expect(releaseHarness.toggledDebugGrid).toBe(false);
    expect(releaseHarness.executedOrders).toHaveLength(0);

    // 3. Slot G has an enabled card action -> executes action, does NOT toggle grid
    const actionHarness = createHarness({ debugEnabled: true });
    const spy = vi
      .spyOn(commandSlotsModule, 'getCommandSlots')
      .mockReturnValueOnce([
        {
          key: 'G',
          id: 'custom-action',
          label: 'Custom',
          action: 'hold',
          disabled: false,
        },
      ] satisfies commandSlotsModule.CommandSlot[]);

    actionHarness.hotkeys.handleKeyDown({ code: 'KeyG', repeat: false });
    expect(actionHarness.executedOrders).toEqual(['hold']);
    expect(actionHarness.toggledDebugGrid).toBe(false);
    spy.mockRestore();

    // 4. Slot G is disabled with a reason -> shows status, does NOT toggle grid
    const reasonHarness = createHarness({ debugEnabled: true });
    const reasonSpy = vi
      .spyOn(commandSlotsModule, 'getCommandSlots')
      .mockReturnValueOnce([
        {
          key: 'G',
          id: 'custom-action',
          label: 'Custom',
          action: null,
          disabled: true,
          reason: 'Custom reason',
        },
      ] satisfies commandSlotsModule.CommandSlot[]);

    reasonHarness.hotkeys.handleKeyDown({ code: 'KeyG', repeat: false });
    expect(reasonHarness.statusMessages).toEqual(['Custom reason']);
    expect(reasonHarness.toggledDebugGrid).toBe(false);
    reasonSpy.mockRestore();
  });

  it('routes arrows, KeyH, Period, Delete, Escape and respects modifiers', () => {
    const harness = createHarness();

    // Arrows forward to camera.setPanKey on keydown and keyup
    harness.hotkeys.handleKeyDown({ code: 'ArrowRight', shiftKey: true });
    harness.hotkeys.handleKeyUp({ code: 'ArrowRight' });
    expect(harness.panKeys).toEqual([
      { direction: 'right', pressed: true },
      { direction: 'right', pressed: false },
    ]);

    // KeyH centers on Town Center
    harness.hotkeys.handleKeyDown({ code: 'KeyH', repeat: false });
    expect(harness.centeredTownCenter).toBe(true);

    // Period cycles idle worker
    harness.hotkeys.handleKeyDown({ code: 'Period', repeat: false });
    expect(harness.cycledWorker).toBe(true);

    // Delete issues delete order
    harness.hotkeys.handleKeyDown({ code: 'Delete', repeat: false });
    expect(harness.executedOrders).toContain('delete');

    // Escape issues back order and cancels drag
    harness.hotkeys.handleKeyDown({ code: 'Escape', repeat: false });
    expect(harness.executedOrders).toContain('back');
    expect(harness.selection.cancelDrag).toHaveBeenCalled();

    // Hotkeys ignored while Ctrl/Alt/Meta is held
    const prevOrdersLen = harness.executedOrders.length;
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      ctrlKey: true,
      repeat: false,
    });
    expect(harness.executedOrders).toHaveLength(prevOrdersLen);
  });
});
