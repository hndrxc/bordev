import type { Faction } from '../../data/types.js';
import type { Combatant, Entity } from '../entity.js';
import type { PlayerState, World } from '../world.js';

export interface FogGhost {
  id: number;
  kind: 'building' | 'mine';
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
  width: number;
  height: number;
  player?: number;
  type?: string;
  faction?: Faction;
  hp?: number;
  maxHp?: number;
  built?: boolean;
  buildProgress?: number;
  orientation?: 'horizontal' | 'vertical';
  gateOpen?: boolean;
  goldRemaining?: number;
  lastSeenTick: number;
}
const scratchSeenGhostKeys = new Set<string>();
const scratchGhostCandidates: Entity[] = [];
const scratchPlayerViewers: PlayerState[][] = [];
const entityKeyCache = new WeakMap<object, string>();
const u32Cache = new WeakMap<Uint8Array, Uint32Array>();

function getUint32View(u8: Uint8Array): Uint32Array | null {
  if ((u8.byteOffset & 3) !== 0) {
    return null;
  }
  let v = u32Cache.get(u8);
  if (!v) {
    v = new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength >> 2);
    u32Cache.set(u8, v);
  }
  return v;
}

function getGhostKey(ent: Entity): string {
  let key = entityKeyCache.get(ent);
  if (!key) {
    key = `${ent.kind}:${ent.x},${ent.z}`;
    entityKeyCache.set(ent, key);
  }
  return key;
}
export function isPositionVisibleTo(
  world: World,
  viewerPlayerId: number,
  x: number,
  z: number,
): boolean {
  const p = world.players[viewerPlayerId];
  if (!p) return false;
  const size = world.map.size;
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (tx < 0 || tx >= size || tz < 0 || tz >= size) {
    return false;
  }
  return p.visible[tz * size + tx] === 1;
}

export function isFootprintVisible(
  world: World,
  viewerPlayerId: number,
  x: number,
  z: number,
  width: number,
  height: number,
): boolean {
  const p = world.players[viewerPlayerId];
  if (!p) return false;
  const size = world.map.size;
  const visible = p.visible;
  const w = width || 1;
  const h = height || 1;
  for (let dz = 0; dz < h; dz++) {
    const tz = z + dz;
    if (tz < 0 || tz >= size) continue;
    const rowOffset = tz * size;
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      if (tx < 0 || tx >= size) continue;
      if (visible[rowOffset + tx] === 1) {
        return true;
      }
    }
  }
  return false;
}

export function isEntityVisibleTo(
  world: World,
  viewerPlayerId: number,
  entity: Entity | Combatant,
): boolean {
  if ('player' in entity && entity.player !== undefined) {
    if (entity.player === viewerPlayerId) {
      return true;
    }
    const viewerTeam = world.players[viewerPlayerId]?.team;
    const entityTeam = world.players[entity.player]?.team;
    if (
      viewerTeam !== undefined &&
      entityTeam !== undefined &&
      viewerTeam === entityTeam
    ) {
      return true;
    }
  }

  if (entity.kind === 'building' || entity.kind === 'mine') {
    return isFootprintVisible(
      world,
      viewerPlayerId,
      entity.x,
      entity.z,
      entity.width,
      entity.height,
    );
  }

  if (entity.kind === 'doodad') {
    const p = world.players[viewerPlayerId];
    if (!p) return false;
    const size = world.map.size;
    const tx = Math.floor(entity.x);
    const tz = Math.floor(entity.z);
    if (tx < 0 || tx >= size || tz < 0 || tz >= size) return false;
    return p.explored[tz * size + tx] === 1;
  }
  return isPositionVisibleTo(world, viewerPlayerId, entity.x, entity.z);
}

function rasterizeSightDisk(
  visible: Uint8Array,
  mapSize: number,
  cx: number,
  cz: number,
  radius: number,
): void {
  const minZ = Math.max(0, Math.floor(cz - radius));
  const maxZ = Math.min(mapSize - 1, Math.floor(cz + radius));
  const rSq = radius * radius + 1e-5;

  for (let tz = minZ; tz <= maxZ; tz++) {
    const dz = tz + 0.5 - cz;
    const dzSq = dz * dz;
    if (dzSq > rSq) continue;
    const hSpan = Math.sqrt(rSq - dzSq);
    const startX = Math.max(0, Math.ceil(cx - hSpan - 0.5));
    const endX = Math.min(mapSize - 1, Math.floor(cx + hSpan - 0.5));
    if (startX <= endX) {
      const rowOffset = tz * mapSize;
      visible.fill(1, rowOffset + startX, rowOffset + endX + 1);
    }
  }
}

