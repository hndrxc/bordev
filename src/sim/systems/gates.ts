import type { BuildingEntity, Combatant, UnitEntity } from '../entity.js';
import { FLAG_BUILDING, FLAG_GATE, FLAG_TERRAIN } from '../grid.js';
import { ComponentManager, findStartComponent } from '../path/components.js';
import type { World } from '../world.js';

const DIRS_4: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const worldTeamCache = new WeakMap<World, number[]>();
const componentManagers = new WeakMap<World, ComponentManager>();

function getComponentManager(world: World): ComponentManager {
  let cm = componentManagers.get(world);
  if (!cm) {
    cm = new ComponentManager();
    componentManagers.set(world, cm);
  }
  return cm;
}

function syncTeamAlliances(world: World): void {
  const cachedTeams = worldTeamCache.get(world);
  const numPlayers = world.players.length;
  let teamsChanged = false;

  if (!cachedTeams || cachedTeams.length !== numPlayers) {
    teamsChanged = true;
  } else {
    for (let i = 0; i < numPlayers; i++) {
      if (cachedTeams[i] !== world.players[i].team) {
        teamsChanged = true;
        break;
      }
    }
  }

  if (!teamsChanged) {
    return;
  }

  const currentTeams = new Array<number>(numPlayers);
  for (let i = 0; i < numPlayers; i++) {
    currentTeams[i] = world.players[i].team;
  }
  worldTeamCache.set(world, currentTeams);

  for (let i = 0; i < numPlayers; i++) {
    const p = world.players[i];
    const allies: number[] = [];
    for (let j = 0; j < numPlayers; j++) {
      const other = world.players[j];
      if (other.id !== p.id && other.team === p.team) {
        allies.push(other.id);
      }
    }
    world.grid.setAllies(p.id, allies);
  }
}

/**
 * Synchronizes team alliances without revision churn and updates `gateOpen`
 * for living gates when living owner/allied units are within 1 tile of footprint.
 */
