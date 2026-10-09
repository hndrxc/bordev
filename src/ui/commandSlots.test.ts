import { describe, expect, it } from 'vitest';
import { Sim } from '../sim/sim';
import { type GameMap, Terrain } from '../sim/map';
import {
  getCommandSlots,
  getCommandSlotContext,
} from './commandSlots';

function makeTestMap(size = 32): GameMap {
  return {
    version: 1,
    id: 'test_map',
    name: 'Test Map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [
      [4, 4],
      [size - 8, size - 8],
    ],
    doodads: [],
  };
}

describe('commandSlots mixed building selections & train availability', () => {
  it('keep + barracks uses keep as active type and never mixes or overflows barracks units', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 500;
    sim.world.players[0].gold = 500;

    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);
    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const context = getCommandSlotContext(sim.world);

    // Selection order: keep first, then barracks
    const selection = [
      { kind: 'building', type: 'keep', id: keep.id, player: 0 },
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
    ];

    const slots = getCommandSlots(selection, null, context);

    // Train slots: Q (peasant), W (ox_cart). E and R are empty.
    expect(slots[0].action).toBe('train');
    expect(slots[0].key).toBe('Q');
    expect(slots[0].unitType).toBe('peasant');
    expect(slots[0].buildingId).toBe(keep.id);
    expect(slots[0].disabled).toBe(false);

    expect(slots[1].action).toBe('train');
    expect(slots[1].key).toBe('W');
    expect(slots[1].unitType).toBe('ox_cart');
    expect(slots[1].buildingId).toBe(keep.id);
    expect(slots[1].disabled).toBe(false);

    expect(slots[2].action).toBeNull();
    expect(slots[2].disabled).toBe(true);

    expect(slots[3].action).toBeNull();
    expect(slots[3].disabled).toBe(true);

    // Shared rally is present on slot 4 (T)
    expect(slots[4].id).toBe('set-rally');
    expect(slots[4].key).toBe('T');

    // Research slots are keep tech (ages), not barracks tech
    expect(slots[5].action).toBe('research');
    expect(slots[5].upgradeId).toBe('age_2');
    expect(slots[5].buildingId).toBe(keep.id);

    // Delete is shared
    expect(slots[10].action).toBe('delete');
    expect(slots[10].key).toBe('Z');
  });

  it('barracks + keep uses barracks as active type and keeps slots stable', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 500;
    sim.world.players[0].gold = 500;

    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);
    const context = getCommandSlotContext(sim.world);

    // Selection order: barracks first, then keep
    const selection = [
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
      { kind: 'building', type: 'keep', id: keep.id, player: 0 },
    ];

    const slots = getCommandSlots(selection, null, context);

    // Barracks units: spearman (Q), man_at_arms (W), halberdier (E)
    expect(slots[0].action).toBe('train');
    expect(slots[0].key).toBe('Q');
    expect(slots[0].unitType).toBe('spearman');
    expect(slots[0].buildingId).toBe(barracks.id);

    expect(slots[1].action).toBe('train');
    expect(slots[1].key).toBe('W');
    expect(slots[1].unitType).toBe('man_at_arms');
    expect(slots[1].buildingId).toBe(barracks.id);

    expect(slots[2].action).toBe('train');
    expect(slots[2].key).toBe('E');
    expect(slots[2].unitType).toBe('halberdier');
    expect(slots[2].buildingId).toBe(barracks.id);

    expect(slots[3].action).toBeNull();
    expect(slots[3].disabled).toBe(true);

    // Shared rally point available
    expect(slots[4].id).toBe('set-rally');

    // Research slots come from barracks, candidate is barracks
    expect(slots[5].action).toBe('research');
    expect(slots[5].buildingId).toBe(barracks.id);
  });

  it('barracks + range + stable does not overflow 4 train slots and keeps keys stable when appended', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 500;
    sim.world.players[0].gold = 500;

    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const archeryRange = sim.world.spawnBuilding(0, 'archery_range', 16, 4, true);
    const stable = sim.world.spawnBuilding(0, 'stable', 22, 4, true);
    const context = getCommandSlotContext(sim.world);

    // Baseline: only barracks selected
    const singleSelection = [
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
    ];
    const singleSlots = getCommandSlots(singleSelection, null, context);

    // Appended: barracks + range + stable
    const mixedSelection = [
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
      { kind: 'building', type: 'archery_range', id: archeryRange.id, player: 0 },
      { kind: 'building', type: 'stable', id: stable.id, player: 0 },
    ];
    const mixedSlots = getCommandSlots(mixedSelection, null, context);

    // Mixed selection train slots MUST exactly match single barracks selection
    for (let i = 0; i < 4; i++) {
      expect(mixedSlots[i].action).toBe(singleSlots[i].action);
      expect(mixedSlots[i].key).toBe(singleSlots[i].key);
      expect(mixedSlots[i].unitType).toBe(singleSlots[i].unitType);
      expect(mixedSlots[i].buildingId).toBe(singleSlots[i].buildingId);
    }

    // Must not contain archery_range or stable units
    const unitTypes = mixedSlots.slice(0, 4).map((s) => s.unitType).filter(Boolean);
    expect(unitTypes).toEqual(['spearman', 'man_at_arms', 'halberdier']);
    expect(unitTypes).not.toContain('longbowman');
    expect(unitTypes).not.toContain('sergeant');

    // Research slots also match single barracks selection (first 5 research slots)
    for (let i = 5; i <= 9; i++) {
      expect(mixedSlots[i].action).toBe(singleSlots[i].action);
      expect(mixedSlots[i].upgradeId).toBe(singleSlots[i].upgradeId);
    }
  });

  it('stable + barracks + range uses stable as active type with stable truncation', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 500;
    sim.world.players[0].gold = 500;

    const stable = sim.world.spawnBuilding(0, 'stable', 22, 4, true);
    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const archeryRange = sim.world.spawnBuilding(0, 'archery_range', 16, 4, true);
    const context = getCommandSlotContext(sim.world);

    const selection = [
      { kind: 'building', type: 'stable', id: stable.id, player: 0 },
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
      { kind: 'building', type: 'archery_range', id: archeryRange.id, player: 0 },
    ];
    const slots = getCommandSlots(selection, null, context);

    // Stable trains sergeant (Q) and knight (W); E and R remain empty
    expect(slots[0].action).toBe('train');
    expect(slots[0].key).toBe('Q');
    expect(slots[0].unitType).toBe('sergeant');
    expect(slots[0].buildingId).toBe(stable.id);

    expect(slots[1].action).toBe('train');
    expect(slots[1].key).toBe('W');
    expect(slots[1].unitType).toBe('knight');
    expect(slots[1].buildingId).toBe(stable.id);

    expect(slots[2].action).toBeNull();
    expect(slots[2].disabled).toBe(true);

    expect(slots[3].action).toBeNull();
    expect(slots[3].disabled).toBe(true);
  });

  it('keeps shared cancel research available across all selected buildings', () => {
    const sim = new Sim(makeTestMap(), 1);
    const keep = sim.world.spawnBuilding(0, 'keep', 4, 4, true);
    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);

    // Keep has no research, but barracks is researching infantry_weapons_1
    barracks.research = {
      upgradeId: 'infantry_weapons_1',
      progress: 5,
      food: 100,
      gold: 50,
      time: 30,
    };

    const context = getCommandSlotContext(sim.world);
    const selection = [
      { kind: 'building', type: 'keep', id: keep.id, player: 0 },
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
    ];

    const slots = getCommandSlots(selection, null, context);

    // Slot 11 (X) is cancel research, referencing the researching barracks
    expect(slots[11].action).toBe('cancelResearch');
    expect(slots[11].key).toBe('X');
    expect(slots[11].buildingId).toBe(barracks.id);
    expect(slots[11].upgradeId).toBe('infantry_weapons_1');
    expect(slots[11].disabled).toBe(false);
  });

  it('disables train slot and provides descriptive reason when player lacks resources', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 0;
    sim.world.players[0].gold = 0;

    const barracks = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const context = getCommandSlotContext(sim.world);

    const selection = [
      { kind: 'building', type: 'barracks', id: barracks.id, player: 0 },
    ];
    const slots = getCommandSlots(selection, null, context);

    expect(slots[0].action).toBe('train');
    expect(slots[0].disabled).toBe(true);
    expect(slots[0].reason).toMatch(/Not enough food/i);
    expect(slots[0].tooltip).toContain(slots[0].reason!);
  });

  it('routes training order to second building when first candidate has full queue', () => {
    const sim = new Sim(makeTestMap(), 1);
    sim.world.players[0].food = 500;
    sim.world.players[0].gold = 500;

    const b1 = sim.world.spawnBuilding(0, 'barracks', 10, 4, true);
    const b2 = sim.world.spawnBuilding(0, 'barracks', 16, 4, true);

    // Fill b1's training queue with 5 items
    b1.trainingQueue = [
      { unitType: 'spearman', progress: 0, food: 35, gold: 25 },
      { unitType: 'spearman', progress: 0, food: 35, gold: 25 },
      { unitType: 'spearman', progress: 0, food: 35, gold: 25 },
      { unitType: 'spearman', progress: 0, food: 35, gold: 25 },
      { unitType: 'spearman', progress: 0, food: 35, gold: 25 },
    ];

    const context = getCommandSlotContext(sim.world);
    const selection = [
      { kind: 'building', type: 'barracks', id: b1.id, player: 0 },
      { kind: 'building', type: 'barracks', id: b2.id, player: 0 },
    ];
    const slots = getCommandSlots(selection, null, context);

    // Slot should NOT be disabled because b2 has room
    expect(slots[0].action).toBe('train');
    expect(slots[0].disabled).toBe(false);
    expect(slots[0].reason).toBeUndefined();
    expect(slots[0].buildingId).toBe(b2.id);
  });

  it('marks slots disabled with Simulation not ready when context is null', () => {
    const selection = [
      { kind: 'building', type: 'barracks', id: 1, player: 0 },
    ];
    const slots = getCommandSlots(selection, null, null);

    expect(slots[0].action).toBe('train');
    expect(slots[0].disabled).toBe(true);
    expect(slots[0].reason).toBe('Simulation not ready');
  });

  it('only shows set-rally slot when at least one selected building is a production type', () => {
    const sim = new Sim(makeTestMap(), 1);
    const cottage = sim.world.spawnBuilding(0, 'cottage', 4, 4, true);
    const farm = sim.world.spawnBuilding(0, 'farm', 8, 4, true);
    const context = getCommandSlotContext(sim.world);

    const nonProdSelection = [
      { kind: 'building', type: 'cottage', id: cottage.id, player: 0 },
      { kind: 'building', type: 'farm', id: farm.id, player: 0 },
    ];
    const slotsNoProd = getCommandSlots(nonProdSelection, null, context);
    expect(slotsNoProd[4].id).not.toBe('set-rally');

    const keep = sim.world.spawnBuilding(0, 'keep', 12, 4, true);
    const prodSelection = [
      { kind: 'building', type: 'cottage', id: cottage.id, player: 0 },
      { kind: 'building', type: 'keep', id: keep.id, player: 0 },
    ];
    const slotsWithProd = getCommandSlots(prodSelection, null, context);
    expect(slotsWithProd[4].id).toBe('set-rally');
  });
});