export function updateFog(world: World): void {
  const players = world.players;
  const numPlayers = players.length;
  if (numPlayers === 0) return;

  const mapSize = world.map.size;
  const totalTiles = mapSize * mapSize;

  // 1. Clear visible array for all players
  for (let i = 0; i < numPlayers; i++) {
    players[i].visible.fill(0);
  }

  // Pre-resolve allied viewers per player to eliminate player-loop nesting in entity loop
  while (scratchPlayerViewers.length < numPlayers) {
    scratchPlayerViewers.push([]);
  }
  for (let i = 0; i < numPlayers; i++) {
    const p = players[i];
    const list = scratchPlayerViewers[i];
    list.length = 0;
    const team = p.team;
    for (let j = 0; j < numPlayers; j++) {
      const viewer = players[j];
      if (viewer.id === p.id || (team !== undefined && viewer.team === team)) {
        list.push(viewer);
      }
    }
  }

  // 2. Rasterize LOS for all owned/allied entities and collect ghost candidates
  scratchGhostCandidates.length = 0;
  const entities = world.entities;
  const numEntities = entities.length;
  for (let eIdx = 0; eIdx < numEntities; eIdx++) {
    const ent = entities[eIdx];
    if (!ent) continue;

    if (ent.kind === 'unit') {
      const los = ent.lineOfSight;
      if (!los || los <= 0) continue;
      const viewers = scratchPlayerViewers[ent.player];
      if (viewers) {
        const cx = ent.x;
        const cz = ent.z;
        for (let v = 0; v < viewers.length; v++) {
          rasterizeSightDisk(viewers[v].visible, mapSize, cx, cz, los);
        }
      }
    } else if (ent.kind === 'building') {
      scratchGhostCandidates.push(ent);
      const los = ent.lineOfSight;
      if (!los || los <= 0) continue;
      const viewers = scratchPlayerViewers[ent.player];
      if (viewers) {
        const cx = ent.x + ent.width * 0.5;
        const cz = ent.z + ent.height * 0.5;
        for (let v = 0; v < viewers.length; v++) {
          rasterizeSightDisk(viewers[v].visible, mapSize, cx, cz, los);
        }
      }
    } else if (ent.kind === 'mine') {
      scratchGhostCandidates.push(ent);
    }
  }

  // 3. Update explored and fog arrays; bump fogRevision on change
  for (let pIdx = 0; pIdx < numPlayers; pIdx++) {
    const pState = players[pIdx];
    const visible = pState.visible;
    const explored = pState.explored;
    const fog = pState.fog;
    let fogChanged = false;

    const visible32 = getUint32View(visible);
    const explored32 = getUint32View(explored);
    const fog32 = getUint32View(fog);
    const wordsCount = visible32 && explored32 && fog32 ? totalTiles >> 2 : 0;

    let w = 0;
    for (; w < wordsCount; w++) {
      const v32 = visible32![w];
      const e32 = explored32![w];
      const f32 = fog32![w];

      // Fast path 1: 4 tiles in shroud (vis=0, exp=0, fog=0)
      if ((v32 | e32 | f32) === 0) {
        continue;
      }

      // Fast path 2: 4 stable explored hidden tiles (vis=0, exp=1, fog=128)
      if (v32 === 0 && e32 === 0x01010101 && f32 === 0x80808080) {
        continue;
      }

      // Fast path 3: 4 stable fully visible tiles (vis=1, exp=1, fog=255)
      if (v32 === 0x01010101 && e32 === 0x01010101 && f32 === 0xffffffff) {
        continue;
      }

      // Transition / edge word: process 4 tiles byte-by-byte
      const base = w << 2;
      for (let off = 0; off < 4; off++) {
        const t = base + off;
        if (visible[t] === 1) {
          if (explored[t] === 0) {
            explored[t] = 1;
          }
          if (fog[t] !== 255) {
            fog[t] = 255;
            fogChanged = true;
          }
        } else {
          if (explored[t] === 1) {
            if (fog[t] !== 128) {
              fog[t] = 128;
              fogChanged = true;
            }
          } else {
            if (fog[t] !== 0) {
              fog[t] = 0;
              fogChanged = true;
            }
          }
        }
      }
    }

    // Remainder tiles (or fallback if alignment prevented 32-bit views)
    for (let t = w << 2; t < totalTiles; t++) {
      if (visible[t] === 1) {
        if (explored[t] === 0) {
          explored[t] = 1;
        }
        if (fog[t] !== 255) {
          fog[t] = 255;
          fogChanged = true;
        }
      } else {
        if (explored[t] === 1) {
          if (fog[t] !== 128) {
            fog[t] = 128;
            fogChanged = true;
          }
        } else {
          if (fog[t] !== 0) {
            fog[t] = 0;
            fogChanged = true;
          }
        }
      }
    }

    if (fogChanged || pState.fogRevision === 0) {
      pState.fogRevision++;
    }

    // 4. Update ghost memories for hostile buildings and neutral mines
    const ghosts = pState.ghosts;
    scratchSeenGhostKeys.clear();
    const numCandidates = scratchGhostCandidates.length;
    for (let cIdx = 0; cIdx < numCandidates; cIdx++) {
      const ent = scratchGhostCandidates[cIdx];

      if (ent.kind === 'building') {
        if (ent.player === pState.id) continue;
        if (
          pState.team !== undefined &&
          players[ent.player]?.team === pState.team
        ) {
          continue;
        }

        if (
          isFootprintVisible(
            world,
            pState.id,
            ent.x,
            ent.z,
            ent.width,
            ent.height,
          )
        ) {
          const key = getGhostKey(ent);
          scratchSeenGhostKeys.add(key);
          const existing = ghosts.get(key);
          if (existing) {
            existing.id = ent.id;
            existing.kind = 'building';
            existing.x = ent.x;
            existing.z = ent.z;
            existing.previousX = ent.previousX;
            existing.previousZ = ent.previousZ;
            existing.width = ent.width;
            existing.height = ent.height;
            existing.player = ent.player;
            existing.type = ent.type;
            existing.faction = ent.faction;
            existing.hp = ent.hp;
            existing.maxHp = ent.maxHp;
            existing.built = ent.built;
            existing.buildProgress = ent.buildProgress;
            existing.orientation = ent.orientation;
            existing.gateOpen = ent.isGate
              ? (ent.gateOpen ?? false)
              : undefined;
            existing.lastSeenTick = world.tick;
          } else {
            ghosts.set(key, {
              id: ent.id,
              kind: 'building',
              x: ent.x,
              z: ent.z,
              previousX: ent.previousX,
              previousZ: ent.previousZ,
              width: ent.width,
              height: ent.height,
              player: ent.player,
              type: ent.type,
              faction: ent.faction,
              hp: ent.hp,
              maxHp: ent.maxHp,
              built: ent.built,
              buildProgress: ent.buildProgress,
              orientation: ent.orientation,
              gateOpen: ent.isGate ? (ent.gateOpen ?? false) : undefined,
              lastSeenTick: world.tick,
            });
          }
        }
      } else if (ent.kind === 'mine') {
        if (
          isFootprintVisible(
            world,
            pState.id,
            ent.x,
            ent.z,
            ent.width,
            ent.height,
          )
        ) {
          const key = getGhostKey(ent);
          scratchSeenGhostKeys.add(key);
          const existing = ghosts.get(key);
          if (existing) {
            existing.id = ent.id;
            existing.kind = 'mine';
            existing.x = ent.x;
            existing.z = ent.z;
            existing.previousX = ent.previousX;
            existing.previousZ = ent.previousZ;
            existing.width = ent.width;
            existing.height = ent.height;
            existing.type = ent.type;
            existing.goldRemaining = ent.goldRemaining;
            existing.lastSeenTick = world.tick;
          } else {
            ghosts.set(key, {
              id: ent.id,
              kind: 'mine',
              x: ent.x,
              z: ent.z,
              previousX: ent.previousX,
              previousZ: ent.previousZ,
              width: ent.width,
              height: ent.height,
              type: ent.type,
              goldRemaining: ent.goldRemaining,
              lastSeenTick: world.tick,
            });
          }
        }
      }
    }

    // Prune stale ghosts: delete when footprint is visible and remembered entity no longer exists there
    if (ghosts.size > 0) {
      for (const [key, ghost] of ghosts) {
        if (scratchSeenGhostKeys.has(key)) {
          continue;
        }
        if (
          isFootprintVisible(
            world,
            pState.id,
            ghost.x,
            ghost.z,
            ghost.width,
            ghost.height,
          )
        ) {
          ghosts.delete(key);
        }
      }
    }
  }
  scratchSeenGhostKeys.clear();
}
