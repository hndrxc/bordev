import { Renderer, type RendererStats } from '../render/Renderer';
import { setupDebugScene } from '../render/DebugScene';
import { SIM_DT, Sim } from '../sim/sim';
import { parseMap } from '../sim/map';
import { cloneCommand } from '../sim/commands';
import type { GameMap } from '../sim/map';
import type { Command } from '../sim/commands';
import type { Entity } from '../sim/entity';
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

export class GameSession {
  readonly renderer: Renderer;

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

  constructor(canvas: HTMLCanvasElement, options?: GameSessionOptions) {
    this._maxAccumulator = options?.maxAccumulator ?? DEFAULT_MAX_ACCUMULATOR;
    this._debugSceneEnabled = options?.debugScene ?? true;
    this.renderer = new Renderer(canvas);

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
        ? this._sim.world.entities.filter((e): e is Entity => e !== undefined).length
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
    while (this._accumulator >= SIM_DT) {
      if (this._sim) {
        this._sim.step();
      }
      this._accumulator -= SIM_DT;
    }

    this._alpha = Math.max(0, Math.min(1, this._accumulator / SIM_DT));

    // Update snapshot with interpolated entity positions
    this.updateSnapshot(this._alpha);

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

      let slot = pool[count];
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
        throw new Error(`Failed to load map from ${mapUrl}: HTTP ${response.status}`);
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

    const isDebug =
      Boolean(import.meta.env.DEV) ||
      new URLSearchParams(window.location.search).get('debug') === '1';

    if (isDebug) {
      window.__bordev = {
        session: this,
        renderer: this.renderer,
        get sim() {
          return this.session.sim;
        },
        issue: (cmd: Command) => this.issue(cmd),
        stats: () => this.getStats(),
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
    this.renderer.dispose();

    if (typeof window !== 'undefined' && window.__bordev?.session === this) {
      delete window.__bordev;
    }
  }
}

declare global {
  interface Window {
    __bordev?: {
      session: GameSession;
      renderer?: Renderer;
      readonly sim: Sim | null;
      issue: (cmd: Command) => void;
      stats: () => SessionStats;
    };
  }
}
