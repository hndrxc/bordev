import { describe, it, expect, vi } from 'vitest';
import { Hotkeys } from './Hotkeys';
import { SelectionController } from './SelectionController';
import type { CameraController } from './CameraController';
import type { GameSession } from '../game/GameSession';
import type { InputController } from './InputController';
import * as commandSlotsModule from '../ui/commandSlots';
import { Sim } from '../sim/sim';
import { Terrain, type GameMap } from '../sim/map';

function createHarness(options?: {
  debugEnabled?: boolean;
  selectedUnits?: readonly { kind: string; type: string; player?: number }[];
  placementActive?: boolean;
  age?: 1 | 2 | 3;
  faction?: 'crown' | 'clans';
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
  const map: GameMap = {
    version: 1,
    id: 'test_clean',
    name: 'Test Clean',
    size: 64,
    players: 2,
    tiles: new Uint8Array(64 * 64).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [4, 4],
      [56, 56],
    ],
    doodads: [],
  };

  const sim = new Sim(map, 1);
  if (options?.age) {
    sim.world.players[0].age = options.age;
  }

  // Initial keep at (10, 10) so townCenterCount > 0
  sim.world.spawnBuilding(0, 'keep', 10, 10, true);
  // Default unit at (10, 10)
  const defaultPeasant = sim.world.spawnUnit(0, 'peasant', 10, 10);
  // Exercise faction-specific card catalogs without requiring Beta unit rosters.
  if (options?.faction) {
    sim.world.players[0].faction = options.faction;
  }

  const executedSlots: commandSlotsModule.CommandSlot[] = [];
  const executedOrders: string[] = [];
  const statusMessages: string[] = [];

  let toggledDebugGrid = false;
  const session = {
    debugEnabled: options?.debugEnabled ?? false,
    showStatus: vi.fn((msg: string) => {
      statusMessages.push(msg);
    }),
    renderer: {
      toggleDebugGrid: vi.fn(() => {
        toggledDebugGrid = true;
        return true;
      }),
    },
    sim,
  };

  const selection = new SelectionController(
    session as unknown as GameSession,
    camera as unknown as CameraController,
  );
  selection.set([defaultPeasant.id]);
  vi.spyOn(selection, 'cancelDrag');

  const orders = {
    execute: vi.fn((action: string) => {
      executedOrders.push(action);
    }),
    executeSlot: vi.fn((slot: commandSlotsModule.CommandSlot) => {
      executedSlots.push(slot);
      if (slot.disabled) {
        if (slot.reason) {
          session.showStatus(slot.reason);
        }
        return;
      }
      if (slot.action) {
        executedOrders.push(slot.action);
      }
    }),
    submenu: null as 'economic' | 'military' | null,
  };

  const renderer = session.renderer;

  const placement = {
    active: options?.placementActive ?? false,
    cancel: vi.fn(),
    rotate: vi.fn(),
  };

  let cycledWorker = false;
  const input = {
    camera,
    selection,
    orders,
    session,
    placement,
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
    placement,
    session,
    renderer,
    panKeys,
    get centerOnCoords() {
      return centerOnCoords;
    },
    get centeredTownCenter() {
      return centeredTownCenter;
    },
    executedOrders,
    executedSlots,
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
    const sim = harness.session.sim;
    const u1 = sim.world.spawnUnit(0, 'peasant', 40, 60);
    const u2 = sim.world.spawnUnit(0, 'peasant', 50, 80);
    harness.selection.set([u1.id, u2.id]);
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      ctrlKey: true,
      repeat: false,
      timeStamp: 100,
    });
    harness.selection.clear();
    expect(harness.selection.ids).toHaveLength(0);

    // First press: non-repeat -> selects group 1
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      repeat: false,
      timeStamp: 1000,
    });
    expect(harness.selection.ids).toEqual([u1.id, u2.id]);
    expect(harness.camera.centerOn).not.toHaveBeenCalled();

    // Holding the key: autorepeats arrive with repeat: true
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      repeat: true,
      timeStamp: 1020,
    });
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      repeat: true,
      timeStamp: 1040,
    });
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      repeat: true,
      timeStamp: 1060,
    });

    // Autorepeat MUST NOT call selectGroup again or trigger double-tap centring
    expect(harness.selection.ids).toEqual([u1.id, u2.id]);
    expect(harness.camera.centerOn).not.toHaveBeenCalled();

    // Second non-repeat press within 300 ms triggers double-tap centring on midpoint (45, 70)
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      repeat: false,
      timeStamp: 1050,
    });
    expect(harness.selection.ids).toEqual([u1.id, u2.id]);
    expect(harness.camera.centerOn).toHaveBeenCalledWith(45, 70);
  });

  it('repeat of W issues one stop', () => {
    const harness = createHarness();

    // Initial press issues stop
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.executedOrders).toEqual(['stop']);

    // Autorepeats while held MUST NOT issue extra stop orders
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      repeat: true,
      timeStamp: 100,
    });
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      repeat: true,
      timeStamp: 100,
    });

    expect(harness.executedOrders).toEqual(['stop']);
  });

  it('editable targets ignored', () => {
    const harness = createHarness({ debugEnabled: true });

    // Input target
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      target: { tagName: 'INPUT' } as unknown as EventTarget,
      timeStamp: 100,
    });
    expect(harness.executedOrders).toHaveLength(0);

    // Textarea target
    const prevIds = [...harness.selection.ids];
    harness.hotkeys.handleKeyDown({
      code: 'Digit1',
      target: { tagName: 'TEXTAREA' } as unknown as EventTarget,
      timeStamp: 100,
    });
    expect(harness.selection.ids).toEqual(prevIds);
    // ContentEditable target
    harness.hotkeys.handleKeyDown({
      code: 'KeyH',
      target: { isContentEditable: true } as unknown as EventTarget,
      timeStamp: 100,
    });
    expect(harness.centeredTownCenter).toBe(false);

    // Arrow pan ignored on editable target
    harness.hotkeys.handleKeyDown({
      code: 'ArrowUp',
      target: { tagName: 'input' } as unknown as EventTarget,
      timeStamp: 100,
    });
    harness.hotkeys.handleKeyUp({
      code: 'ArrowUp',
      target: { tagName: 'input' } as unknown as EventTarget,
      timeStamp: 100,
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
      timeStamp: 100,
    });

    expect(harness.executedOrders).toEqual(['move']);
  });

  it('Ctrl+Digit assigns, Digit recalls', () => {
    const harness = createHarness();
    const sim = harness.session.sim;
    const p1 = sim.world.spawnUnit(0, 'peasant', 20, 20);
    const p2 = sim.world.spawnUnit(0, 'peasant', 30, 30);

    // Ctrl+Digit assigns group
    harness.selection.set([p1.id]);
    harness.hotkeys.handleKeyDown({
      code: 'Digit2',
      ctrlKey: true,
      repeat: false,
      timeStamp: 100,
    });
    harness.selection.clear();
    expect(harness.selection.ids).toHaveLength(0);

    // Meta+Digit assigns group
    harness.selection.set([p2.id]);
    harness.hotkeys.handleKeyDown({
      code: 'Digit3',
      metaKey: true,
      repeat: false,
      timeStamp: 200,
    });
    harness.selection.clear();
    expect(harness.selection.ids).toHaveLength(0);

    // Plain Digit recalls group
    harness.hotkeys.handleKeyDown({
      code: 'Digit2',
      repeat: false,
      timeStamp: 300,
    });
    expect(harness.selection.ids).toEqual([p1.id]);

    // Plain Digit3 recalls group 3
    harness.selection.clear();
    harness.hotkeys.handleKeyDown({
      code: 'Digit3',
      repeat: false,
      timeStamp: 400,
    });
    expect(harness.selection.ids).toEqual([p2.id]);
  });

  it('G runs an enabled card action, otherwise toggles the grid only when debugEnabled', () => {
    // 1. Slot G has no action, debugEnabled is true -> toggles debug grid
    const debugHarness = createHarness({ debugEnabled: true });
    debugHarness.hotkeys.handleKeyDown({
      code: 'KeyG',
      repeat: false,
      timeStamp: 100,
    });
    expect(debugHarness.toggledDebugGrid).toBe(true);
    expect(debugHarness.executedOrders).toHaveLength(0);

    // 2. Slot G has no action, debugEnabled is false -> does NOT toggle grid
    const releaseHarness = createHarness({ debugEnabled: false });
    releaseHarness.hotkeys.handleKeyDown({
      code: 'KeyG',
      repeat: false,
      timeStamp: 100,
    });
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

    actionHarness.hotkeys.handleKeyDown({
      code: 'KeyG',
      repeat: false,
      timeStamp: 100,
    });
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

    reasonHarness.hotkeys.handleKeyDown({
      code: 'KeyG',
      repeat: false,
      timeStamp: 100,
    });
    expect(reasonHarness.statusMessages).toEqual(['Custom reason']);
    expect(reasonHarness.toggledDebugGrid).toBe(false);
    reasonSpy.mockRestore();
  });

  it('routes arrows, KeyH, Period, Delete, Escape and respects modifiers', () => {
    const harness = createHarness();

    // Arrows forward to camera.setPanKey on keydown and keyup
    harness.hotkeys.handleKeyDown({
      code: 'ArrowRight',
      shiftKey: true,
      timeStamp: 100,
    });
    harness.hotkeys.handleKeyUp({ code: 'ArrowRight', timeStamp: 100 });
    expect(harness.panKeys).toEqual([
      { direction: 'right', pressed: true },
      { direction: 'right', pressed: false },
    ]);

    // KeyH centers on Town Center
    harness.hotkeys.handleKeyDown({
      code: 'KeyH',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.centeredTownCenter).toBe(true);

    // Period cycles idle worker
    harness.hotkeys.handleKeyDown({
      code: 'Period',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.cycledWorker).toBe(true);

    // Delete issues delete order
    harness.hotkeys.handleKeyDown({
      code: 'Delete',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.executedOrders).toContain('delete');

    // Escape issues back order and cancels drag
    harness.hotkeys.handleKeyDown({
      code: 'Escape',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.executedOrders).toContain('back');
    expect(harness.selection.cancelDrag).toHaveBeenCalled();

    // Hotkeys ignored while Ctrl/Alt/Meta is held
    const prevOrdersLen = harness.executedOrders.length;
    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      ctrlKey: true,
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.executedOrders).toHaveLength(prevOrdersLen);
  });

  it('active placement prioritises Escape to cancel and KeyR to rotate over card slots', () => {
    const harness = createHarness({ placementActive: true });
    const defaultPrevented: string[] = [];

    // 1. Escape cancels placement without triggering back order or selection drag cancel
    harness.hotkeys.handleKeyDown({
      code: 'Escape',
      repeat: false,
      timeStamp: 100,
      preventDefault: () => {
        defaultPrevented.push('Escape');
      },
    });
    expect(harness.placement.cancel).toHaveBeenCalled();
    expect(harness.executedOrders).not.toContain('back');
    expect(harness.selection.cancelDrag).not.toHaveBeenCalled();
    expect(defaultPrevented).toContain('Escape');

    // 2. KeyR rotates placement without triggering slot R (attackMove)
    harness.hotkeys.handleKeyDown({
      code: 'KeyR',
      repeat: false,
      timeStamp: 100,
      preventDefault: () => {
        defaultPrevented.push('KeyR');
      },
    });
    expect(harness.placement.rotate).toHaveBeenCalled();
    expect(harness.executedOrders).not.toContain('attackMove');
    expect(defaultPrevented).toContain('KeyR');
  });

  it('placement keys retain editable, modifier and repeat filtering', () => {
    const harness = createHarness({ placementActive: true });
    for (const code of ['Escape', 'KeyR']) {
      harness.hotkeys.handleKeyDown({ code, repeat: true, timeStamp: 100 });
      harness.hotkeys.handleKeyDown({ code, ctrlKey: true, timeStamp: 100 });
      harness.hotkeys.handleKeyDown({ code, metaKey: true, timeStamp: 100 });
      harness.hotkeys.handleKeyDown({ code, altKey: true, timeStamp: 100 });
      harness.hotkeys.handleKeyDown({
        code,
        target: { tagName: 'INPUT' } as unknown as EventTarget,
        timeStamp: 100,
      });
    }
    expect(harness.placement.cancel).not.toHaveBeenCalled();
    expect(harness.placement.rotate).not.toHaveBeenCalled();
    harness.hotkeys.handleKeyDown({
      code: 'KeyR',
      shiftKey: true,
      timeStamp: 100,
    });
    expect(harness.placement.rotate).toHaveBeenCalledOnce();
  });
  it('dispatches Age I archery, gates extra Keep, and exposes walls at actual Age II', () => {
    const harness = createHarness();
    harness.orders.submenu = 'military';
    harness.hotkeys.handleKeyDown({ code: 'KeyW', timeStamp: 100 });
    expect(harness.executedSlots[0]).toMatchObject({
      action: 'build',
      buildingType: 'archery_range',
      disabled: false,
    });
    harness.orders.submenu = 'economic';
    harness.hotkeys.handleKeyDown({ code: 'KeyT', timeStamp: 100 });
    expect(harness.executedSlots[1]).toMatchObject({
      buildingType: 'keep',
      disabled: true,
    });
    harness.session.sim.world.players[0].age = 2;
    harness.hotkeys.handleKeyDown({ code: 'KeyT', timeStamp: 100 });
    expect(harness.executedSlots[2]).toMatchObject({
      buildingType: 'keep',
      disabled: false,
    });
    harness.orders.submenu = 'military';
    harness.hotkeys.handleKeyDown({ code: 'KeyA', timeStamp: 100 });
    expect(harness.executedSlots[3]).toMatchObject({
      buildingType: 'stone_wall',
      disabled: false,
    });
    const clans = createHarness({ faction: 'clans' });
    clans.orders.submenu = 'military';
    clans.hotkeys.handleKeyDown({ code: 'KeyA', timeStamp: 100 });
    expect(clans.executedSlots[0]).toMatchObject({
      buildingType: 'palisade',
      disabled: false,
    });
  });

  it('typed slot dispatcher passes CommandSlot with typed metadata and handles disabled reason', () => {
    const harness = createHarness();

    // Spy getCommandSlots returning custom typed slots
    const spy = vi
      .spyOn(commandSlotsModule, 'getCommandSlots')
      .mockReturnValueOnce([
        {
          key: 'Q',
          id: 'build-farm',
          label: 'Farm',
          action: 'build',
          buildingType: 'farm',
          disabled: false,
        },
      ] satisfies commandSlotsModule.CommandSlot[]);

    harness.hotkeys.handleKeyDown({
      code: 'KeyQ',
      repeat: false,
      timeStamp: 100,
    });

    // Dispatched typed slot with action 'build' and buildingType 'farm'
    expect(harness.executedSlots).toHaveLength(1);
    expect(harness.executedSlots[0].key).toBe('Q');
    expect(harness.executedSlots[0].action).toBe('build');
    expect(harness.executedSlots[0].buildingType).toBe('farm');
    expect(harness.executedOrders).toEqual(['build']);
    spy.mockRestore();

    // Disabled slot with reason displays status message without executing
    const reasonSpy = vi
      .spyOn(commandSlotsModule, 'getCommandSlots')
      .mockReturnValueOnce([
        {
          key: 'W',
          id: 'train-cart',
          label: 'Ox Cart',
          action: 'train',
          unitType: 'ox_cart',
          disabled: true,
          reason: 'Requires Storehouse',
        },
      ] satisfies commandSlotsModule.CommandSlot[]);

    harness.hotkeys.handleKeyDown({
      code: 'KeyW',
      repeat: false,
      timeStamp: 100,
    });
    expect(harness.statusMessages).toContain('Requires Storehouse');
    expect(harness.executedOrders).toEqual(['build']); // no new order executed
    reasonSpy.mockRestore();
  });

  describe('deterministic consumer regression: event-time double-tap contract', () => {
    it('two events 50ms apart centre group even when handling clock advances > 300ms', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const u1 = sim.world.spawnUnit(0, 'peasant', 40, 60);
      const u2 = sim.world.spawnUnit(0, 'peasant', 50, 80);
      harness.selection.set([u1.id, u2.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        ctrlKey: true,
        repeat: false,
        timeStamp: 50,
      });
      harness.selection.clear();

      const perfSpy = vi
        .spyOn(performance, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(2000);

      try {
        // Tap 1 at timeStamp: 100 (handling clock: 1000)
        harness.hotkeys.handleKeyDown({
          code: 'Digit1',
          repeat: false,
          timeStamp: 100,
        });
        expect(harness.selection.ids).toEqual([u1.id, u2.id]);
        expect(harness.camera.centerOn).not.toHaveBeenCalled();

        // Even when handling clock advances > 300ms, input creation time delta is 50ms (150 - 100)
        harness.hotkeys.handleKeyDown({
          code: 'Digit1',
          repeat: false,
          timeStamp: 150,
        });
        const expectedX = (u1.x + u2.x) / 2;
        const expectedZ = (u1.z + u2.z) / 2;
        expect(harness.camera.centerOn).toHaveBeenCalledWith(
          expectedX,
          expectedZ,
        );
      } finally {
        perfSpy.mockRestore();
      }
    });

    it('two events >= 300ms apart do not centre even if delivered together', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const u1 = sim.world.spawnUnit(0, 'peasant', 40, 60);
      harness.selection.set([u1.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        ctrlKey: true,
        repeat: false,
        timeStamp: 100,
      });
      harness.selection.clear();

      // Tap 1 at timeStamp: 1000
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1000,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();

      // Tap 2 at timeStamp: 1300 (delta = 300ms >= 300ms) delivered immediately together
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1300,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();

      // Tap 3 at timeStamp: 1800 (delta = 500ms >= 300ms)
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1800,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();
    });

    it('one centre single pair reset: 3rd tap 50ms after 2nd does not centre again', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const u1 = sim.world.spawnUnit(0, 'peasant', 40, 60);
      harness.selection.set([u1.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        ctrlKey: true,
        repeat: false,
        timeStamp: 100,
      });
      harness.selection.clear();

      // Pair 1: Tap 1 at 1000, Tap 2 at 1050 -> centres once
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1000,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1050,
      });
      expect(harness.camera.centerOn).toHaveBeenCalledTimes(1);
      harness.camera.centerOn.mockClear();

      // Tap 3 at 1100 (50ms after Tap 2): single pair reset -> does NOT centre again
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1100,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();

      // Tap 4 at 1150 (50ms after Tap 3): completes new pair -> centres
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1150,
      });
      expect(harness.camera.centerOn).toHaveBeenCalledTimes(1);
    });

    it('identity groups: consecutive taps on different groups do not centre', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const u1 = sim.world.spawnUnit(0, 'peasant', 20, 20);
      const u2 = sim.world.spawnUnit(0, 'peasant', 40, 40);
      harness.selection.set([u1.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        ctrlKey: true,
        repeat: false,
        timeStamp: 100,
      });
      harness.selection.set([u2.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit2',
        ctrlKey: true,
        repeat: false,
        timeStamp: 110,
      });
      harness.selection.clear();

      // Tap group 1 at 1000, tap group 2 at 1050
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1000,
      });
      harness.hotkeys.handleKeyDown({
        code: 'Digit2',
        repeat: false,
        timeStamp: 1050,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();
    });

    it('dead and pruned entities: double-tap on pruned empty group does not centre', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const u1 = sim.world.spawnUnit(0, 'peasant', 30, 30);
      harness.selection.set([u1.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        ctrlKey: true,
        repeat: false,
        timeStamp: 100,
      });

      // Kill the entity
      u1.hp = 0;

      // Double-tap Digit1 at 1000 and 1050
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1000,
      });
      harness.hotkeys.handleKeyDown({
        code: 'Digit1',
        repeat: false,
        timeStamp: 1050,
      });
      expect(harness.camera.centerOn).not.toHaveBeenCalled();
    });

    it('building entity centres on footprint midpoint (x + w/2, z + h/2)', () => {
      const harness = createHarness();
      const sim = harness.session.sim;
      const farm = sim.world.spawnBuilding(0, 'farm', 20, 30, true);
      const expectedX = farm.x + farm.width / 2;
      const expectedZ = farm.z + farm.height / 2;
      harness.selection.set([farm.id]);
      harness.hotkeys.handleKeyDown({
        code: 'Digit4',
        ctrlKey: true,
        repeat: false,
        timeStamp: 100,
      });
      harness.selection.clear();

      // Double-tap Digit4 at 1000 and 1050
      harness.hotkeys.handleKeyDown({
        code: 'Digit4',
        repeat: false,
        timeStamp: 1000,
      });
      harness.hotkeys.handleKeyDown({
        code: 'Digit4',
        repeat: false,
        timeStamp: 1050,
      });
      expect(harness.camera.centerOn).toHaveBeenCalledWith(
        expectedX,
        expectedZ,
      );
    });
  });
});
