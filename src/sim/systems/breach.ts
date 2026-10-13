import type { BuildingEntity, Combatant, UnitEntity } from '../entity.js';
import { FLAG_TERRAIN } from '../grid.js';
import { findStartComponent } from '../path/components.js';
import { distanceToCombatant, isRangedAttacker } from './reach.js';
import { MELEE_REACH_BUFFER } from '../../data/combat.js';
import { getBuildingData } from '../../data/buildings.js';
import type { World } from '../world.js';

const DIRS_4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const WALL_COST = 100_000;

interface EngageCacheEntry {
  goalId: number;
  goalTx: number;
  goalTz: number;
  attackerComp: number;
  revision: number;
  result: boolean;
}

const engageCache = new WeakMap<UnitEntity, EngageCacheEntry>();

function isInLegalRange(attacker: UnitEntity, goal: Combatant): boolean {
  const dist = distanceToCombatant(attacker.x, attacker.z, goal);
  if (isRangedAttacker(attacker)) {
    const range = attacker.range ?? 5;
    const minRange = attacker.minRange ?? 0;
    return dist <= range && dist >= minRange;
  }
  const reach = attacker.radius + (goal.kind === 'unit' ? goal.radius : 0) + MELEE_REACH_BUFFER;
  return dist <= reach;
}

/**
 * Can `attacker` hit `goal` without breaching: in legal range now, or a legal
 * attack position lies in the attacker's reachable area.
 * - Melee unit goal: the goal tile or one of its 4 edge-adjacent tiles is in
 *   the attacker's area (diagonal-only contact does NOT count).
 * - Melee building goal: an edge-adjacent tile around the footprint (corners
 *   excluded).
 * - Ranged (isRangedAttacker): a tile whose centre is within [minRange, range]
 *   of the goal lies in the attacker's area.
 * Amortized O(1): cached per attacker by goal tile + grid.revision.
 */
export function canEngage(world: World, attacker: UnitEntity, goal: Combatant): boolean {
  if (attacker.hp <= 0 || goal.hp <= 0) {
    return false;
  }

  if (isInLegalRange(attacker, goal)) {
    return true;
  }

  const grid = world.grid;
  const size = grid.size;
  const player = attacker.player;
  const labels = world.pathQueue.getComponentLabels(player);

  const startTx = Math.max(0, Math.min(size - 1, Math.floor(attacker.x)));
  const startTz = Math.max(0, Math.min(size - 1, Math.floor(attacker.z)));
  let attackerComp = labels[startTz * size + startTx];
  if (attackerComp === 0) {
    const start = findStartComponent(grid, labels, attacker.x, attacker.z, player);
    attackerComp = start.compId;
  }
  if (attackerComp === 0) {
    return false;
  }

  const goalTx = Math.max(0, Math.min(size - 1, Math.floor(goal.x)));
  const goalTz = Math.max(0, Math.min(size - 1, Math.floor(goal.z)));

  const cached = engageCache.get(attacker);
  if (
    cached &&
    cached.goalId === goal.id &&
    cached.goalTx === goalTx &&
    cached.goalTz === goalTz &&
    cached.attackerComp === attackerComp &&
    cached.revision === grid.revision
  ) {
    return cached.result;
  }

  let result = false;

  if (isRangedAttacker(attacker)) {
    const range = attacker.range ?? 5;
    const minRange = attacker.minRange ?? 0;
    const bx0 = goal.x;
    const bz0 = goal.z;
    const bx1 = goal.kind === 'unit' ? goal.x : goal.x + goal.width;
    const bz1 = goal.kind === 'unit' ? goal.z : goal.z + goal.height;
    const x0 = Math.max(0, Math.floor(bx0 - range));
    const x1 = Math.min(size - 1, Math.floor(bx1 + range));
    const z0 = Math.max(0, Math.floor(bz0 - range));
    const z1 = Math.min(size - 1, Math.floor(bz1 + range));

    for (let tz = z0; tz <= z1; tz++) {
      const rowOffset = tz * size;
      for (let tx = x0; tx <= x1; tx++) {
        if (labels[rowOffset + tx] === attackerComp) {
          const dist = distanceToCombatant(tx + 0.5, tz + 0.5, goal);
          if (dist <= range && dist >= minRange) {
            result = true;
            break;
          }
        }
      }
      if (result) break;
    }
  } else if (goal.kind === 'unit') {
    if (labels[goalTz * size + goalTx] === attackerComp) {
      result = true;
    } else {
      for (let d = 0; d < 4; d++) {
        const nx = goalTx + DIRS_4[d][0];
        const nz = goalTz + DIRS_4[d][1];
        if (nx >= 0 && nx < size && nz >= 0 && nz < size) {
          if (labels[nz * size + nx] === attackerComp) {
            result = true;
            break;
          }
        }
      }
    }
  } else {
    const bx = goal.x;
    const bz = goal.z;
    const bw = goal.width;
    const bh = goal.height;

    // Top and bottom edges (corners excluded)
    for (let x = bx; x < bx + bw; x++) {
      if (x < 0 || x >= size) continue;
      const zTop = bz - 1;
      if (zTop >= 0 && zTop < size && labels[zTop * size + x] === attackerComp) {
        result = true;
        break;
      }
      const zBottom = bz + bh;
      if (zBottom >= 0 && zBottom < size && labels[zBottom * size + x] === attackerComp) {
        result = true;
        break;
      }
    }

    // Left and right edges (corners excluded)
    if (!result) {
      for (let z = bz; z < bz + bh; z++) {
        if (z < 0 || z >= size) continue;
        const xLeft = bx - 1;
        if (xLeft >= 0 && xLeft < size && labels[z * size + xLeft] === attackerComp) {
          result = true;
          break;
        }
        const xRight = bx + bw;
        if (xRight >= 0 && xRight < size && labels[z * size + xRight] === attackerComp) {
          result = true;
          break;
        }
      }
    }
  }

  engageCache.set(attacker, {
    goalId: goal.id,
    goalTx,
    goalTz,
    attackerComp,
    revision: grid.revision,
    result,
  });

  return result;
}

