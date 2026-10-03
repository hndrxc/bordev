import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';
import type { AtlasFrame } from '../assets/atlas';
import type { GameMap } from '../sim/map';
import type { SessionSnapshot } from '../game/GameSession';
import { AtlasCache, type LoadedAtlas } from './AtlasCache';
import type { DebugSceneProbes } from './DebugScene';
import { IsoCamera } from './IsoCamera';
import { Overlays } from './Overlays';
import { SpriteBatch, type RenderSprite } from './SpriteBatch';
import { Terrain } from './Terrain';
import { UnitShadows } from './UnitShadows';

export interface RendererStats {
  drawCalls: number;
  totalVertices: number;
  totalFaces: number;
  frameTimeMs: number;
  renderTimeMs: number;
  fps: number;
  isReady: boolean;
  loadedAssetsCount: number;
  loadedPagesCount: number;
  visibleSpriteCount: number;
  visibleShadowCount: number;
  camera: {
    targetX: number;
    targetZ: number;
    zoom: number;
    width: number;
    height: number;
  } | null;
  probes?: DebugSceneProbes | null;
}

export const REQUIRED_ATLASES = [
  'crown_keep',
  'crown_peasant',
  'crown_spearman',
  'crown_ox_cart',
  'crown_cottage',
  'crown_farm',
  'gold_mine',
  'tree_1',
  'tree_2',
  'tree_3',
  'tree_4',
  'rock_1',
  'rock_2',
  'calib_tile',
  'calib_arrow',
] as const;

const TINT_PLAYER_0: readonly [number, number, number] = [0.2, 0.5, 0.9];
const TINT_PLAYER_1: readonly [number, number, number] = [0.9, 0.2, 0.2];
const TINT_NEUTRAL: readonly [number, number, number] = [1.0, 1.0, 1.0];

interface StaticEntityDescriptor {
  batch: SpriteBatch;
  frame: AtlasFrame;
  anchorOffsetX: number;
  anchorOffsetZ: number;
}

interface UnitFrameEntry {
  batch: SpriteBatch;
  frame: AtlasFrame;
}

export class Renderer {
  public readonly engine: Engine;
  public readonly scene: Scene;
  public readonly canvas: HTMLCanvasElement;

  public camera: IsoCamera | null = null;
  public terrain: Terrain | null = null;
  public overlays: Overlays | null = null;
  public atlasCache: AtlasCache | null = null;
  public unitShadows: UnitShadows | null = null;
  public debugProbes: DebugSceneProbes | null = null;

  private readonly batches = new Map<string, SpriteBatch>();
  private readonly loadedAtlases = new Map<string, LoadedAtlas>();
  private readonly staticDescriptors = new Map<string, StaticEntityDescriptor>();
  private readonly unitWalkTables = new Map<string, UnitFrameEntry[][]>();
  private readonly unitFps = new Map<string, number>();

  // Single reusable scratch object to avoid per-entity allocations in the hot render loop
  private readonly scratchSprite: RenderSprite = {
    asset: '',
    animation: '',
    facing: 0,
    x: 0,
    z: 0,
    tint: TINT_NEUTRAL,
    alpha: 1.0,
    radius: 0.35,
  };

  private instrumentation: SceneInstrumentation | null = null;
  private isReady = false;
  private isDisposed = false;
  private lastSpriteCount = 0;
  private lastShadowCount = 0;

