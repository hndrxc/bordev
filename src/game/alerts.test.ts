import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOpenSim } from '../sim/testFixtures';
import { pushHudAlert } from '../ui/hud';
import { AlertFeed } from './alerts';

vi.mock('../ui/hud', () => ({
  getHudNow: () => 1000,
  pushHudAlert: vi.fn(),
}));

const sink = vi.mocked(pushHudAlert);

beforeEach(() => {
  sink.mockClear();
});

describe('AlertFeed', () => {
  it('suppresses nearby attacks for 200 ticks without hiding distant or later attacks', () => {
    const { world } = makeOpenSim({ players: 2 });
    const feed = new AlertFeed(0);
    world.tick = 100;
    feed.ingest(
      [
        { kind: 'underAttack', entityId: 1, player: 1, x: 10, z: 10 },
        { kind: 'underAttack', entityId: 2, player: 0, x: 10, z: 10 },
      ],
      world,
    );
    expect(sink).toHaveBeenCalledExactlyOnceWith({
      id: 1,
      kind: 'underAttack',
      text: 'Under attack',
      x: 10,
      z: 10,
      at: 1000,
    });

    world.tick = 150;
    feed.ingest(
      [{ kind: 'underAttack', entityId: 2, player: 0, x: 13, z: 10 }],
      world,
    );
    expect(sink).toHaveBeenCalledTimes(1);

    feed.ingest(
      [{ kind: 'underAttack', entityId: 3, player: 0, x: 30, z: 10 }],
      world,
    );
    expect(sink).toHaveBeenCalledTimes(2);

    // The older nearby alert still suppresses repeats after a distant alert.
    feed.ingest(
      [{ kind: 'underAttack', entityId: 2, player: 0, x: 11, z: 10 }],
      world,
    );
    expect(sink).toHaveBeenCalledTimes(2);

    world.tick = 300;
    feed.ingest(
      [{ kind: 'underAttack', entityId: 2, player: 0, x: 10, z: 10 }],
      world,
    );
    expect(sink).toHaveBeenCalledTimes(3);
  });

  it('maps shortage reasons to resource alerts', () => {
    const feed = new AlertFeed(0);
    for (const reason of [
      'Not enough food',
      'Not enough gold',
      'Not enough food and gold',
      'Insufficient resources',
      'Not enough resources for wall run',
    ]) {
      expect(feed.rejection(reason)).toBe(true);
    }

    const alerts = sink.mock.calls.map(([alert]) => alert);
    expect(alerts.map((alert) => alert.text)).toEqual([
      'Not enough food',
      'Not enough gold',
      'Not enough food and gold',
      'Not enough resources',
      'Not enough resources',
    ]);
    expect(alerts.every((alert) => alert.kind === 'resources')).toBe(true);
    expect(new Set(alerts.map((alert) => alert.id)).size).toBe(5);
    expect(feed.latestPosition()).toBeNull();
  });

  it('leaves non-shortage rejection reasons to the caller', () => {
    const feed = new AlertFeed(0);
    expect(feed.rejection('Tile is blocked')).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  it('maps viewer transitions and retains the newest position through unpositioned alerts', () => {
    const { world } = makeOpenSim({ players: 2 });
    const keep = world.spawnBuilding(0, 'keep', 4, 6);
    world.players[1].faction = 'clans';
    const hall = world.spawnBuilding(1, 'great_hall', 20, 20);
    const feed = new AlertFeed(0);
    expect(feed.latestPosition()).toBeNull();

    feed.ingest(
      [
        { kind: 'ageReached', player: 1, age: 2 },
        {
          kind: 'populationCapped',
          player: 1,
          buildingId: hall.id,
          x: 22,
          z: 22,
        },
        { kind: 'faithLow', player: 1 },
      ],
      world,
    );
    expect(sink).not.toHaveBeenCalled();

    feed.ingest(
      [
        {
          kind: 'populationCapped',
          player: 0,
          buildingId: keep.id,
          x: 11,
          z: 12,
        },
        { kind: 'faithLow', player: 0 },
      ],
      world,
    );
    expect(sink.mock.calls.map(([alert]) => alert)).toEqual([
      {
        id: 1,
        kind: 'population',
        text: 'Not enough population',
        x: 11,
        z: 12,
        at: 1000,
      },
      { id: 2, kind: 'faith', text: 'Not enough faith', at: 1000 },
    ]);
    expect(feed.latestPosition()).toEqual({ x: 11, z: 12 });

    feed.ingest([{ kind: 'ageReached', player: 0, age: 2 }], world);
    const keepCentre = {
      x: keep.x + keep.width * 0.5,
      z: keep.z + keep.height * 0.5,
    };
    expect(sink).toHaveBeenLastCalledWith({
      id: 3,
      kind: 'age',
      text: 'Borough reached',
      ...keepCentre,
      at: 1000,
    });
    feed.ingest([{ kind: 'faithLow', player: 0 }], world);
    feed.rejection('Not enough gold');
    expect(feed.latestPosition()).toEqual(keepCentre);

    const clansFeed = new AlertFeed(1);
    clansFeed.ingest([{ kind: 'ageReached', player: 1, age: 3 }], world);
    expect(sink).toHaveBeenLastCalledWith({
      id: 1,
      kind: 'age',
      text: 'Warhold reached',
      x: hall.x + hall.width * 0.5,
      z: hall.z + hall.height * 0.5,
      at: 1000,
    });
  });
});