interface BreachState {
  targetGoal: Combatant;
  breachWall: BuildingEntity;
  revision: number;
}

const breachCache = new WeakMap<UnitEntity, BreachState>();

interface BreachScratch {
  size: number;
  wallRevision: number;
  wallAt: Int32Array;
  stamp: number;
  seen: Uint32Array;
  dist: Int32Array;
  parent: Int32Array;
  heap: Int32Array;
  heapDist: Int32Array;
  heapSize: number;
  noRouteRevision: number;
  noRouteKeys: Set<number>;
}

const breachScratches = new WeakMap<World, BreachScratch>();

function getBreachScratch(world: World): BreachScratch {
  const size = world.grid.size;
  let s = breachScratches.get(world);
  if (!s || s.size !== size) {
    const total = size * size;
    s = {
      size,
      wallRevision: -1,
      wallAt: new Int32Array(total),
      stamp: 0,
      seen: new Uint32Array(total),
      dist: new Int32Array(total),
      parent: new Int32Array(total),
      heap: new Int32Array(total * 4),
      heapDist: new Int32Array(total * 4),
      heapSize: 0,
      noRouteRevision: -1,
      noRouteKeys: new Set<number>(),
    };
    breachScratches.set(world, s);
  }

  if (s.noRouteRevision !== world.grid.revision) {
    s.noRouteKeys.clear();
    s.noRouteRevision = world.grid.revision;
  }

  if (s.wallRevision !== world.grid.revision) {
    s.wallAt.fill(-1);
    const entities = world.entities;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || ent.kind !== 'building' || ent.hp <= 0) {
        continue;
      }
      const bData = getBuildingData(ent.type);
      const isWall = bData?.isWall === true;
      const isGate = bData?.isGate === true || ent.isGate === true;
      if (!isWall && !isGate) {
        continue;
      }
      for (
        let tz = Math.max(0, ent.z);
        tz < Math.min(size, ent.z + ent.height);
        tz++
      ) {
        for (
          let tx = Math.max(0, ent.x);
          tx < Math.min(size, ent.x + ent.width);
          tx++
        ) {
          s.wallAt[tz * size + tx] = ent.id;
        }
      }
    }
    s.wallRevision = world.grid.revision;
  }

  if (s.stamp === 0xffffffff) {
    s.seen.fill(0);
    s.stamp = 0;
  }
  s.stamp++;
  return s;
}

