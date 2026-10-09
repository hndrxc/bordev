import { Renderer, type RendererStats } from '../render/Renderer';
import { setupDebugScene } from '../render/DebugScene';
import { SIM_DT, Sim } from '../sim/sim';
import { parseMap } from '../sim/map';
import { cloneCommand } from '../sim/commands';
import type { GameMap } from '../sim/map';
import type { Command } from '../sim/commands';
import type {
  Entity,
  CartState,
  TrainingItem,
  UnitOrder,
  UnitEntity,
  BuildingEntity,
} from '../sim/entity';
import { InputController } from '../input/InputController';
import { publishHud, resetHud, setHudStatus } from '../ui/hud';
import { resolveRallyTarget } from '../sim/systems/rally';
import type { World } from '../sim/world';

export { SIM_DT };
export const DEFAULT_MAP_URL = '/maps/alpha_test.json';
export const DEFAULT_SEED = 7;
export const DEFAULT_MAX_ACCUMULATOR = 0.25;

export interface InterpolatedEntity {
  id: number;
  kind: Entity['kind'];
  player?: number;
  type?: string;
  faction?: string;
  x: number;
  z: number;
  simX: number;
  simZ: number;
  previousX: number;
  previousZ: number;
  radius?: number;
  facing?: number;
  hp?: number;
  maxHp?: number;
  width?: number;
  height?: number;
  built?: boolean;
  buildProgress?: number;
  goldRemaining?: number;
  rallyPoint?: { x: number; z: number };
  workAnimation?: 'work' | 'load';
  workStartedTick?: number;
  cart?: CartState;
  orientation?: 'horizontal' | 'vertical';
  trainingQueue?: readonly TrainingItem[];
  order?: UnitOrder;
  raw: Entity;
}

export interface SessionSnapshot {
  tick: number;
  alpha: number;
  simTime: number;
  entities: readonly InterpolatedEntity[];
}

export interface SessionStats {
  fps: number;
  frameCount: number;
  tick: number;
  simTime: number;
  accumulator: number;
  alpha: number;
  entitiesCount: number;
  isLoaded: boolean;
  loadError: string | null;
  isDisposed: boolean;
  renderer?: RendererStats;
}

export interface GameSessionOptions {
  mapUrl?: string;
  seed?: number;
  maxAccumulator?: number;
  debugScene?: boolean;
}

export interface GameCheats {
  resources: (n: number) => void;
  spawnPeasants: (count: number, x: number, z: number) => number[];
}

interface PassableGrid {
  isPassable(x: number, z: number, player: number): boolean;
}

interface SnapshotSlot extends InterpolatedEntity {
  _rallyScratch?: { x: number; z: number };
}

/**
 * Render-time rally endpoint: writes the live (identity- and ownership-checked)
 * target's interpolated position, or the stored ground coordinates, into output.
 */
function resolveSnapshotRally(
  world: World,
  rally: NonNullable<BuildingEntity['rallyPoint']>,
  alpha: number,
  out: { x: number; z: number },
  ownerPlayerId?: number,
): { x: number; z: number } {
  const target = resolveRallyTarget(world, rally, ownerPlayerId);
  if (!target) {
    out.x = rally.x;
    out.z = rally.z;
    return out;
  }
  if (target.kind === 'unit') {
    out.x = target.previousX + (target.x - target.previousX) * alpha;
    out.z = target.previousZ + (target.z - target.previousZ) * alpha;
    return out;
  }
  out.x = target.x + target.width * 0.5;
  out.z = target.z + target.height * 0.5;
  return out;
}

