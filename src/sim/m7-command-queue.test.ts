import { describe, expect, it } from 'vitest';
import type { Command } from './commands.js';
import type { UnitEntity } from './entity.js';
import { makeOpenSim } from './testFixtures.js';

type QueuedKind = 'move' | 'farm' | 'attack';
type Replacement = 'move' | 'attackMove' | 'stop' | 'hold' | 'attack';

const QUEUED_KINDS: QueuedKind[] = ['move', 'farm', 'attack'];
const REPLACEMENTS: Replacement[] = [
  'move',
  'attackMove',
  'stop',
  'hold',
  'attack',
];

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
      const sim = makeOpenSim({ size: 48, seed: 1 });
      const world = sim.world;
      const unit = world.spawnUnit(0, 'peasant', START.x, START.z, 'crown');
      // Placed close enough that resuming the old queue would reach it quickly,
      // but outside the 6-tile line of sight from every position the unit can hold.
      const farm = world.spawnBuilding(0, 'farm', 13, 24, true);
      const enemy = world.spawnUnit(1, 'ox_cart', 10, 30, 'crown');
      const enemyHp = enemy.hp;
      const foodBefore = world.players[0].foodCollected;

      let replacementEnemy: UnitEntity | undefined;
      if (replacement === 'attack') {
        replacementEnemy = world.spawnUnit(
          1,
          'ox_cart',
          REPLACE_TARGET.x,
          REPLACE_TARGET.z,
          'crown',
        );
        replacementEnemy.hp = 6; // 2 peasant hits
      }

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
      } else if (replacement === 'attack') {
        if (!replacementEnemy) {
          throw new Error('Missing replacement enemy for attack order');
        }
        replacementCmd = {
          kind: 'attack',
          player: 0,
          ids: [unit.id],
          targetId: replacementEnemy.id,
        };
      } else {
        replacementCmd = { kind: replacement, player: 0, ids: [unit.id] };
      }
      sim.issue(replacementCmd);
      sim.step();
      expect(unit.order?.kind).toBe(replacement);

      sim.step();
      const stoppedX = unit.x;
      const stoppedZ = unit.z;

      for (let t = 0; t < 400; t++) {
        sim.step();
        // The old queued order kinds must never be resumed.
        expect(unit.order?.kind).not.toBe('farm');
      }

      if (replacement === 'move' || replacement === 'attackMove') {
        // Replacement completed and the unit went idle at the replacement point,
        // not at the old move target nor at the queued destination.
        expect(unit.order?.kind).toBe('idle');
        expect(
          Math.hypot(unit.x - REPLACE_TARGET.x, unit.z - REPLACE_TARGET.z),
        ).toBeLessThan(0.5);
      } else if (replacement === 'attack' && replacementEnemy) {
        expect(replacementEnemy.hp).toBe(0);
        expect(unit.order?.kind).toBe('idle');
      } else {
        // Stop/hold freeze the unit where it was; it never reaches the old target.
        expect(unit.order?.kind).toBe(replacement);
        expect(Math.hypot(unit.x - stoppedX, unit.z - stoppedZ)).toBeLessThan(
          0.01,
        );
        expect(unit.x).toBeLessThan(OLD_TARGET.x - 2);
      }

      // Queued work/attack outcomes never happened.
      expect(world.players[0].foodCollected).toBe(foodBefore);
      expect(enemy.hp).toBe(enemyHp);
      expect(unit.z).toBeLessThan(QUEUED_MOVE_TARGET.z - 2);
    },
  );
});