export function updateGates(world: World): void {
  syncTeamAlliances(world);

  const entities = world.entities;
  const grid = world.grid;
  const size = grid.size;

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent || ent.kind !== 'building' || !ent.isGate || ent.hp <= 0) {
      continue;
    }

    if (!ent.built) {
      ent.gateOpen = false;
      // Ensure unfinished gate stays blocked on the grid (FLAG_BUILDING, no FLAG_GATE)
      const firstIdx = ent.z * size + ent.x;
      if (
        (grid.flags[firstIdx] & FLAG_GATE) !== 0 ||
        (grid.flags[firstIdx] & FLAG_BUILDING) === 0
      ) {
        grid.setBuilding(ent.x, ent.z, ent.width, ent.height, true);
      }
      continue;
    }

    // Ensure finished gate is registered on grid with FLAG_GATE
    const firstIdx = ent.z * size + ent.x;
    if ((grid.flags[firstIdx] & FLAG_GATE) === 0) {
      grid.setGate(ent.x, ent.z, ent.width, ent.height, ent.player);
    }

    let hasNearbyFriendly = false;
    for (let j = 0; j < entities.length; j++) {
      const other = entities[j];
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

/**
 * Per-world scratch for breach searches. Every tile is discovered at most once
 * per search (node costs are 0 for passable tiles, 1 for hostile walls), so
 * the queues never need more than `size*size` entries and `seen` is reset by
 * bumping a stamp instead of clearing.
 */
interface BreachScratch {
  size: number;
  stamp: number;
  seen: Uint32Array;
  parent: Int32Array;
  queueA: Int32Array;
  queueB: Int32Array;
  /** Tile -> id of the wall/gate building covering it, or -1. Valid for `wallRevision`. */
  wallAt: Int32Array;
  wallRevision: number;
}

const breachScratch = new WeakMap<World, BreachScratch>();

function getBreachScratch(world: World): BreachScratch {
  const size = world.grid.size;
  let s = breachScratch.get(world);
  if (!s || s.size !== size) {
    const total = size * size;
    s = {
      size,
      stamp: 0,
      seen: new Uint32Array(total),
      parent: new Int32Array(total),
      queueA: new Int32Array(total),
      queueB: new Int32Array(total),
      wallAt: new Int32Array(total),
      wallRevision: -1,
    };
    breachScratch.set(world, s);
  }
  if (s.wallRevision !== world.grid.revision) {
    s.wallAt.fill(-1);
    const entities = world.entities;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (
        !ent ||
        ent.kind !== 'building' ||
        ent.hp <= 0 ||
        !(
          ent.isGate === true ||
          ent.role === 'wall' ||
          ent.role === 'gate' ||
          ent.type.includes('wall') ||
          ent.type.includes('gate')
        )
      ) {
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

function distanceToTarget(px: number, pz: number, target: Combatant): number {
  if (target.kind === 'unit') {
    return Math.hypot(px - target.x, pz - target.z);
  }
  const cx = Math.max(target.x, Math.min(px, target.x + target.width));
  const cz = Math.max(target.z, Math.min(pz, target.z + target.height));
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Resolves an unreachable hostile target to the first hostile wall/gate on the
 * cheapest breach route from the attacker to the target (or, for ranged
 * attackers, to a legal firing position).
 *
 * The route is a deterministic layered 0-1 search over 4-connected tiles:
 * tiles passable for the attacker's player cost 0, hostile wall/gate tiles
 * cost 1, everything else (terrain, other buildings, allied walls) is blocked.
 * Cardinal steps are equivalent to the no-corner-cutting 8-connected moves of
 * component labelling: a legal diagonal step needs both orthogonal tiles
 * passable, so it can always be replaced by two free cardinal steps. Ties
 * resolve by scan order (E, W, S, N; FIFO), which is stable for a given world.
 *
 * Returns `undefined` when the target is already reachable (melee: component
 * touches the target tile / footprint ring; ranged: the attacker's component
 * contains a legal firing tile or the attacker is already in range) and when no
 * breach route exists (e.g. terrain-isolated), so callers fall back to normal
 * behaviour instead of attacking an arbitrary wall. For ranged attackers,
 * `undefined` therefore means "reachable firing position exists or no wall
 * helps".
 */
export function findBlockingWall(
  world: World,
  attacker: UnitEntity,
  target: Combatant,
): BuildingEntity | undefined {
  if (attacker.hp <= 0 || target.hp <= 0 || attacker === target) {
    return undefined;
  }
  const grid = world.grid;
  const player = attacker.player;
  if (grid.isAlly(player, target.player)) {
    return undefined;
  }

  const size = grid.size;
  const labels = getComponentManager(world).getLabels(grid, player);

  let startTx = Math.max(0, Math.min(size - 1, Math.floor(attacker.x)));
  let startTz = Math.max(0, Math.min(size - 1, Math.floor(attacker.z)));
  let attackerComp = labels[startTz * size + startTx];
  if (attackerComp === 0) {
    const start = findStartComponent(
      grid,
      labels,
      attacker.x,
      attacker.z,
      player,
    );
    attackerComp = start.compId;
    startTx = start.tx;
    startTz = start.tz;
  }
  if (attackerComp === 0) {
    return undefined;
  }

  const range = attacker.range ?? 5;
  const minRange = attacker.minRange ?? 0;
  const ranged = (attacker.attackType ?? 'melee') !== 'melee' && range > 0;

  // Goal description. Melee: tiles in [gx0..gx1] x [gz0..gz1] outside the hole
  // (the target tile's 3x3 block, or a building's footprint ring). Ranged:
  // tiles whose centre is a legal firing position.
  let gx0 = 0;
  let gz0 = 0;
  let gx1 = -1;
  let gz1 = -1;
  let hx0 = 1;
  let hz0 = 1;
  let hx1 = 0;
  let hz1 = 0;

  if (ranged) {
    const d = distanceToTarget(attacker.x, attacker.z, target);
    if (d <= range && d >= minRange) {
      return undefined;
    }
    // Does the attacker's own component contain a legal firing tile?
    const bx0 = target.x;
    const bz0 = target.z;
    const bx1 = target.kind === 'unit' ? target.x : target.x + target.width;
    const bz1 = target.kind === 'unit' ? target.z : target.z + target.height;
    const x0 = Math.max(0, Math.floor(bx0 - range));
    const x1 = Math.min(size - 1, Math.floor(bx1 + range));
    const z0 = Math.max(0, Math.floor(bz0 - range));
    const z1 = Math.min(size - 1, Math.floor(bz1 + range));
    for (let tz = z0; tz <= z1; tz++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (labels[tz * size + tx] !== attackerComp) continue;
        const dist = distanceToTarget(tx + 0.5, tz + 0.5, target);
        if (
          dist <= range &&
          dist >= minRange &&
          grid.canOccupy(tx + 0.5, tz + 0.5, attacker.radius, player)
        ) {
          return undefined;
        }
      }
    }
  } else if (target.kind === 'unit') {
    const tx = Math.max(0, Math.min(size - 1, Math.floor(target.x)));
    const tz = Math.max(0, Math.min(size - 1, Math.floor(target.z)));
    gx0 = Math.max(0, tx - 1);
    gx1 = Math.min(size - 1, tx + 1);
    gz0 = Math.max(0, tz - 1);
    gz1 = Math.min(size - 1, tz + 1);
  } else {
    gx0 = Math.max(0, target.x - 1);
    gx1 = Math.min(size - 1, target.x + target.width);
    gz0 = Math.max(0, target.z - 1);
    gz1 = Math.min(size - 1, target.z + target.height);
    hx0 = target.x;
    hx1 = target.x + target.width - 1;
    hz0 = target.z;
    hz1 = target.z + target.height - 1;
  }

  if (!ranged) {
    // Already reachable without breaking anything.
    for (let tz = gz0; tz <= gz1; tz++) {
      for (let tx = gx0; tx <= gx1; tx++) {
        if (tx >= hx0 && tx <= hx1 && tz >= hz0 && tz <= hz1) continue;
        if (labels[tz * size + tx] === attackerComp) {
          return undefined;
        }
      }
    }
  }

  const s = getBreachScratch(world);
  const { seen, parent, wallAt, stamp } = s;
  const flags = grid.flags;
  const entities = world.entities;
  const startIdx = startTz * size + startTx;

  let cur = s.queueA;
  let nxt = s.queueB;
  let curLen = 0;
  let nxtLen = 0;
  seen[startIdx] = stamp;
  parent[startIdx] = -1;
  cur[curLen++] = startIdx;

  let goalIdx = -1;
  for (;;) {
    let head = 0;
    while (head < curLen) {
      const idx = cur[head++];
      const cx = idx % size;
      const cz = (idx / size) | 0;

      let isGoal: boolean;
      if (ranged) {
        const dist = distanceToTarget(cx + 0.5, cz + 0.5, target);
        isGoal =
          dist <= range &&
          dist >= minRange &&
          (!grid.isTilePassable(idx, player) ||
            grid.canOccupy(cx + 0.5, cz + 0.5, attacker.radius, player));
      } else {
        isGoal =
          cx >= gx0 &&
          cx <= gx1 &&
          cz >= gz0 &&
          cz <= gz1 &&
          !(cx >= hx0 && cx <= hx1 && cz >= hz0 && cz <= hz1);
      }
      if (isGoal) {
        goalIdx = idx;
        break;
      }

      for (let d = 0; d < 4; d++) {
        const nx = cx + DIRS_4[d][0];
        const nz = cz + DIRS_4[d][1];
        if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
        const nIdx = nz * size + nx;
        if (seen[nIdx] === stamp) continue;

        if (grid.isTilePassable(nIdx, player)) {
          seen[nIdx] = stamp;
          parent[nIdx] = idx;
          cur[curLen++] = nIdx;
          continue;
        }
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
        seen[nIdx] = stamp;
        parent[nIdx] = idx;
        nxt[nxtLen++] = nIdx;
      }
    }
    if (goalIdx >= 0 || nxtLen === 0) break;
    const swap = cur;
    cur = nxt;
    nxt = swap;
    curLen = nxtLen;
    nxtLen = 0;
  }

  if (goalIdx < 0) {
    return undefined;
  }

  // Walk back to the attacker; the last wall tile seen is the first one on the route.
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