function heapPush(s: BreachScratch, idx: number, d: number): void {
  if (s.heapSize >= s.heap.length) {
    const newCap = s.heap.length * 2;
    const newHeap = new Int32Array(newCap);
    newHeap.set(s.heap);
    s.heap = newHeap;
    const newHeapDist = new Int32Array(newCap);
    newHeapDist.set(s.heapDist);
    s.heapDist = newHeapDist;
  }

  let pos = s.heapSize++;
  while (pos > 0) {
    const parentPos = (pos - 1) >> 1;
    if (s.heapDist[parentPos] <= d) break;
    s.heap[pos] = s.heap[parentPos];
    s.heapDist[pos] = s.heapDist[parentPos];
    pos = parentPos;
  }
  s.heap[pos] = idx;
  s.heapDist[pos] = d;
}

function heapPop(s: BreachScratch): number {
  const top = s.heap[0];
  const lastPos = --s.heapSize;
  if (lastPos > 0) {
    const lastIdx = s.heap[lastPos];
    const lastDist = s.heapDist[lastPos];
    let pos = 0;
    const half = lastPos >> 1;
    while (pos < half) {
      let left = (pos << 1) + 1;
      const right = left + 1;
      if (right < lastPos && s.heapDist[right] < s.heapDist[left]) {
        left = right;
      }
      if (lastDist <= s.heapDist[left]) break;
      s.heap[pos] = s.heap[left];
      s.heapDist[pos] = s.heapDist[left];
      pos = left;
    }
    s.heap[pos] = lastIdx;
    s.heapDist[pos] = lastDist;
  }
  return top;
}

function findCheapestBreachWall(
  world: World,
  attacker: UnitEntity,
  goal: Combatant,
  startTx: number,
  startTz: number,
): BuildingEntity | undefined {
  const grid = world.grid;
  const size = grid.size;
  const player = attacker.player;

  const s = getBreachScratch(world);
  const { seen, dist, parent, wallAt, stamp } = s;
  const flags = grid.flags;
  const entities = world.entities;
  const startIdx = startTz * size + startTx;

  s.heapSize = 0;
  seen[startIdx] = stamp;
  dist[startIdx] = 0;
  parent[startIdx] = -1;
  heapPush(s, startIdx, 0);

  const ranged = isRangedAttacker(attacker);
  const range = attacker.range ?? 5;
  const minRange = attacker.minRange ?? 0;

  const gtx = Math.max(0, Math.min(size - 1, Math.floor(goal.x)));
  const gtz = Math.max(0, Math.min(size - 1, Math.floor(goal.z)));
  const bx = goal.x;
  const bz = goal.z;
  const bw = goal.kind === 'building' ? goal.width : 0;
  const bh = goal.kind === 'building' ? goal.height : 0;

  let goalIdx = -1;

  while (s.heapSize > 0) {
    const currDist = s.heapDist[0];
    const currIdx = heapPop(s);
    if (currDist > dist[currIdx]) {
      continue;
    }

    const cx = currIdx % size;
    const cz = (currIdx / size) | 0;

    // Check if goal reached
    if (currIdx !== startIdx) {
      let isGoal = false;
      if (ranged) {
        if (grid.isTilePassable(currIdx, player)) {
          const d = distanceToCombatant(cx + 0.5, cz + 0.5, goal);
          isGoal = d <= range && d >= minRange;
        }
      } else if (goal.kind === 'unit') {
        isGoal = Math.abs(cx - gtx) + Math.abs(cz - gtz) <= 1;
      } else {
        isGoal =
          (cx >= bx && cx < bx + bw && (cz === bz - 1 || cz === bz + bh)) ||
          (cz >= bz && cz < bz + bh && (cx === bx - 1 || cx === bx + bw));
      }

      if (isGoal) {
        goalIdx = currIdx;
        break;
      }
    }

    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS_4[d][0];
      const nz = cz + DIRS_4[d][1];
      if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
      const nIdx = nz * size + nx;

      let stepCost = 1;
      if (!grid.isTilePassable(nIdx, player)) {
        if ((flags[nIdx] & FLAG_TERRAIN) !== 0) continue;
        const wallId = wallAt[nIdx];
        if (wallId < 0) continue;
        const wall = entities[wallId];
        if (
          !wall ||
          wall.kind !== 'building' ||
          wall.hp <= 0 ||
          grid.isAlly(player, wall.player)
        ) {
          continue;
        }
        stepCost = wallAt[currIdx] === wallId ? 1 : (WALL_COST + 1);
      }

      const nextDist = currDist + stepCost;
      if (seen[nIdx] !== stamp || nextDist < dist[nIdx]) {
        seen[nIdx] = stamp;
        dist[nIdx] = nextDist;
        parent[nIdx] = currIdx;
        heapPush(s, nIdx, nextDist);
      }
    }
  }

  if (goalIdx < 0) {
    return undefined;
  }

  let firstWallIdx = -1;
  for (let walk = goalIdx; walk >= 0; walk = parent[walk]) {
    if (!grid.isTilePassable(walk, player)) {
      firstWallIdx = walk;
    }
  }

  if (firstWallIdx < 0) {
    return undefined;
  }

  const wall = entities[wallAt[firstWallIdx]];
  return wall && wall.kind === 'building' ? wall : undefined;
}

