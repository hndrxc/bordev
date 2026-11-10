import type { BuildingEntity } from '../entity.js';
import { FLAG_BUILDING } from '../grid.js';
import type { World } from '../world.js';
import { validatePlacement } from '../systems/construction.js';

export function findBuildSite(
  world: World,
  player: number,
  buildingType: string,
  anchorX: number,
  anchorZ: number,
  minRadius: number,
  maxRadius: number,
): { x: number; z: number } | null {
  const ax = Math.floor(anchorX);
  const az = Math.floor(anchorZ);
  for (let radius = minRadius; radius <= maxRadius; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = ax + dx;
        const z = az + dz;
        const placement = validatePlacement(world, player, buildingType, x, z);
        if (
          placement.valid &&
          hasBuildingMargin(world, x, z, placement.width, placement.height)
        ) {
          return { x, z };
        }
      }
    }
  }
  return null;
}

function hasBuildingMargin(
  world: World,
  x: number,
  z: number,
  width: number,
  height: number,
): boolean {
  const size = world.grid.size;
  const minX = Math.max(0, x - 1);
  const maxX = Math.min(size, x + width + 1);
  const minZ = Math.max(0, z - 1);
  const maxZ = Math.min(size, z + height + 1);
  for (let tz = minZ; tz < maxZ; tz++) {
    for (let tx = minX; tx < maxX; tx++) {
      if ((world.grid.flags[tz * size + tx] & FLAG_BUILDING) !== 0)
        return false;
    }
  }
  return true;
}

export function getGatherPoint(
  world: World,
  player: number,
  townCenter: BuildingEntity | null,
): { x: number; z: number } {
  const mapCenter = world.map.size / 2;
  let x = townCenter ? townCenter.x + townCenter.width / 2 : mapCenter;
  let z = townCenter ? townCenter.z + townCenter.height / 2 : mapCenter;
  const dx = mapCenter - x;
  const dz = mapCenter - z;
  const distance = Math.hypot(dx, dz);
  if (distance > 0) {
    x += (dx / distance) * 7;
    z += (dz / distance) * 7;
  }

  const ax = Math.floor(x);
  const az = Math.floor(z);
  if (world.grid.isPassable(ax, az, player))
    return { x: ax + 0.5, z: az + 0.5 };

  let bestX = x;
  let bestZ = z;
  let bestDistanceSq = Infinity;
  for (let radius = 1; radius <= 6; radius++) {
    for (let offsetZ = -radius; offsetZ <= radius; offsetZ++) {
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetZ)) !== radius) continue;
        const tx = ax + offsetX;
        const tz = az + offsetZ;
        if (!world.grid.isPassable(tx, tz, player)) continue;
        const cx = tx + 0.5;
        const cz = tz + 0.5;
        const distanceSq = (cx - x) ** 2 + (cz - z) ** 2;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestX = cx;
          bestZ = cz;
        }
      }
    }
  }
  return { x: bestX, z: bestZ };
}
