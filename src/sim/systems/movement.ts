import { getTerrainSpeedMultiplier } from '../../data/terrain.js';
import type { Grid } from '../grid.js';
import type { UnitEntity } from '../entity.js';
import type { World } from '../world.js';
import { SIM_DT } from '../sim.js';

export interface FormationSlot {
  x: number;
  z: number;
}

export function computeFacing(vx: number, vz: number): number {
  const sx = 48 * (vx - vz);
  const sy = 24 * (vx + vz);
  let angle = Math.atan2(-sx, sy);
  if (angle < 0) {
    angle += 2 * Math.PI;
  }
  return Math.round(((angle * 180) / Math.PI) / 45) % 8;
}

export function clampUnitRadius(
  unit: { x: number; z: number; radius: number; player: number },
  grid: Grid,
): void {
  const r = unit.radius;
  const size = grid.size;

  if (unit.x < r) unit.x = r;
  else if (unit.x > size - r) unit.x = size - r;
  if (unit.z < r) unit.z = r;
  else if (unit.z > size - r) unit.z = size - r;

  const minTx = Math.max(0, Math.floor(unit.x - r));
  const maxTx = Math.min(size - 1, Math.floor(unit.x + r));
  const minTz = Math.max(0, Math.floor(unit.z - r));
  const maxTz = Math.min(size - 1, Math.floor(unit.z + r));
  const flags = grid.flags;
  const rSq = r * r;

  for (let tz = minTz; tz <= maxTz; tz++) {
    const rowOffset = tz * size;
    for (let tx = minTx; tx <= maxTx; tx++) {
      const idx = rowOffset + tx;
      if (flags[idx] === 0) continue;

      if (!grid.isPassable(tx, tz, unit.player)) {
        const cx = Math.max(tx, Math.min(unit.x, tx + 1));
        const cz = Math.max(tz, Math.min(unit.z, tz + 1));
        const dx = unit.x - cx;
        const dz = unit.z - cz;
        const distSq = dx * dx + dz * dz;
        if (distSq < rSq) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-6) {
            const pen = r - dist;
            unit.x += (dx / dist) * pen;
            unit.z += (dz / dist) * pen;
          } else {
            const dLeft = unit.x - tx;
            const dRight = tx + 1 - unit.x;
            const dTop = unit.z - tz;
            const dBottom = tz + 1 - unit.z;
            const minD = Math.min(dLeft, dRight, dTop, dBottom);
            if (minD === dLeft) {
              unit.x = tx - r;
            } else if (minD === dRight) {
              unit.x = tx + 1 + r;
            } else if (minD === dTop) {
              unit.z = tz - r;
            } else {
              unit.z = tz + 1 + r;
            }
          }
        }
      }
    }
  }

  unit.x = Math.max(r, Math.min(size - r, unit.x));
  unit.z = Math.max(r, Math.min(size - r, unit.z));
}

