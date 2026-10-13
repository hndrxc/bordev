import type { BuildingEntity } from '../entity.js';
import type { World } from '../world.js';
import { SIM_DT } from '../sim.js';
import { CROWN_BUILDINGS } from '../../data/buildings.js';

let ticksPerSecond = 0;

// Preallocated scratch buffer to prevent per-tick garbage collection
const activeChapelsScratch: BuildingEntity[] = [];
/**
 * Updates player auras across the simulation world.
 *
 * Sanctuary (Crown Faction Ability):
 * Each completed Crown Chapel heals own living, non-siege units within 5 tiles
 * of its footprint by 1 HP/s (exact integer healing once per second).
 */
export function updateAuras(world: World): void {
  if (ticksPerSecond === 0) {
    ticksPerSecond = Math.round(1 / SIM_DT);
  }
  if (world.tick % ticksPerSecond !== 0) {
    return;
  }

  try {
    activeChapelsScratch.length = 0;

    // 1. Collect all completed, living Crown Chapels
    for (let i = 0; i < world.entities.length; i++) {
      const ent = world.entities[i];
      if (
        ent &&
        ent.kind === 'building' &&
        ent.type === 'chapel' &&
        ent.faction === 'crown' &&
        ent.built &&
        ent.hp > 0 &&
        ent.deathTick === undefined
      ) {
        activeChapelsScratch.push(ent);
      }
    }

    // Fast exit if no active chapels exist in the world
    if (activeChapelsScratch.length === 0) {
      return;
    }

    const aura = CROWN_BUILDINGS.chapel.aura;
    const auraRadiusSq = aura.radius * aura.radius + 1e-6;

    // 2. Scan living units and heal eligible candidates
    for (let i = 0; i < world.entities.length; i++) {
      const ent = world.entities[i];
      if (
        !ent ||
        ent.kind !== 'unit' ||
        ent.hp <= 0 ||
        ent.deathTick !== undefined ||
        ent.hp >= ent.maxHp
      ) {
        continue;
      }

      const unit = ent;

      // Siege units cannot be healed by Sanctuary
      if (unit.tags.includes('siege')) {
        continue;
      }

      // Count completed friendly chapels in range
      let chapelsInRange = 0;
      for (let c = 0; c < activeChapelsScratch.length; c++) {
        const chapel = activeChapelsScratch[c];
        if (unit.player !== chapel.player) {
          continue;
        }

        // Distance to building footprint
        const dx = Math.max(
          0,
          chapel.x - unit.x,
          unit.x - (chapel.x + chapel.width),
        );
        const dz = Math.max(
          0,
          chapel.z - unit.z,
          unit.z - (chapel.z + chapel.height),
        );
        const distSq = dx * dx + dz * dz;

        if (distSq <= auraRadiusSq) {
          chapelsInRange++;
        }
      }

      if (chapelsInRange > 0) {
        unit.hp = Math.min(unit.maxHp, unit.hp + chapelsInRange);
      }
    }
  } finally {
    activeChapelsScratch.length = 0;
  }
}
