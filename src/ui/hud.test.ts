import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useHudStore,
  publishHud,
  resetHud,
  setHudStatus,
  setHudClock,
  getEntityDisplayName,
} from './hud';
import { minimapToWorld, worldToMinimap } from './Minimap';
import { screenToGround, type IsoView } from '../render/iso';
import type { GameSession } from '../game/GameSession';

interface FakeEntity {
  id: number;
  kind: string;
  type?: string;
  hp?: number;
  maxHp?: number;
  player?: number;
}

function createFakeSession(options?: {
  food?: number;
  selectedIds?: number[];
  entities?: FakeEntity[];
  snapshotEntities?: {
    id: number;
    kind: string;
    type?: string;
    x: number;
    z: number;
    width?: number;
    height?: number;
    player?: number;
  }[];
  viewportInsets?: { top: number; bottom: number };
  view?: IsoView;
}): GameSession {
  const p0 = {
    food: options?.food ?? 100,
    gold: 50,
    faithUsed: 0,
    faithProduced: 0,
    pop: 4,
    popCap: 10,
    age: 1 as const,
    faction: 'crown',
  };

  const entitiesById: Record<number, FakeEntity> = {};
  if (options?.entities) {
    for (const e of options.entities) {
      entitiesById[e.id] = e;
    }
  }

  const fakeSession = {
    debugEnabled: false,
    showStatus(message: string) {
      setHudStatus(message);
    },
    sim: {
      world: {
        players: [p0],
        getEntity: (id: number) => entitiesById[id],
      },
    },
    input: {
      selection: {
        ids: options?.selectedIds ?? [],
      },
      orders: {
        mode: null,
        submenu: null,
      },
      camera: {
        viewportInsets: options?.viewportInsets ?? { top: 0, bottom: 0 },
        centerOn: () => {},
      },
    },
    map: {
      size: 128,
      tiles: new Uint8Array(128 * 128),
    },
    snapshot: {
      tick: 1,
      alpha: 0,
      simTime: 0.05,
      entities: options?.snapshotEntities ?? [],
    },
    renderer: {
      camera: {
        view: options?.view ?? {
          targetX: 64,
          targetZ: 64,
          width: 1280,
          height: 720,
          zoom: 1,
        },
      },
    },
  } as unknown as GameSession;

  return fakeSession;
}