export function assignFormationSlots(
  units: UnitEntity[],
  targetX: number,
  targetZ: number,
  grid: Grid,
  player: number,
): FormationSlot[] {
  const count = units.length;
  if (count === 0) return [];
  if (count === 1) return [{ x: targetX, z: targetZ }];

  let sumX = 0;
  let sumZ = 0;
  for (let i = 0; i < count; i++) {
    sumX += units[i].x;
    sumZ += units[i].z;
  }
  const centroidX = sumX / count;
  const centroidZ = sumZ / count;

  const dx = targetX - centroidX;
  const dz = targetZ - centroidZ;
  const dist = Math.hypot(dx, dz);
  let fx = 0;
  let fz = 1;
  if (dist > 1e-4) {
    fx = dx / dist;
    fz = dz / dist;
  }
  const rx = -fz;
  const rz = fx;

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacing = 0.6;

  const rawSlots: FormationSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const rowUnits = r === rows - 1 && count % cols !== 0 ? count % cols : cols;
    const rowOffset = ((rows - 1) / 2 - r) * spacing;
    for (let c = 0; c < rowUnits; c++) {
      const colOffset = (c - (rowUnits - 1) / 2) * spacing;
      let sx = targetX + colOffset * rx + rowOffset * fx;
      let sz = targetZ + colOffset * rz + rowOffset * fz;

      const slotPoint = { x: sx, z: sz, radius: 0.2, player };
      clampUnitRadius(slotPoint, grid);
      sx = slotPoint.x;
      sz = slotPoint.z;
      if (!grid.canOccupy(sx, sz, 0.2, player)) {
        const baseTx = Math.floor(sx);
        const baseTz = Math.floor(sz);
        let found = false;
        for (let rad = 1; rad <= 3 && !found; rad++) {
          for (let dtz = -rad; dtz <= rad && !found; dtz++) {
            for (let dtx = -rad; dtx <= rad && !found; dtx++) {
              const candX = baseTx + dtx + 0.5;
              const candZ = baseTz + dtz + 0.5;
              if (grid.canOccupy(candX, candZ, 0.2, player)) {
                sx = candX;
                sz = candZ;
                found = true;
              }
            }
          }
        }
      }
      rawSlots.push({ x: sx, z: sz });
    }
  }

  const assignedSlots: FormationSlot[] = new Array(count);
  const slotUsed = new Uint8Array(count);
  const unitAssigned = new Uint8Array(count);

  for (let step = 0; step < count; step++) {
    let bestDist = Infinity;
    let bestU = -1;
    let bestS = -1;

    for (let u = 0; u < count; u++) {
      if (unitAssigned[u]) continue;
      const ux = units[u].x;
      const uz = units[u].z;
      for (let s = 0; s < count; s++) {
        if (slotUsed[s]) continue;
        const d = Math.hypot(ux - rawSlots[s].x, uz - rawSlots[s].z);
        if (d < bestDist) {
          bestDist = d;
          bestU = u;
          bestS = s;
        }
      }
    }

    if (bestU !== -1 && bestS !== -1) {
      unitAssigned[bestU] = 1;
      slotUsed[bestS] = 1;
      assignedSlots[bestU] = rawSlots[bestS];
    }
  }

  return assignedSlots;
}

export function advanceUnitOrder(world: World, unit: UnitEntity): void {
  unit.path = undefined;
  unit.pathTarget = undefined;
  unit.pathPending = false;
  unit.formationSlotX = undefined;
  unit.formationSlotZ = undefined;
  unit.stuckTicks = 0;
  unit.stuckProgressX = unit.x;
  unit.stuckProgressZ = unit.z;
  unit.stuckLastCheckTick = world.tick;

  while (unit.orders.length > 0) {
    const nextOrder = unit.orders.shift()!;
    unit.order = nextOrder;
    unit.orderGeneration++;

    if (nextOrder.kind === 'stop' || nextOrder.kind === 'hold') {
      if (unit.orders.length > 0) {
        continue;
      } else {
        return;
      }
    }

    if (
      (nextOrder.kind === 'move' || nextOrder.kind === 'attackMove') &&
      nextOrder.x !== undefined &&
      nextOrder.z !== undefined
    ) {
      world.pathQueue.request(
        unit.id,
        unit.x,
        unit.z,
        nextOrder.x,
        nextOrder.z,
        unit.player,
      );
      unit.pathPending = true;
      return;
    }
  }

  unit.order = { kind: 'idle' };
}

const activeUnitsBuffer: UnitEntity[] = [];

