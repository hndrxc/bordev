import { describe, expect, it } from 'vitest';
import { getUnitData } from '../../data/units.js';
import type { BuildingEntity } from '../entity.js';
import { SIM_DT, type Sim } from '../sim.js';
import { makeOpenSim } from '../testFixtures.js';
import { applyDamage } from './damage.js';

function makeMatch() {
  return makeOpenSim({
    size: 48,
    players: 2,
    starts: [
      [4, 4],
      [36, 36],
    ],
  });
}

function getKeep(sim: Sim, player: number): BuildingEntity {
  const keep = sim.world.entities.find(
    (entity): entity is BuildingEntity =>
      entity?.kind === 'building' &&
      entity.player === player &&
      entity.type === 'keep',
  );
  if (!keep) throw new Error(`Missing Keep for player ${player}`);
  return keep;
}

describe('match victory', () => {
  it('eliminates the owner of a lethally damaged last Keep and ends the match only once', () => {
    const sim = makeMatch();
    const { world } = sim;
    const keep = getKeep(sim, 1);
    sim.drainEvents();

    applyDamage(world, keep, keep.hp);

    expect(world.getEntity(keep.id)).toBeUndefined();
    expect(world.players[1].eliminated).toBe(true);
    expect(world.outcome).toBeNull();
    const destructionEvents = sim.drainEvents();
    expect(
      destructionEvents.filter((event) => event.kind === 'playerEliminated'),
    ).toEqual([{ kind: 'playerEliminated', player: 1 }]);
    expect(destructionEvents.some((event) => event.kind === 'matchEnded')).toBe(
      false,
    );

    const endTick = world.tick;
    sim.step();
    expect(world.outcome).toEqual({ winnerTeam: 0, endTick });
    const events = sim.drainEvents();
    for (let tick = 0; tick < 5; tick++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.filter((event) => event.kind === 'matchEnded')).toEqual([
      { kind: 'matchEnded', winnerTeam: 0, tick: endTick },
    ]);
    expect(world.outcome).toEqual({ winnerTeam: 0, endTick });
  });

  it('keeps a player alive while an unfinished second Keep remains', () => {
    const sim = makeMatch();
    const { world } = sim;
    world.players[1].age = 2;
    const original = getKeep(sim, 1);
    const unfinished = world.spawnBuilding(1, 'keep', 24, 36, false);
    expect(unfinished.built).toBe(false);
    sim.drainEvents();

    applyDamage(world, original, original.hp);
    sim.step();

    expect(world.players[1].eliminated).toBe(false);
    expect(world.getEntity(unfinished.id)).toBe(unfinished);
    expect(world.outcome).toBeNull();
    expect(
      sim
        .drainEvents()
        .filter(
          (event) =>
            event.kind === 'playerEliminated' || event.kind === 'matchEnded',
        ),
    ).toEqual([]);

    world.removeEntity(unfinished.id);
    expect(world.players[1].eliminated).toBe(true);
    expect(
      sim.drainEvents().filter((event) => event.kind === 'playerEliminated'),
    ).toEqual([{ kind: 'playerEliminated', player: 1 }]);
    sim.step();
    expect(world.outcome?.winnerTeam).toBe(0);
  });

  it('awards team 1 the match on the tick player 0 surrenders', () => {
    const sim = makeMatch();
    sim.drainEvents();
    const endTick = sim.world.tick;

    sim.issue({ kind: 'surrender', player: 0 });
    expect(sim.world.players[0].eliminated).toBe(false);
    expect(sim.world.outcome).toBeNull();
    sim.step();

    expect(sim.world.players[0].eliminated).toBe(true);
    expect(sim.world.players[1].eliminated).toBe(false);
    expect(sim.world.outcome).toEqual({ winnerTeam: 1, endTick });
    expect(
      sim.drainEvents().filter((event) => event.kind === 'matchEnded'),
    ).toEqual([{ kind: 'matchEnded', winnerTeam: 1, tick: endTick }]);
  });

  it('counts completed training but not starting units, and records a lethal unit loss', () => {
    const sim = makeMatch();
    const { world } = sim;
    const player = world.players[0];
    const keep = getKeep(sim, 0);
    const startingUnits = world.entities.filter(
      (entity) => entity?.kind === 'unit' && entity.player === 0,
    );
    expect(startingUnits).toHaveLength(5);
    expect(player.unitsTrained).toBe(0);
    expect(player.unitsLost).toBe(0);
    sim.drainEvents();

    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    const trainTicks = Math.ceil(
      getUnitData('peasant', 'crown')!.trainTime / SIM_DT,
    );
    for (let tick = 0; tick < trainTicks - 1; tick++) sim.step();
    expect(keep.trainingQueue).toHaveLength(1);
    expect(player.unitsTrained).toBe(0);
    sim.step();

    expect(keep.trainingQueue).toHaveLength(0);
    expect(player.unitsTrained).toBe(1);
    expect(
      sim
        .drainEvents()
        .filter(
          (event) =>
            event.kind === 'unitCreated' &&
            event.player === 0 &&
            event.unitType === 'peasant',
        ),
    ).toHaveLength(1);

    const victim = startingUnits[0];
    if (victim?.kind !== 'unit') throw new Error('Missing starting unit');
    applyDamage(world, victim, victim.hp);
    expect(world.getEntity(victim.id)).toBeUndefined();
    expect(player.unitsLost).toBe(1);
    expect(player.unitsTrained).toBe(1);
    expect(
      sim.drainEvents().filter((event) => event.kind === 'unitDied'),
    ).toHaveLength(1);
  });

  it('emits one population-cap event per blocked period and emits again when the cap recurs', () => {
    const sim = makeMatch();
    const { world } = sim;
    const player = world.players[0];
    const keep = getKeep(sim, 0);
    const missingPop = player.popCap - player.pop;
    const fillers = [];
    for (let index = 0; index < missingPop; index++) {
      fillers.push(world.spawnUnit(0, 'peasant', 16.5 + index, 16.5));
    }
    expect(player.pop).toBe(player.popCap);
    sim.drainEvents();

    sim.issue({
      kind: 'train',
      player: 0,
      buildingId: keep.id,
      unitType: 'peasant',
    });
    for (let tick = 0; tick < 10; tick++) sim.step();
    const expectedEvent = {
      kind: 'populationCapped',
      player: 0,
      buildingId: keep.id,
      x: keep.x + keep.width / 2,
      z: keep.z + keep.height / 2,
    };
    expect(
      sim.drainEvents().filter((event) => event.kind === 'populationCapped'),
    ).toEqual([expectedEvent]);
    expect(keep.trainingQueue).toHaveLength(1);
    expect(keep.trainingQueue[0].progress).toBe(0);

    world.removeEntity(fillers[0].id);
    sim.step();
    expect(keep.trainingQueue[0].progress).toBeCloseTo(SIM_DT);
    expect(
      sim.drainEvents().filter((event) => event.kind === 'populationCapped'),
    ).toEqual([]);

    world.spawnUnit(0, 'peasant', 16.5, 18.5);
    expect(player.pop).toBe(player.popCap);
    for (let tick = 0; tick < 10; tick++) sim.step();
    expect(
      sim.drainEvents().filter((event) => event.kind === 'populationCapped'),
    ).toEqual([expectedEvent]);
    expect(keep.trainingQueue[0].progress).toBeCloseTo(SIM_DT);
  });
});
