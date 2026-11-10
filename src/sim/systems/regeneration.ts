import type { World } from '../world.js';

/** Ticks per second at the fixed simulation step (SIM_DT 0.05). */
const TICKS_PER_SECOND = 20;

/**
 * Passive unit regeneration (Berserker).
 *
 * Runs once per second and moves whole HP from fractional progress into
 * `hp`, so HP stays an integer. Progress does not bank while a unit is at
 * full health, and only live units regenerate.
 */
export function updateRegeneration(world: World): void {
  if (world.tick % TICKS_PER_SECOND !== 0) {
    return;
  }

  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      !ent ||
      ent.kind !== 'unit' ||
      ent.hp <= 0 ||
      ent.deathTick !== undefined
    ) {
      continue;
    }

    const regen = ent.regenHpPerSec;
    if (!regen || regen <= 0) {
      continue;
    }

    if (ent.hp >= ent.maxHp) {
      ent.regenProgress = 0;
      continue;
    }

    const progress = (ent.regenProgress ?? 0) + regen;
    const whole = Math.floor(progress);
    const healed = Math.min(whole, ent.maxHp - ent.hp);
    ent.hp += healed;
    ent.regenProgress = progress - healed;
  }
}