export function updateMovement(world: World): void {
  // 1. Process path results
  const pathResults = world.pathQueue.process(25000);
  for (const res of pathResults) {
    const ent = world.entities[res.id];
    if (ent && ent.kind === 'unit' && ent.pathPending) {
      ent.pathPending = false;
      ent.path = [...res.path];
      ent.pathTarget = { ...res.target };
      if (ent.formationSlotX !== undefined && ent.formationSlotZ !== undefined) {
        ent.formationSlotX = res.target.x;
        ent.formationSlotZ = res.target.z;
      }
    }
  }

  // 2. Populate spatial hash with all active units
  world.spatialHash.clear();
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (ent && ent.kind === 'unit') {
      world.spatialHash.insert(ent.id, ent.x, ent.z);
    }
  }

  activeUnitsBuffer.length = 0;

  // 3. Movement steering & integration
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (!ent || ent.kind !== 'unit') continue;

    activeUnitsBuffer.push(ent);

    ent.previousX = ent.x;
    ent.previousZ = ent.z;

    if (
      !ent.order ||
      (ent.order.kind !== 'move' && ent.order.kind !== 'attackMove')
    ) {
      continue;
    }

    // Terrain slowdown check
    const tx = Math.max(0, Math.min(world.map.size - 1, Math.floor(ent.x)));
    const tz = Math.max(0, Math.min(world.map.size - 1, Math.floor(ent.z)));
    const tileCode = world.map.tiles[tz * world.map.size + tx];
    const baseSpeed =
      ent.loaded && ent.loadedSpeed !== undefined
        ? ent.loadedSpeed
        : ent.baseSpeed;
    const currentSpeed = baseSpeed * getTerrainSpeedMultiplier(tileCode);
    ent.speed = currentSpeed;

    const targetDestX = ent.pathTarget?.x ?? ent.formationSlotX ?? ent.order.x;
    const targetDestZ = ent.pathTarget?.z ?? ent.formationSlotZ ?? ent.order.z;

    if (targetDestX === undefined || targetDestZ === undefined) {
      ent.order = { kind: 'idle' };
      continue;
    }
    if (ent.pathPending && (!ent.path || ent.path.length === 0)) {
      continue;
    }


    const distToFinal = Math.hypot(targetDestX - ent.x, targetDestZ - ent.z);

    // Final destination arrival
    if (distToFinal <= 0.05) {
      ent.x = targetDestX;
      ent.z = targetDestZ;
      advanceUnitOrder(world, ent);
      continue;
    }

    // Waypoint steering
    let targetX = targetDestX;
    let targetZ = targetDestZ;

    if (ent.path && ent.path.length > 0) {
      const wp = ent.path[0];
      const distToWp = Math.hypot(wp.x - ent.x, wp.z - ent.z);

      if (ent.path.length > 1) {
        if (distToWp < Math.max(0.2, ent.radius)) {
          ent.path.shift();
          if (ent.path.length > 0) {
            targetX = ent.path[0].x;
            targetZ = ent.path[0].z;
          }
        } else {
          targetX = wp.x;
          targetZ = wp.z;
        }
      } else {
        targetX = wp.x;
        targetZ = wp.z;
      }
    }

    const toWpX = targetX - ent.x;
    const toWpZ = targetZ - ent.z;
    const wpDist = Math.hypot(toWpX, toWpZ);

    let seekVx = 0;
    let seekVz = 0;
    if (wpDist > 1e-4) {
      seekVx = (toWpX / wpDist) * currentSpeed;
      seekVz = (toWpZ / wpDist) * currentSpeed;

      // Shallow slowdown near final destination
      if (distToFinal < 0.6) {
        const ramp = Math.max(0.2, distToFinal / 0.6);
        seekVx *= ramp;
        seekVz *= ramp;
      }
    }

    // Separation steering
    const queryRadius = ent.radius * 2 + 0.5;
    const neighbors = world.spatialHash.queryNearby(ent.x, ent.z, queryRadius);
    let sepVx = 0;
    let sepVz = 0;

    for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
      const otherId = neighbors[nIdx];
      if (otherId === ent.id) continue;
      const other = world.entities[otherId];
      if (!other || other.kind !== 'unit') continue;

      const odx = ent.x - other.x;
      const odz = ent.z - other.z;
      const odist = Math.hypot(odx, odz);
      const minDist = ent.radius + other.radius + 0.08;

      if (odist < minDist) {
        if (odist > 1e-4) {
          const force = ((minDist - odist) / minDist) * currentSpeed * 1.2;
          sepVx += (odx / odist) * force;
          sepVz += (odz / odist) * force;
        } else {
          const pushAngle = (((ent.id * 47) % 360) * Math.PI) / 180;
          sepVx += Math.cos(pushAngle) * currentSpeed;
          sepVz += Math.sin(pushAngle) * currentSpeed;
        }
      }
    }

    let vx = seekVx + sepVx;
    let vz = seekVz + sepVz;
    const vMag = Math.hypot(vx, vz);
    if (vMag > currentSpeed) {
      vx = (vx / vMag) * currentSpeed;
      vz = (vz / vMag) * currentSpeed;
    }

    if (vMag > 1e-3) {
      ent.facing = computeFacing(vx, vz);
    }

    ent.x += vx * SIM_DT;
    ent.z += vz * SIM_DT;

    clampUnitRadius(ent, world.grid);
  }

  // 4. Overlap relaxation pass to ensure overlap <= 0.1
  for (let i = 0; i < activeUnitsBuffer.length; i++) {
    const u1 = activeUnitsBuffer[i];
    const neighbors = world.spatialHash.queryNearby(
      u1.x,
      u1.z,
      u1.radius * 2 + 0.15,
    );
    let u1Moved = false;

    for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
      const oId = neighbors[nIdx];
      if (oId <= u1.id) continue;
      const u2 = world.entities[oId];
      if (!u2 || u2.kind !== 'unit') continue;

      const dx = u1.x - u2.x;
      const dz = u1.z - u2.z;
      const dist = Math.hypot(dx, dz);
      const minDist = u1.radius + u2.radius;
      const overlap = minDist - dist;

      if (overlap > 0.005) {
        let pushX: number;
        let pushZ: number;
        if (dist > 1e-4) {
          pushX = (dx / dist) * overlap * 0.5;
          pushZ = (dz / dist) * overlap * 0.5;
        } else {
          const angle = (((u1.id * 31) % 360) * Math.PI) / 180;
          pushX = Math.cos(angle) * overlap * 0.5;
          pushZ = Math.sin(angle) * overlap * 0.5;
        }

        u1.x += pushX;
        u1.z += pushZ;
        u2.x -= pushX;
        u2.z -= pushZ;
        u1Moved = true;
        clampUnitRadius(u2, world.grid);
      }
    }
    if (u1Moved) {
      clampUnitRadius(u1, world.grid);
    }
  }

  // 5. Stuck detection (progress < 0.1 in 2 s = 40 ticks)
  for (let i = 0; i < activeUnitsBuffer.length; i++) {
    const ent = activeUnitsBuffer[i];
    if (
      !ent.order ||
      (ent.order.kind !== 'move' && ent.order.kind !== 'attackMove')
    ) {
      ent.stuckTicks = 0;
      ent.stuckProgressX = ent.x;
      ent.stuckProgressZ = ent.z;
      ent.stuckLastCheckTick = world.tick;
      continue;
    }

    if (world.tick - ent.stuckLastCheckTick >= 40) {
      const moved = Math.hypot(
        ent.x - ent.stuckProgressX,
        ent.z - ent.stuckProgressZ,
      );
      const targetDestX =
        ent.pathTarget?.x ?? ent.formationSlotX ?? ent.order.x;
      const targetDestZ =
        ent.pathTarget?.z ?? ent.formationSlotZ ?? ent.order.z;

      if (moved >= 0.1) {
        ent.stuckTicks = 0;
      } else {
        if (targetDestX !== undefined && targetDestZ !== undefined) {
          const distToTarget = Math.hypot(
            targetDestX - ent.x,
            targetDestZ - ent.z,
          );
          if (distToTarget <= 0.25) {
            ent.x = targetDestX;
            ent.z = targetDestZ;
            advanceUnitOrder(world, ent);
            continue;
          }
        }

        ent.stuckTicks += 40;
        if (ent.stuckTicks >= 120) {
          advanceUnitOrder(world, ent);
          continue;
        } else if (targetDestX !== undefined && targetDestZ !== undefined) {
          world.pathQueue.request(
            ent.id,
            ent.x,
            ent.z,
            targetDestX,
            targetDestZ,
            ent.player,
          );
          ent.pathPending = true;
        }
      }

      ent.stuckProgressX = ent.x;
      ent.stuckProgressZ = ent.z;
      ent.stuckLastCheckTick = world.tick;
    }
  }
}
