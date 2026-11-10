import { getBuildingData } from '../../data/buildings.js';
import type { World } from '../world.js';

/**
 * Updates visual `gateOpen` state for living gates when living owner/allied units
 * are within 1 tile of the footprint.
 */
export function updateGates(world: World): void {
  const entities = world.entities;
  const grid = world.grid;

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent || ent.kind !== 'building' || ent.hp <= 0) {
      continue;
    }
    const isGate = ent.isGate === true || getBuildingData(ent.type)?.isGate === true;
    if (!isGate) {
      continue;
    }

    if (!ent.built) {
      ent.gateOpen = false;
      continue;
    }

    let hasNearbyFriendly = false;
    const centerX = ent.x + ent.width * 0.5;
    const centerZ = ent.z + ent.height * 0.5;
    const queryRadius = Math.max(ent.width, ent.height) + 1.0;
    const nearby = world.spatialHash.queryNearby(centerX, centerZ, queryRadius);

    for (let j = 0; j < nearby.length; j++) {
      const other = entities[nearby[j]];
      if (!other || other.kind !== 'unit' || other.hp <= 0) {
        continue;
      }

      if (!grid.isAlly(ent.player, other.player)) {
        continue;
      }

      const dx = Math.max(0, ent.x - other.x, other.x - (ent.x + ent.width));
      const dz = Math.max(0, ent.z - other.z, other.z - (ent.z + ent.height));
      if (dx <= 1.0 + 1e-4 && dz <= 1.0 + 1e-4) {
        hasNearbyFriendly = true;
        break;
      }
    }

    ent.gateOpen = hasNearbyFriendly;
  }
}