describe('HUD Store & Minimap', () => {
  let currentTime = 1000;

  beforeEach(() => {
    currentTime = 1000;
    setHudClock(() => currentTime);
    resetHud();
  });

  afterEach(() => {
    setHudClock(null);
  });

  it('status clears after 4 s and a new showStatus/setHudStatus restarts the timer', () => {
    const session = createFakeSession();

    // Initial message at t = 1000
    session.showStatus('Initial notice');
    expect(useHudStore.getState().status).toBe('Initial notice');

    // Advance 2000 ms -> total elapsed = 2000 ms (< 4000 ms)
    currentTime = 3000;
    publishHud(session);
    expect(useHudStore.getState().status).toBe('Initial notice');

    // New message at t = 4000 (3000 ms after first) restarts the timer
    currentTime = 4000;
    session.showStatus('Second notice');
    expect(useHudStore.getState().status).toBe('Second notice');

    // Advance to t = 7000 (3000 ms after second notice, 6000 ms after first)
    currentTime = 7000;
    publishHud(session);
    expect(useHudStore.getState().status).toBe('Second notice');

    // Advance to t = 8001 (4001 ms after second notice) -> auto-cleared
    currentTime = 8001;
    publishHud(session);
    expect(useHudStore.getState().status).toBe('');
  });

  it('publishing an unchanged fake session twice keeps resources/selection/orders/minimap identity and changing food replaces only resources', () => {
    const peasant = {
      id: 1,
      kind: 'unit',
      type: 'peasant',
      hp: 50,
      maxHp: 50,
    };
    const session = createFakeSession({
      food: 100,
      selectedIds: [1],
      entities: [peasant],
      snapshotEntities: [{ id: 1, kind: 'unit', x: 20, z: 20, player: 0 }],
    });

    publishHud(session);
    const s1 = useHudStore.getState();
    const r1 = s1.resources;
    const sel1 = s1.selection;
    const ord1 = s1.orders;
    const mini1 = s1.minimap;

    // Publish unchanged session
    publishHud(session);
    const s2 = useHudStore.getState();
    expect(s2.resources).toBe(r1);
    expect(s2.selection).toBe(sel1);
    expect(s2.orders).toBe(ord1);
    expect(s2.minimap).toBe(mini1);

    // Modify only food
    session.sim!.world.players[0].food = 250;

    publishHud(session);
    const s3 = useHudStore.getState();
    expect(s3.resources).not.toBe(r1);
    expect(s3.resources.food).toBe(250);
    expect(s3.selection).toBe(sel1);
    expect(s3.orders).toBe(ord1);
    expect(s3.minimap).toBe(mini1);
  });

  it('plots 4x4 building and 3x3 mine at footprint centre', () => {
    const session = createFakeSession({
      snapshotEntities: [
        {
          id: 10,
          kind: 'building',
          type: 'keep',
          x: 20,
          z: 20,
          width: 4,
          height: 4,
          player: 0,
        },
        {
          id: 11,
          kind: 'mine',
          type: 'gold_mine',
          x: 50,
          z: 50,
          width: 3,
          height: 3,
          player: -1,
        },
        { id: 12, kind: 'unit', type: 'peasant', x: 15, z: 15, player: 0 },
      ],
    });

    publishHud(session);
    const units = useHudStore.getState().minimap.units;
    expect(units).toHaveLength(3);
    // Keep footprint centre is 20 + 4/2 = 22, 20 + 4/2 = 22
    expect(units[0].x).toBe(22);
    expect(units[0].z).toBe(22);
    // Mine footprint centre is 50 + 3/2 = 51.5, 50 + 3/2 = 51.5
    expect(units[1].x).toBe(51.5);
    expect(units[1].z).toBe(51.5);
    // Unit is not modified
    expect(units[2].x).toBe(15);
    expect(units[2].z).toBe(15);
  });

  it('viewport outline uses insets and bottom edge moves up when bottom inset grows', () => {
    const view: IsoView = {
      targetX: 64,
      targetZ: 64,
      width: 1280,
      height: 720,
      zoom: 1,
    };

    const sessionNoBottomInset = createFakeSession({
      view,
      viewportInsets: { top: 40, bottom: 0 },
    });
    publishHud(sessionNoBottomInset);
    const corners0 = useHudStore.getState().minimap.viewportCorners!;
    expect(corners0).toBeDefined();
    expect(corners0).toHaveLength(4);

    // Corner 2 is (view.width, height - bottom = 720)
    const expectedC2_0 = screenToGround(view.width, 720, view);
    expect(corners0[2].x).toBeCloseTo(expectedC2_0.x, 5);
    expect(corners0[2].z).toBeCloseTo(expectedC2_0.z, 5);

    const sessionWithBottomInset = createFakeSession({
      view,
      viewportInsets: { top: 40, bottom: 186 },
    });
    publishHud(sessionWithBottomInset);
    const corners1 = useHudStore.getState().minimap.viewportCorners!;
    expect(corners1).toBeDefined();

    // Corner 2 is (view.width, 720 - 186 = 534)
    const expectedC2_1 = screenToGround(view.width, 720 - 186, view);
    expect(corners1[2].x).toBeCloseTo(expectedC2_1.x, 5);
    expect(corners1[2].z).toBeCloseTo(expectedC2_1.z, 5);

    // Bottom edge in minimap coordinates moves up (my decreases)
    const m0 = worldToMinimap(corners0[2].x, corners0[2].z, 128, 180, 180);
    const m1 = worldToMinimap(corners1[2].x, corners1[2].z, 128, 180, 180);
    expect(m1.my).toBeLessThan(m0.my);
  });

  it('minimap<->world mapping round-trips and is not axis-swapped for off-centre points', () => {
    const wx = 35;
    const wz = 75;
    const mapSize = 128;
    const width = 180;
    const height = 180;

    const { mx, my } = worldToMinimap(wx, wz, mapSize, width, height);
    const back = minimapToWorld(mx, my, mapSize, width, height);

    expect(back.x).toBeCloseTo(wx, 5);
    expect(back.z).toBeCloseTo(wz, 5);
    expect(back.x).not.toBeCloseTo(wz, 5);
    expect(back.z).not.toBeCloseTo(wx, 5);
  });

  it('getEntityDisplayName returns data-driven names for units, buildings, and mines', () => {
    expect(getEntityDisplayName({ kind: 'unit', type: 'peasant' })).toBe(
      'Peasant',
    );
    expect(getEntityDisplayName({ kind: 'unit', type: 'thrall' })).toBe(
      'Thrall',
    );
    expect(getEntityDisplayName({ kind: 'unit', type: 'spearman' })).toBe(
      'Spearman',
    );
    expect(getEntityDisplayName({ kind: 'building', type: 'keep' })).toBe(
      'Keep (Town Center)',
    );
    expect(getEntityDisplayName({ kind: 'building', type: 'great_hall' })).toBe(
      'Great Hall (Town Center)',
    );
    expect(getEntityDisplayName({ kind: 'mine', type: 'gold_mine' })).toBe(
      'Gold Mine',
    );
    expect(getEntityDisplayName({ kind: 'mine' })).toBe('Gold Mine');
    expect(getEntityDisplayName({ kind: 'doodad', type: 'tree_oak' })).toBe(
      'Tree',
    );
    expect(getEntityDisplayName({ kind: 'doodad', type: 'rock_large' })).toBe(
      'Rock',
    );
  });
});