function findNearbyPassablePoints(
  grid: PassableGrid,
  size: number,
  player: number,
  centerX: number,
  centerZ: number,
  count: number,
  existingEntities: readonly (Entity | undefined)[],
): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  const cx = Math.floor(centerX);
  const cz = Math.floor(centerZ);

  const maxSearchRadius = Math.min(
    size,
    Math.max(15, Math.ceil(Math.sqrt(count) * 3)),
  );
  const nearbyEntities: Array<{
    x: number;
    z: number;
    minClearanceSq: number;
  }> = [];
  for (let i = 0; i < existingEntities.length; i++) {
    const e = existingEntities[i];
    if (!e) continue;
    const dx = e.x - centerX;
    const dz = e.z - centerZ;
    if (
      Math.abs(dx) <= maxSearchRadius + 2 &&
      Math.abs(dz) <= maxSearchRadius + 2
    ) {
      const radius =
        'radius' in e && typeof e.radius === 'number' ? e.radius : 0.4;
      const minClearance = radius + 0.3;
      nearbyEntities.push({
        x: e.x,
        z: e.z,
        minClearanceSq: minClearance * minClearance,
      });
    }
  }

  const candidates: Array<{ dx: number; dz: number; distSq: number }> = [];
  for (let r = 0; r <= maxSearchRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r) {
          candidates.push({ dx, dz, distSq: dx * dx + dz * dz });
        }
      }
    }
  }
  candidates.sort((a, b) => a.distSq - b.distSq);

  for (let i = 0; i < candidates.length && points.length < count; i++) {
    const cand = candidates[i];
    const tx = cx + cand.dx;
    const tz = cz + cand.dz;
    if (tx < 0 || tx >= size || tz < 0 || tz >= size) continue;

    const px = tx + 0.5;
    const pz = tz + 0.5;

    if (!grid.isPassable(px, pz, player)) continue;

    let overlaps = false;
    for (let j = 0; j < points.length; j++) {
      const pt = points[j];
      const ddx = pt.x - px;
      const ddz = pt.z - pz;
      if (ddx * ddx + ddz * ddz < 0.64) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    for (let j = 0; j < nearbyEntities.length; j++) {
      const ne = nearbyEntities[j];
      const ddx = ne.x - px;
      const ddz = ne.z - pz;
      if (ddx * ddx + ddz * ddz < ne.minClearanceSq) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    points.push({ x: px, z: pz });
  }

  return points;
}

export class GameSession {
  readonly debugEnabled: boolean;
  readonly renderer: Renderer;
  readonly input: InputController;
  private readonly _cheats: GameCheats;

  private _sim: Sim | null = null;
  private _map: GameMap | null = null;
  private _loadError: string | null = null;

  private readonly _snapshotEntities: InterpolatedEntity[] = [];
  private readonly _snapshot: SessionSnapshot = {
    tick: 0,
    alpha: 0,
    simTime: 0,
    entities: this._snapshotEntities,
  };

  private readonly _debugSceneEnabled: boolean;
  private readonly _maxAccumulator: number;
  private _accumulator = 0;
  private _alpha = 0;
  private _lastTime = 0;
  private _rafId: number | null = null;

  private _frameCount = 0;
  private _fps = 0;
  private _fpsTimer = 0;
  private _fpsFrames = 0;

  private _disposed = false;
  private readonly _abortController = new AbortController();
  private readonly _pendingCommands: Command[] = [];

  private _lastHudTick = -1;

  constructor(canvas: HTMLCanvasElement, options?: GameSessionOptions) {
    this._maxAccumulator = options?.maxAccumulator ?? DEFAULT_MAX_ACCUMULATOR;
    this._debugSceneEnabled = options?.debugScene ?? true;
    this.debugEnabled =
      Boolean(import.meta.env.DEV) ||
      (typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debug') === '1');

    // Reset HUD on session initialization
    resetHud();

    // Construct renderer, then input controller
    this.renderer = new Renderer(canvas);
    this.input = new InputController(canvas, this);

    this._cheats = {
      resources: (n: number) => {
        if (!this._sim) return;
        for (let i = 0; i < this._sim.world.players.length; i++) {
          const p = this._sim.world.players[i];
          p.food = n;
          p.gold = n;
        }
        publishHud(this);
      },
      spawnPeasants: (count: number, x: number, z: number) => {
        if (!this._sim || count <= 0) return [];

        const world = this._sim.world;
        const grid = world.grid;
        const mapSize = world.map.size;
        const player0Faction = world.players[0]?.faction ?? 'crown';

        const points = findNearbyPassablePoints(
          grid,
          mapSize,
          0,
          x,
          z,
          count,
          world.entities,
        );

        const createdIds: number[] = [];
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const unit = world.spawnUnit(
            0,
            'peasant',
            pt.x,
            pt.z,
            player0Faction,
          );
          createdIds.push(unit.id);
        }

        this.updateSnapshot(this._alpha);
        publishHud(this);

        return createdIds;
      },
    };

    // Initial explicit render clears canvas immediately
    this.renderer.render();

    this.registerDebugHook();

    // Start single frame clock
    this._rafId = requestAnimationFrame(this.onFrame);

    // Asynchronously fetch and parse map, then construct Sim
    const mapUrl = options?.mapUrl ?? DEFAULT_MAP_URL;
    const seed = options?.seed ?? DEFAULT_SEED;
    void this.loadMap(mapUrl, seed);
  }

  get sim(): Sim | null {
    return this._sim;
  }

  get map(): GameMap | null {
    return this._map;
  }

  get isLoaded(): boolean {
    return this._sim !== null;
  }

  get loadError(): string | null {
    return this._loadError;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get snapshot(): SessionSnapshot | null {
    return this._sim !== null ? this._snapshot : null;
  }
  get cheats(): GameCheats {
    return this._cheats;
  }
  showStatus(message: string): void {
    setHudStatus(message);
  }

  issue(cmd: Command): void {
    if (this._disposed) return;
    if (this._sim) {
      this._sim.issue(cmd);
    } else {
      this._pendingCommands.push(cloneCommand(cmd));
    }
  }

  getInterpolatedEntity(id: number): InterpolatedEntity | undefined {
    if (!this._sim) return undefined;
    return this._snapshotEntities.find((candidate) => candidate.id === id);
  }

  getInterpolatedPosition(id: number): { x: number; z: number } | undefined {
    const entity = this.getInterpolatedEntity(id);
    if (!entity) return undefined;
    return { x: entity.x, z: entity.z };
  }

  getStats(): SessionStats {
    return {
      fps: Math.round(this._fps * 10) / 10,
      frameCount: this._frameCount,
      tick: this._sim ? this._sim.world.tick : 0,
      simTime: this._sim ? this._sim.world.tick * SIM_DT : 0,
      accumulator: Math.round(this._accumulator * 1000) / 1000,
      alpha: Math.round(this._alpha * 1000) / 1000,
      entitiesCount: this._sim
        ? this._sim.world.entities.filter((e): e is Entity => e !== undefined)
            .length
        : 0,
      isLoaded: this._sim !== null,
      loadError: this._loadError,
      isDisposed: this._disposed,
      renderer: this.renderer.stats(),
    };
  }

  private readonly onFrame = (now: number): void => {
    if (this._disposed) return;

    if (this._lastTime === 0) {
      this._lastTime = now;
      this._fpsTimer = now;
    }

    const delta = (now - this._lastTime) / 1000;
    this._lastTime = now;

    // Clamp delta to prevent spiral of death
    const dt = Math.max(0, Math.min(delta, this._maxAccumulator));
    this._accumulator += dt;

    // Track FPS
    this._frameCount++;
    this._fpsFrames++;
    if (now - this._fpsTimer >= 1000) {
      this._fps = (this._fpsFrames * 1000) / (now - this._fpsTimer);
      this._fpsTimer = now;
      this._fpsFrames = 0;
    }

    // Step simulation at authoritative fixed SIM_DT
    let stepped = false;
    while (this._accumulator >= SIM_DT) {
      if (this._sim) {
        this._sim.step();
        stepped = true;
      }
      this._accumulator -= SIM_DT;
    }

    this._alpha = Math.max(0, Math.min(1, this._accumulator / SIM_DT));

    // Update snapshot with interpolated entity positions
    this.updateSnapshot(this._alpha);

    // Publish HUD at 10 Hz measured in sim ticks/time (every 2 sim ticks = 0.10s)
    if (this._sim && stepped) {
      const currentTick = this._sim.world.tick;
      if (currentTick - this._lastHudTick >= 2) {
        this._lastHudTick = currentTick;
        publishHud(this);
      }
    }

    // Update input controller BEFORE render (updates camera, pruning, setInteraction)
    this.input.update(dt, now);

    // Explicitly render canvas frame with snapshot and render time
    this.renderer.render(this._sim ? this._snapshot : undefined, now / 1000);
    if (!this._disposed) {
      this._rafId = requestAnimationFrame(this.onFrame);
    }
  };

  private updateSnapshot(alpha: number): void {
    if (!this._sim) {
      return;
    }

    const worldEntities = this._sim.world.entities;
    const pool = this._snapshotEntities;
    let count = 0;

    for (let i = 0; i < worldEntities.length; i++) {
      const e = worldEntities[i];
      if (!e) continue;

      let slot = pool[count] as SnapshotSlot | undefined;
      if (!slot) {
        slot = {
          id: e.id,
          kind: e.kind,
          x: 0,
          z: 0,
          simX: 0,
          simZ: 0,
          previousX: 0,
          previousZ: 0,
          raw: e,
        };
        pool[count] = slot;
      }

      slot.id = e.id;
      slot.kind = e.kind;
      slot.x = e.previousX + (e.x - e.previousX) * alpha;
      slot.z = e.previousZ + (e.z - e.previousZ) * alpha;
      slot.simX = e.x;
      slot.simZ = e.z;
      slot.previousX = e.previousX;
      slot.previousZ = e.previousZ;
      slot.raw = e;

      slot.player = 'player' in e ? e.player : undefined;
      slot.type = 'type' in e ? e.type : undefined;
      slot.faction = 'faction' in e ? e.faction : undefined;
      slot.radius = 'radius' in e ? e.radius : undefined;
      slot.facing = 'facing' in e ? e.facing : undefined;
      slot.hp = 'hp' in e ? e.hp : undefined;
      slot.maxHp = 'maxHp' in e ? e.maxHp : undefined;
      slot.width = 'width' in e ? e.width : undefined;
      slot.height = 'height' in e ? e.height : undefined;
      slot.built = 'built' in e ? e.built : undefined;
      slot.buildProgress = 'buildProgress' in e ? e.buildProgress : undefined;
      slot.goldRemaining = 'goldRemaining' in e ? e.goldRemaining : undefined;
      if ('rallyPoint' in e && e.rallyPoint) {
        const scratch = slot._rallyScratch ?? (slot._rallyScratch = { x: 0, z: 0 });
        slot.rallyPoint = resolveSnapshotRally(
          this._sim.world,
          e.rallyPoint,
          alpha,
          scratch,
          'player' in e ? e.player : undefined,
        );
      } else {
        slot.rallyPoint = undefined;
      }
      slot.workAnimation =
        'workAnimation' in e ? (e as UnitEntity).workAnimation : undefined;
      slot.workStartedTick =
        'workStartedTick' in e ? (e as UnitEntity).workStartedTick : undefined;
      slot.cart = 'cart' in e ? (e as UnitEntity).cart : undefined;
      slot.orientation =
        'orientation' in e ? (e as BuildingEntity).orientation : undefined;
      slot.trainingQueue =
        'trainingQueue' in e ? (e as BuildingEntity).trainingQueue : undefined;
      slot.order = 'order' in e ? (e as UnitEntity).order : undefined;
      count++;
    }

    pool.length = count;

    this._snapshot.tick = this._sim.world.tick;
    this._snapshot.alpha = alpha;
    this._snapshot.simTime = this._sim.world.tick * SIM_DT;
  }

  private async loadMap(mapUrl: string, seed: number): Promise<void> {
    try {
      const response = await fetch(mapUrl, {
        signal: this._abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to load map from ${mapUrl}: HTTP ${response.status}`,
        );
      }

      const json = (await response.json()) as unknown;
      if (this._disposed) return;

      const gameMap = parseMap(json);
      if (this._disposed) return;

      this._map = gameMap;
      const sim = new Sim(gameMap, seed);
      if (this._disposed) return;

      if (this._debugSceneEnabled) {
        const probes = setupDebugScene(sim, seed);
        this.renderer.setDebugProbes(probes);
      }

      await this.renderer.initialize(gameMap);
      if (this._disposed) return;

      this._sim = sim;
      this._loadError = null;

      // Drain buffered commands
      while (this._pendingCommands.length > 0) {
        const cmd = this._pendingCommands.shift()!;
        sim.issue(cmd);
      }

      // Initial snapshot
      this.updateSnapshot(0);

      // Initial HUD publish after map load
      this._lastHudTick = sim.world.tick;
      publishHud(this);
    } catch (error) {
      if (
        this._disposed ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._loadError = message;
      console.error('Failed to load map for GameSession:', error);
    }
  }

  private registerDebugHook(): void {
    if (typeof window === 'undefined') return;

    if (this.debugEnabled) {
      window.__bordev = {
        session: this,
        renderer: this.renderer,
        get sim() {
          return this.session.sim;
        },
        issue: (cmd: Command) => this.issue(cmd),
        stats: () => this.getStats(),
        cheats: this._cheats,
        showStatus: (message: string) => this.showStatus(message),
      };
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this._abortController.abort();
    this.input.dispose();
    this.renderer.dispose();
    resetHud();

    if (typeof window !== 'undefined' && window.__bordev?.session === this) {
      delete window.__bordev;
    }
  }
}

export interface BordevDebugApi {
  session: GameSession;
  renderer?: Renderer;
  readonly sim: Sim | null;
  issue: (cmd: Command) => void;
  stats: () => SessionStats;
  cheats: GameCheats;
  showStatus?: (message: string) => void;
}

declare global {
  interface Window {
    __bordev?: BordevDebugApi;
  }
}