/**
 * What `attacker` should strike to pursue `goal`:
 * `goal` when canEngage;
 * else a hostile wall/gate on a minimum-walls route (tie-break: shortest route
 * length from the attacker; return the FIRST wall on that route from the attacker side);
 * `undefined` when no route exists even through hostile walls/gates.
 *
 * Sticky per attacker (WeakMap keyed by the unit object): keeps the same breach
 * wall while it is alive, grid.revision is unchanged and the goal is still not
 * engageable, so a moving goal never causes re-planning or wall flapping. Full
 * searches run only on invalidation; an `undefined` (no route) result is cached
 * per world across attackers keyed by (attacker component label, goal component label,
 * revision) and stays valid until grid.revision changes or the goal's component label
 * changes.
 * Deterministic; scratch buffers reused. Uses the single shared per-world
 * component-label cache (PathQueue's), not a private ComponentManager.
 */
export function resolveAttackTarget(
  world: World,
  attacker: UnitEntity,
  goal: Combatant,
): Combatant | undefined {
  if (attacker.hp <= 0 || goal.hp <= 0 || attacker === goal) {
    return undefined;
  }

  if (canEngage(world, attacker, goal)) {
    breachCache.delete(attacker);
    return goal;
  }

  if (world.grid.isAlly(attacker.player, goal.player)) {
    return undefined;
  }
  const grid = world.grid;
  const state = breachCache.get(attacker);
  if (
    state &&
    state.targetGoal === goal &&
    state.revision === grid.revision
  ) {
    const wall = state.breachWall;
    if (
      wall.hp > 0 &&
      world.entities[wall.id] === wall &&
      !grid.isAlly(attacker.player, wall.player)
    ) {
      return wall;
    }
  }

  const size = grid.size;
  const player = attacker.player;
  const labels = world.pathQueue.getComponentLabels(player);

  let startTx = Math.max(0, Math.min(size - 1, Math.floor(attacker.x)));
  let startTz = Math.max(0, Math.min(size - 1, Math.floor(attacker.z)));
  let attackerComp = labels[startTz * size + startTx];
  if (attackerComp === 0) {
    const start = findStartComponent(grid, labels, attacker.x, attacker.z, player);
    attackerComp = start.compId;
    startTx = start.tx;
    startTz = start.tz;
  }
  if (attackerComp === 0) {
    return undefined;
  }

  const gcx = goal.kind === 'unit' ? goal.x : goal.x + goal.width * 0.5;
  const gcz = goal.kind === 'unit' ? goal.z : goal.z + goal.height * 0.5;
  const gtx = Math.max(0, Math.min(size - 1, Math.floor(gcx)));
  const gtz = Math.max(0, Math.min(size - 1, Math.floor(gcz)));
  let goalComp = labels[gtz * size + gtx];
  if (goalComp === 0) {
    goalComp = findStartComponent(grid, labels, gcx, gcz, player).compId;
  }

  const s = getBreachScratch(world);
  const noRouteKey = (player * 1_000_000 + attackerComp) * 1_000_000 + goalComp;
  if (s.noRouteKeys.has(noRouteKey)) {
    return undefined;
  }

  const wall = findCheapestBreachWall(world, attacker, goal, startTx, startTz);
  if (wall) {
    breachCache.set(attacker, {
      targetGoal: goal,
      breachWall: wall,
      revision: grid.revision,
    });
    return wall;
  }

  s.noRouteKeys.add(noRouteKey);
  breachCache.delete(attacker);
  return undefined;
}