  private readonly onResize = () => {
    if (this.isDisposed) return;
    this.engine.resize();
    this.camera?.resize();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new Color4(0.08, 0.12, 0.16, 1);

    // Rendering group depth configuration:
    // Group 0: Terrain (no depth write)
    // Group 1: Shadows (no depth write)
    // Group 2: Sprites (depth test & write enabled)
    // Group 3: Debug Overlays (drawn on top)
    this.scene.setRenderingAutoClearDepthStencil(1, false);
    this.scene.setRenderingAutoClearDepthStencil(2, false);
    this.scene.setRenderingAutoClearDepthStencil(3, true);

    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;
    this.instrumentation.captureRenderTime = true;

    // Create real IsoCamera immediately with default mapSize 128 so scene has a valid camera for any pre-initialize render
    this.camera = new IsoCamera(this.scene, this.canvas, 128);
    this.camera.centerOn(22, 22);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  setDebugProbes(probes: DebugSceneProbes): void {
    this.debugProbes = probes;
  }

  async initialize(map: GameMap): Promise<void> {
    if (this.isDisposed) {
      throw new Error('Renderer already disposed');
    }

    // Teardown any prior world objects
    this.isReady = false;
    this.disposeWorld();

    // 1. Camera: reconfigure mapSize and center on player 0's Keep
    if (!this.camera) {
      this.camera = new IsoCamera(this.scene, this.canvas, map.size);
    } else {
      this.camera.setMapSize(map.size);
    }
    const start0 = map.starts[0] ?? [20, 20];
    this.camera.centerOn(start0[0] + 2, start0[1] + 2);

    // 2. Overlays: tile grid and 4x4 Keep footprints
    const keepFootprints = map.starts.map(([sx, sz]) => ({
      x: sx,
      z: sz,
      width: 4,
      height: 4,
    }));
    this.overlays = new Overlays(this.scene, map.size, keepFootprints);

    // 3. Terrain: procedural splats and animated water shader
    this.terrain = new Terrain(this.scene, map);

    // 4. AtlasCache and UnitShadows
    this.atlasCache = new AtlasCache(this.scene);
    this.unitShadows = new UnitShadows(this.scene);

    // 5. Preload required atlases in parallel with terrain readiness
    const loadAtlasPromises = REQUIRED_ATLASES.map(async (id) => {
      const loaded = await this.atlasCache!.load(id);
      this.loadedAtlases.set(id, loaded);
      return loaded;
    });

    await Promise.all([this.terrain.ready, ...loadAtlasPromises]);

    if (this.isDisposed) {
      throw new Error('Renderer disposed during initialization');
    }

    // 6. Create SpriteBatch for each atlas page
    for (const [atlasId, loaded] of this.loadedAtlases.entries()) {
      for (let pageIdx = 0; pageIdx < loaded.pages.length; pageIdx++) {
        const page = loaded.pages[pageIdx];
        const key = `${atlasId}_${pageIdx}`;
        this.batches.set(key, new SpriteBatch(this.scene, page));
      }
    }

    // 7. Precompute fast descriptor and frame lookup tables to eliminate per-frame allocations
    this.staticDescriptors.clear();
    const staticConfigs: [string, number, number][] = [
      ['crown_keep', 2, 2],
      ['crown_cottage', 1, 1],
      ['crown_farm', 1, 1],
      ['gold_mine', 1, 1],
      ['tree_1', 0.5, 0.5],
      ['tree_2', 0.5, 0.5],
      ['tree_3', 0.5, 0.5],
      ['tree_4', 0.5, 0.5],
      ['rock_1', 0.5, 0.5],
      ['rock_2', 0.5, 0.5],
      ['calib_tile', 0.5, 0.5],
    ];

    for (let c = 0; c < staticConfigs.length; c++) {
      const [asset, ox, oz] = staticConfigs[c];
      const loaded = this.loadedAtlases.get(asset);
      if (!loaded) continue;
      const frame = loaded.atlas.frames['idle/0/0'];
      if (!frame) continue;
      const batch = this.batches.get(`${asset}_${frame.page}`);
      if (!batch) continue;
      this.staticDescriptors.set(asset, {
        batch,
        frame,
        anchorOffsetX: ox,
        anchorOffsetZ: oz,
      });
    }

    this.unitWalkTables.clear();
    this.unitFps.clear();
    const unitAssets = ['crown_peasant', 'crown_spearman', 'crown_ox_cart'] as const;
    for (let u = 0; u < unitAssets.length; u++) {
      const asset = unitAssets[u];
      const loaded = this.loadedAtlases.get(asset);
      if (!loaded) continue;
      const animMeta = loaded.atlas.anims['walk'] ?? loaded.atlas.anims['idle'];
      if (!animMeta) continue;
      const dirs = animMeta.dirs;
      const frames = animMeta.frames;
      const fps = loaded.atlas.fps || 12;
      this.unitFps.set(asset, fps);

      const table: UnitFrameEntry[][] = [];
      for (let dir = 0; dir < 8; dir++) {
        const row: UnitFrameEntry[] = [];
        const dirKey = dirs === 8 ? dir : 0;
        for (let f = 0; f < frames; f++) {
          const frameKey = `walk/${dirKey}/${f}`;
          const frame = loaded.atlas.frames[frameKey];
          if (frame) {
            const batch = this.batches.get(`${asset}_${frame.page}`);
            if (batch) {
              row.push({ batch, frame });
            }
          }
        }
        table.push(row);
      }
      this.unitWalkTables.set(asset, table);
    }

    this.isReady = true;
  }

  render(snapshot?: SessionSnapshot, timeSeconds?: number): void {
    if (this.isDisposed || this.scene.isDisposed || this.engine.isDisposed) {
      return;
    }

    const t = timeSeconds ?? (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

    // Update animated terrain (water UV scrolling)
    if (this.terrain) {
      this.terrain.update(t);
    }

    // Submit entities to sprite batches and unit shadows with zero allocations
    if (this.isReady && snapshot) {
      this.unitShadows?.beginFrame();
      for (const batch of this.batches.values()) {
        batch.beginFrame();
      }

      let spriteCount = 0;
      let shadowCount = 0;

      const entities = snapshot.entities;
      const entCount = entities.length;

      // Entities are submitted in interleaved order (correctness depends on Z-buffer depth)
      for (let i = 0; i < entCount; i++) {
        const ent = entities[i];
        const kind = ent.kind;

        if (kind === 'unit') {
          const anchorX = ent.x;
          const anchorZ = ent.z;
          const radius = ent.radius ?? 0.35;

          // Procedural unit ground shadow
          this.unitShadows?.add(anchorX, anchorZ, radius);
          shadowCount++;

          const asset =
            ent.type === 'spearman'
              ? 'crown_spearman'
              : ent.type === 'ox_cart'
                ? 'crown_ox_cart'
                : 'crown_peasant';

          const table = this.unitWalkTables.get(asset);
          if (table) {
            const dir = ((ent.facing ?? 0) % 8 + 8) % 8;
            const dirRow = table[dir];
            if (dirRow && dirRow.length > 0) {
              const fps = this.unitFps.get(asset) ?? 12;
              const frameIdx = Math.floor(t * fps) % dirRow.length;
              const entry = dirRow[frameIdx];
              if (entry) {
                this.scratchSprite.asset = asset;
                this.scratchSprite.animation = 'walk';
                this.scratchSprite.facing = dir;
                this.scratchSprite.x = anchorX;
                this.scratchSprite.z = anchorZ;
                this.scratchSprite.tint =
                  ent.player === 0
                    ? TINT_PLAYER_0
                    : ent.player === 1
                      ? TINT_PLAYER_1
                      : TINT_NEUTRAL;
                this.scratchSprite.alpha = 1.0;
                this.scratchSprite.radius = radius;

                entry.batch.add(entry.frame, this.scratchSprite);
                spriteCount++;
              }
            }
          }
        } else if (kind === 'building') {
          const asset =
            ent.type === 'cottage'
              ? 'crown_cottage'
              : ent.type === 'farm'
                ? 'crown_farm'
                : 'crown_keep';

          const desc = this.staticDescriptors.get(asset);
          if (desc) {
            this.scratchSprite.asset = asset;
            this.scratchSprite.animation = 'idle';
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = ent.x + desc.anchorOffsetX;
            this.scratchSprite.z = ent.z + desc.anchorOffsetZ;
            this.scratchSprite.tint =
              ent.player === 0
                ? TINT_PLAYER_0
                : ent.player === 1
                  ? TINT_PLAYER_1
                  : TINT_NEUTRAL;
            this.scratchSprite.alpha = 1.0;

            desc.batch.add(desc.frame, this.scratchSprite);
            spriteCount++;
            shadowCount++;
          }
        } else if (kind === 'mine') {
          const desc = this.staticDescriptors.get('gold_mine');
          if (desc) {
            this.scratchSprite.asset = 'gold_mine';
            this.scratchSprite.animation = 'idle';
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = ent.x + desc.anchorOffsetX;
            this.scratchSprite.z = ent.z + desc.anchorOffsetZ;
            this.scratchSprite.tint = TINT_NEUTRAL;
            this.scratchSprite.alpha = 1.0;

            desc.batch.add(desc.frame, this.scratchSprite);
            spriteCount++;
            shadowCount++;
          }
        } else if (kind === 'doodad') {
          const desc = this.staticDescriptors.get(ent.type ?? 'tree_1');
          if (desc) {
            this.scratchSprite.asset = ent.type ?? 'tree_1';
            this.scratchSprite.animation = 'idle';
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = ent.x + desc.anchorOffsetX;
            this.scratchSprite.z = ent.z + desc.anchorOffsetZ;
            this.scratchSprite.tint = TINT_NEUTRAL;
            this.scratchSprite.alpha = 1.0;

            desc.batch.add(desc.frame, this.scratchSprite);
            spriteCount++;
            shadowCount++;
          }
        }
      }

      this.unitShadows?.endFrame();
      for (const batch of this.batches.values()) {
        batch.endFrame();
      }

      this.lastSpriteCount = spriteCount;
      this.lastShadowCount = shadowCount;
    }

    // Scene render wrapped in beginFrame / endFrame
    this.engine.beginFrame();
    try {
      this.scene.render();
    } finally {
      this.engine.endFrame();
    }
  }

  stats(): RendererStats {
    let drawCalls = this.instrumentation?.drawCallsCounter?.current ?? 0;
    if (drawCalls === 0 && '_drawCalls' in this.engine) {
      const perf = this.engine._drawCalls;
      if (perf && typeof perf === 'object' && 'current' in perf) {
        const count = perf.current;
        if (typeof count === 'number') {
          drawCalls = count;
        }
      }
    }
    const frameTime = this.instrumentation?.frameTimeCounter?.current ?? 0;
    const renderTime = this.instrumentation?.renderTimeCounter?.current ?? 0;

    let totalIndices = 0;
    for (let i = 0; i < this.scene.meshes.length; i++) {
      totalIndices += this.scene.meshes[i].getTotalIndices();
    }

    return {
      drawCalls,
      totalVertices: this.scene.getTotalVertices(),
      totalFaces: Math.floor(totalIndices / 3),
      frameTimeMs: Math.round(frameTime * 100) / 100,
      renderTimeMs: Math.round(renderTime * 100) / 100,
      fps: Math.round(this.engine.getFps() * 10) / 10,
      isReady: this.isReady,
      loadedAssetsCount: this.loadedAtlases.size,
      loadedPagesCount: this.batches.size,
      visibleSpriteCount: this.lastSpriteCount,
      visibleShadowCount: this.lastShadowCount,
      camera: this.camera ? { ...this.camera.view } : null,
      probes: this.debugProbes,
    };
  }

  private disposeWorld(): void {
    for (const batch of this.batches.values()) {
      batch.dispose();
    }
    this.batches.clear();
    this.loadedAtlases.clear();
    this.staticDescriptors.clear();
    this.unitWalkTables.clear();
    this.unitFps.clear();

    this.unitShadows?.dispose();
    this.unitShadows = null;

    this.atlasCache?.dispose();
    this.atlasCache = null;

    this.terrain?.dispose();
    this.terrain = null;

    this.overlays?.dispose();
    this.overlays = null;

    // Note: camera is preserved across world resets and disposed in Renderer.dispose()
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }

    this.disposeWorld();
    this.camera?.dispose();
    this.camera = null;

    this.instrumentation?.dispose();
    this.instrumentation = null;

    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
