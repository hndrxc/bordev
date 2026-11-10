import { describe, expect, it } from 'vitest';
import type { UnitEntity } from './entity.js';
import type { Sim } from './sim.js';
import { makeOpenSim } from './testFixtures.js';
import type { World } from './world.js';
import { completeUpgrade } from './systems/upgrades.js';

interface CombatSetup {
  sim: Sim;
  world: World;
  manAtArms: UnitEntity;
}

/**
 * Spawns a Clans axeman next to an enemy man-at-arms and orders the attack.
 * The first swing lands within a few ticks, so the man-at-arms' first HP loss
 * is exactly one swing's damage.
 */
function setupCombat(configure?: (world: World) => void): CombatSetup {
  const sim = makeOpenSim({ players: 2, factions: { 0: 'clans' } });
  const world = sim.world;
  configure?.(world);
  const axeman = world.spawnUnit(0, 'axeman', 10, 10);
  const manAtArms = world.spawnUnit(1, 'man_at_arms', 10.6, 10);
  sim.updateFog();
  sim.issue({
    kind: 'attack',
    player: 0,
    ids: [axeman.id],
    targetId: manAtArms.id,
    queued: false,
  });
  return { sim, world, manAtArms };
}

function firstHitDamage({ sim, manAtArms }: CombatSetup): number {
  for (let tick = 0; tick < 200 && manAtArms.hp === manAtArms.maxHp; tick++) {
    sim.step();
  }
  expect(manAtArms.hp).toBeLessThan(manAtArms.maxHp);
  return manAtArms.maxHp - manAtArms.hp;
}

describe('Battle Fervor', () => {
  it('axeman deals 4 damage to a man-at-arms without Fervor', () => {
    const setup = setupCombat();
    expect(firstHitDamage(setup)).toBe(4);
  });

  it('adds +1 attack once the faith surplus reaches the threshold', () => {
    const setup = setupCombat((world) => {
      world.spawnBuilding(0, 'war_shrine', 2, 2);
    });
    expect(firstHitDamage(setup)).toBe(5);
  });

  it('is active at exactly the 5-faith threshold', () => {
    const setup = setupCombat((world) => {
      world.spawnBuilding(0, 'great_hall', 2, 2);
    });
    expect(firstHitDamage(setup)).toBe(5);
  });

  it('stays inactive below the threshold (surplus 3)', () => {
    const setup = setupCombat((world) => {
      world.spawnBuilding(0, 'great_hall', 2, 2);
      world.spawnBuilding(0, 'mead_hall', 20, 2);
    });
    expect(firstHitDamage(setup)).toBe(4);
  });

  it('Blood Rites raises the bonus to +2 and War Shrines produce 15 faith', () => {
    const setup = setupCombat((world) => {
      world.spawnBuilding(0, 'war_shrine', 2, 2);
      expect(completeUpgrade(world.players[0], 'blood_rites')).toBe(true);
    });
    setup.sim.step();
    expect(setup.world.players[0].faithProduced).toBe(15);
    expect(firstHitDamage(setup)).toBe(6);
  });
});

describe('Berserker regeneration', () => {
  it('heals 0.5 HP/s in whole HP over time', () => {
    const sim = makeOpenSim({ players: 2, factions: { 0: 'clans' } });
    const berserker = sim.world.spawnUnit(0, 'berserker', 5, 5);
    berserker.hp = berserker.maxHp - 10;

    for (let tick = 0; tick < 200; tick++) {
      sim.step();
    }

    expect(berserker.hp).toBe(berserker.maxHp - 5);
  });

  it('caps at max HP without banking regeneration progress', () => {
    const sim = makeOpenSim({ players: 2, factions: { 0: 'clans' } });
    const berserker = sim.world.spawnUnit(0, 'berserker', 5, 5);
    berserker.hp = berserker.maxHp - 1;

    for (let tick = 0; tick < 200; tick++) {
      sim.step();
    }

    expect(berserker.hp).toBe(berserker.maxHp);
  });

  it('leaves units without regeneration unchanged', () => {
    const sim = makeOpenSim({ players: 2, factions: { 0: 'clans' } });
    const axeman = sim.world.spawnUnit(0, 'axeman', 5, 5);
    axeman.hp = axeman.maxHp - 10;

    for (let tick = 0; tick < 200; tick++) {
      sim.step();
    }

    expect(axeman.hp).toBe(axeman.maxHp - 10);
  });
});
