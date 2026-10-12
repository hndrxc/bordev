import { describe, expect, it } from 'vitest';
import { Sim } from './sim.js';
import { Terrain, type GameMap } from './map.js';
import type { Command } from './commands.js';

function makeCleanMap(size = 48): GameMap {
  return {
    version: 1,
    id: `m7_queue_clean_${size}`,
    name: 'M7 command queue clean map',
    size,
    players: 2,
    tiles: new Uint8Array(size * size).fill(Terrain.GRASS),
    goldMines: [],
    starts: [],
    doodads: [],
  };
}

type QueuedKind = 'move' | 'farm' | 'attack';
type Replacement = 'move' | 'attackMove' | 'stop' | 'hold';

const QUEUED_KINDS: QueuedKind[] = ['move', 'farm', 'attack'];
const REPLACEMENTS: Replacement[] = ['move', 'attackMove', 'stop', 'hold'];

const START = { x: 10, z: 20 };
const OLD_TARGET = { x: 16, z: 20 };
const REPLACE_TARGET = { x: 10, z: 22 };
const QUEUED_MOVE_TARGET = { x: 10, z: 28 };

const cases: Array<[QueuedKind, Replacement]> = [];
for (const q of QUEUED_KINDS) {
  for (const r of REPLACEMENTS) cases.push([q, r]);
}

describe('M7 nonqueued commands discard the old Shift queue', () => {
  it.each(cases)(
    'queued %s is never resumed after nonqueued %s replaces an active move',
    (queuedKind, replacement) => {
      const sim = new Sim(makeCleanMap(48), 1);
      const world = sim.world;
      const unit = world.spawnUnit(0, 'peasant', START.x, START.z, 'crown');
      // Placed close enough that resuming the old queue would reach it quickly,
      // but outside the 6-tile line of sight from every position the unit can hold.
      const farm = world.spawnBuilding(0, 'farm', 13, 24, true);
      const enemy = world.spawnUnit(1, 'ox_cart', 10, 30, 'crown');
      const enemyHp = enemy.hp;
      const foodBefore = world.players[0].foodCollected;

      sim.issue({
        kind: 'move',
        player: 0,
        ids: [unit.id],
        x: OLD_TARGET.x,
        z: OLD_TARGET.z,
      });
      for (let t = 0; t < 10; t++) sim.step();
      expect(unit.order?.kind).toBe('move');
      expect(unit.x).toBeGreaterThan(START.x);

      let queuedCmd: Command;
      if (queuedKind === 'move') {
        queuedCmd = {
          kind: 'move',
          player: 0,
          ids: [unit.id],
          x: QUEUED_MOVE_TARGET.x,
          z: QUEUED_MOVE_TARGET.z,
          queued: true,
        };
      } else if (queuedKind === 'farm') {
        queuedCmd = {
          kind: 'farm',
          player: 0,
          ids: [unit.id],
          targetId: farm.id,
          queued: true,
        };
      } else {
        queuedCmd = {
          kind: 'attack',
          player: 0,
          ids: [unit.id],
          targetId: enemy.id,
          queued: true,
        };
      }
      sim.issue(queuedCmd);
      sim.step();
      expect(unit.orders).toHaveLength(1);
      expect(unit.orders[0].kind).toBe(queuedKind);
      expect(unit.order?.kind).toBe('move');

      let replacementCmd: Command;
      if (replacement === 'move' || replacement === 'attackMove') {
        replacementCmd = {
          kind: replacement,
          player: 0,
          ids: [unit.id],
          x: REPLACE_TARGET.x,
          z: REPLACE_TARGET.z,
        };
      } else {
        replacementCmd = { kind: replacement, player: 0, ids: [unit.id] };
      }
      sim.issue(replacementCmd);
      sim.step();
      expect(unit.orders).toHaveLength(0);
      expect(unit.order?.kind).toBe(replacement);

      sim.step();
      const stoppedX = unit.x;
      const stoppedZ = unit.z;
      expect(unit.orders).toHaveLength(0);

      for (let t = 0; t < 400; t++) {
        sim.step();
        // The old queue must never be reinstated at any point.
        expect(unit.orders).toHaveLength(0);
        expect(unit.order?.kind).not.toBe('farm');
        expect(unit.order?.kind).not.toBe('attack');
      }

      if (replacement === 'move' || replacement === 'attackMove') {
        // Replacement completed and the unit went idle at the replacement point,
        // not at the old move target nor at the queued destination.
        expect(unit.order?.kind).toBe('idle');
        expect(
          Math.hypot(unit.x - REPLACE_TARGET.x, unit.z - REPLACE_TARGET.z),
        ).toBeLessThan(0.5);
      } else {
        // Stop/hold freeze the unit where it was; it never reaches the old target.
        expect(unit.order?.kind).toBe(replacement);
        expect(Math.hypot(unit.x - stoppedX, unit.z - stoppedZ)).toBeLessThan(
          0.01,
        );
        expect(unit.x).toBeLessThan(OLD_TARGET.x - 2);
      }

      // Queued work/attack outcomes never happened.
      expect(unit.combat).toBeUndefined();
      expect(unit.workAnimation).toBeUndefined();
      expect(world.players[0].foodCollected).toBe(foodBefore);
      expect(enemy.hp).toBe(enemyHp);
      expect(unit.z).toBeLessThan(QUEUED_MOVE_TARGET.z - 2);
    },
  );
});
