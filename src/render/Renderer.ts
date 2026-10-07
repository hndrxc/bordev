import { Engine } from '@babylonjs/core/Engines/engine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Scene } from '@babylonjs/core/scene';
import type { AtlasFrame } from '../assets/atlas';
import type { GameMap } from '../sim/map';
import type { SessionSnapshot } from '../game/GameSession';
import { AtlasCache, type LoadedAtlas } from './AtlasCache';
import type { DebugSceneProbes } from './DebugScene';
import { type IsoView, worldToScreenInto } from './iso';
import { IsoCamera } from './IsoCamera';
import {
  Overlays,
  type OrderMarker,
  type SelectionBox,
  type OverlayFrameInput,
} from './Overlays';
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

export interface EntityScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  depth: number;
}

export interface PortraitMetadata {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementPreviewItem {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly valid: boolean;
}

export const REQUIRED_ATLASES = [
  'crown_keep',
  'crown_peasant',
  'crown_spearman',
  'crown_man_at_arms',
  'crown_halberdier',
  'crown_longbowman',
  'crown_crossbowman',
  'crown_sergeant',
  'crown_knight',
  'crown_trebuchet',
  'crown_ox_cart',
  'crown_cottage',
  'crown_farm',
  'crown_storehouse',
  'crown_chapel',
  'crown_barracks',
  'crown_archery_range',
  'crown_stable',
  'crown_siege_workshop',
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

const TYPE_TO_ASSET: Record<string, string> = {
  spearman: 'crown_spearman',
  ox_cart: 'crown_ox_cart',
  peasant: 'crown_peasant',
  keep: 'crown_keep',
  cottage: 'crown_cottage',
  farm: 'crown_farm',
  storehouse: 'crown_storehouse',
  chapel: 'crown_chapel',
  barracks: 'crown_barracks',
  archery_range: 'crown_archery_range',
  stable: 'crown_stable',
  siege_workshop: 'crown_siege_workshop',
  man_at_arms: 'crown_man_at_arms',
  halberdier: 'crown_halberdier',
  longbowman: 'crown_longbowman',
  crossbowman: 'crown_crossbowman',
  sergeant: 'crown_sergeant',
  knight: 'crown_knight',
  trebuchet: 'crown_trebuchet',
  crown_spearman: 'crown_spearman',
  crown_ox_cart: 'crown_ox_cart',
  crown_peasant: 'crown_peasant',
  crown_keep: 'crown_keep',
  crown_cottage: 'crown_cottage',
  crown_farm: 'crown_farm',
  crown_storehouse: 'crown_storehouse',
  crown_chapel: 'crown_chapel',
  crown_barracks: 'crown_barracks',
  crown_archery_range: 'crown_archery_range',
  crown_stable: 'crown_stable',
  crown_siege_workshop: 'crown_siege_workshop',
  crown_man_at_arms: 'crown_man_at_arms',
  crown_halberdier: 'crown_halberdier',
  crown_longbowman: 'crown_longbowman',
  crown_crossbowman: 'crown_crossbowman',
  crown_sergeant: 'crown_sergeant',
  crown_knight: 'crown_knight',
  crown_trebuchet: 'crown_trebuchet',
  gold_mine: 'gold_mine',
};

function getAssetForEntity(entity: { kind?: string; type?: string }): string {
  if (entity.type && TYPE_TO_ASSET[entity.type]) {
    return TYPE_TO_ASSET[entity.type];
  }
  if (entity.kind === 'unit') {
    return 'crown_peasant';
  }
  if (entity.kind === 'building') {
    return 'crown_keep';
  }
  if (entity.kind === 'mine') {
    return 'gold_mine';
  }
  return entity.type ?? 'tree_1';
}

interface StaticEntityDescriptor {
  batch: SpriteBatch;
  frame: AtlasFrame;
}

interface UnitFrameEntry {
  batch: SpriteBatch;
  frame: AtlasFrame;
}

interface UnitAnimationData {
  table: UnitFrameEntry[][];
  fps: number;
  isLoop: boolean;
}

export interface CachedEntityRect extends EntityScreenRect {
  id: number;
  kind: string;
  frameAy: number;
  spriteTopPx?: number;
  stamp: number;
}

const scratchAnchor = { x: 0, y: 0 };

export function writeSpriteScreenRect(
  out: CachedEntityRect,
  id: number,
  kind: string,
  anchorX: number,
  anchorZ: number,
  frame: AtlasFrame,
  view: IsoView,
  stamp: number,
): void {
  worldToScreenInto(scratchAnchor, anchorX, anchorZ, view);
  const zoom = view.zoom;

  out.id = id;
  out.kind = kind;
  out.left = scratchAnchor.x - frame.ax * zoom;
  out.top = scratchAnchor.y - frame.ay * zoom;
  out.right = scratchAnchor.x + (frame.w - frame.ax) * zoom;
  out.bottom = scratchAnchor.y + (frame.h - frame.ay) * zoom;
  out.depth = anchorX + anchorZ;
  out.frameAy = frame.ay;
  out.stamp = stamp;
}

export function pickFrontmost(
  rects: readonly CachedEntityRect[],
  count: number,
  x: number,
  y: number,
): number | undefined {
  let bestId: number | undefined = undefined;
  let bestDepth = -Infinity;

  for (let i = 0; i < count; i++) {
    const rect = rects[i];
    if (rect.kind === 'doodad') {
      continue;
    }
    if (
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      if (rect.depth > bestDepth) {
        bestDepth = rect.depth;
        bestId = rect.id;
      }
    }
  }

  return bestId;
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
  private readonly staticDescriptors = new Map<
    string,
    StaticEntityDescriptor
  >();
  private readonly buildingConstructDescriptors = new Map<
    string,
    StaticEntityDescriptor[]
  >();
  private readonly unitAssetAnims = new Map<
    string,
    Record<string, UnitAnimationData>
  >();
  private readonly unitAnimTables = new Map<string, UnitFrameEntry[][]>();
  private readonly unitAnimFps = new Map<string, number>();
  private readonly unitAnimLoop = new Map<string, boolean>();
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

  // Interaction references for overlays
  private interactionSelectedIds: readonly number[] = [];
  private interactionMarkers: readonly OrderMarker[] = [];
  private interactionBox: SelectionBox | null = null;
  private interactionPlacement: readonly PlacementPreviewItem[] | undefined =
    undefined;
  private readonly assetSpriteTopPx = new Map<string, number>();
  private readonly overlayInput: OverlayFrameInput & {
    placement?: readonly PlacementPreviewItem[];
  };
  private currentSnapshot: SessionSnapshot | undefined = undefined;

  // Cached screen rectangles for entity picking, allocation-free after capacity grows
  private readonly entityRectPool: CachedEntityRect[] = [];
  private entityRectCount = 0;
  private readonly entityRectMap = new Map<number, CachedEntityRect>();
  private rectStamp = 0;

  private readonly getSpriteTopPx = (id: number): number | undefined => {
    const cached = this.entityRectMap.get(id);
    if (cached && cached.stamp === this.rectStamp) {
      return cached.spriteTopPx;
    }
    if (this.currentSnapshot) {
      const ent = this.currentSnapshot.entities.find((e) => e.id === id);
      if (ent) {
        const asset = getAssetForEntity(ent);
        return this.assetSpriteTopPx.get(asset);
      }
    }
    return undefined;
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
    // Group 1: Shadows & Selection Ellipses (no depth write)
    // Group 2: Sprites (depth test & write enabled)
    // Group 3: Debug Overlays & Health Bars (drawn on top)
    this.scene.setRenderingAutoClearDepthStencil(1, false);
    this.scene.setRenderingAutoClearDepthStencil(2, false);
    this.scene.setRenderingAutoClearDepthStencil(3, true);

    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;
    this.instrumentation.captureRenderTime = true;

    // Create real IsoCamera immediately with default mapSize 128 so scene has a valid camera for any pre-initialize render
    this.camera = new IsoCamera(this.scene, this.canvas, 128);
    this.camera.centerOn(22, 22);

    this.overlayInput = {
      snapshot: undefined,
      view: this.camera.view,
      selectedIds: [],
      markers: [],
      box: null,
      timeSeconds: 0,
      getSpriteTopPx: this.getSpriteTopPx,
      placement: undefined,
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
  }

  setDebugProbes(probes: DebugSceneProbes): void {
    this.debugProbes = probes;
  }

  setInteraction(
    selectedIds: readonly number[],
    markers: readonly OrderMarker[],
    box: SelectionBox | null,
    placement?: readonly PlacementPreviewItem[],
  ): void {
    this.interactionSelectedIds = selectedIds;
    this.interactionMarkers = markers;
    this.interactionBox = box;
    this.interactionPlacement = placement;
  }

  toggleDebugGrid(): boolean {
    return this.overlays ? this.overlays.toggleGrid() : false;
  }

  getEntityScreenRect(id: number): EntityScreenRect | undefined {
    const cached = this.entityRectMap.get(id);
    if (cached && cached.stamp === this.rectStamp) {
      return cached;
    }
    return undefined;
  }

  pickEntity(x: number, y: number): number | undefined {
    return pickFrontmost(this.entityRectPool, this.entityRectCount, x, y);
  }

  getPortrait(entity: {
    kind?: string;
    type?: string;
  }): PortraitMetadata | undefined {
    const asset = getAssetForEntity(entity);
    const loaded = this.loadedAtlases.get(asset);
    if (!loaded) return undefined;

    const frameKey = entity.kind === 'unit' ? 'walk/0/0' : 'idle/0/0';
    const frame =
      loaded.atlas.frames[frameKey] ?? Object.values(loaded.atlas.frames)[0];
    if (!frame) return undefined;

    const page = loaded.pages[frame.page];
    const url = page?.body?.url;
    if (!url) return undefined;

    return {
      url,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
    };
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
      try {
        const loaded = await this.atlasCache!.load(id);
        this.loadedAtlases.set(id, loaded);
        return loaded;
      } catch (err) {
        console.warn(`Failed to load atlas ${id}:`, err);
        return null;
      }
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
    this.assetSpriteTopPx.clear();
    for (const [assetId, loaded] of this.loadedAtlases.entries()) {
      let maxAy = 0;
      const isBuilding =
        assetId === 'crown_keep' ||
        assetId === 'crown_cottage' ||
        assetId === 'crown_farm' ||
        assetId === 'crown_storehouse' ||
        assetId === 'crown_chapel' ||
        assetId === 'crown_barracks' ||
        assetId === 'crown_archery_range' ||
        assetId === 'crown_stable' ||
        assetId === 'crown_siege_workshop' ||
        assetId === 'gold_mine';
      for (const [key, frame] of Object.entries(loaded.atlas.frames)) {
        if (isBuilding && !key.startsWith('idle/')) {
          continue;
        }
        if (frame.ay > maxAy) {
          maxAy = frame.ay;
        }
      }
      if (maxAy === 0) {
        for (const frame of Object.values(loaded.atlas.frames)) {
          if (frame.ay > maxAy) {
            maxAy = frame.ay;
          }
        }
      }
      this.assetSpriteTopPx.set(assetId, maxAy);
    }

    this.staticDescriptors.clear();
    const staticAssets = [
      'crown_keep',
      'crown_cottage',
      'crown_farm',
      'crown_storehouse',
      'crown_chapel',
      'crown_barracks',
      'crown_archery_range',
      'crown_stable',
      'crown_siege_workshop',
      'gold_mine',
      'tree_1',
      'tree_2',
      'tree_3',
      'tree_4',
      'rock_1',
      'rock_2',
      'calib_tile',
    ];

    for (let c = 0; c < staticAssets.length; c++) {
      const asset = staticAssets[c];
      const loaded = this.loadedAtlases.get(asset);
      if (!loaded) continue;
      const frame = loaded.atlas.frames['idle/0/0'];
      if (!frame) continue;
      const batch = this.batches.get(`${asset}_${frame.page}`);
      if (!batch) continue;
      this.staticDescriptors.set(asset, {
        batch,
        frame,
      });
    }

    this.buildingConstructDescriptors.clear();
    for (const [assetId, loaded] of this.loadedAtlases.entries()) {
      const constructMeta = loaded.atlas.anims['construct'];
      if (!constructMeta) continue;
      const constructFrames: StaticEntityDescriptor[] = [];
      for (let f = 0; f < constructMeta.frames; f++) {
        const frameKey = `construct/0/${f}`;
        const frame = loaded.atlas.frames[frameKey];
        if (frame) {
          const batch = this.batches.get(`${assetId}_${frame.page}`);
          if (batch) {
            constructFrames.push({ batch, frame });
          }
        }
      }
      if (constructFrames.length > 0) {
        this.buildingConstructDescriptors.set(assetId, constructFrames);
      }
    }

    this.unitAssetAnims.clear();
    this.unitAnimTables.clear();
    this.unitAnimFps.clear();
    this.unitAnimLoop.clear();
    this.unitWalkTables.clear();
    this.unitFps.clear();

    for (const [assetId, loaded] of this.loadedAtlases.entries()) {
      const defaultFps = loaded.atlas.fps || 12;
      const anims: Record<string, UnitAnimationData> = {};
      for (const [animName, animMeta] of Object.entries(loaded.atlas.anims)) {
        const dirs = animMeta.dirs;
        const frames = animMeta.frames;
        const fps = defaultFps;
        const isLoop = animMeta.loop ?? true;
        const key = `${assetId}_${animName}`;

        this.unitAnimFps.set(key, fps);
        this.unitAnimLoop.set(key, isLoop);

        const table: UnitFrameEntry[][] = [];
        for (let dir = 0; dir < 8; dir++) {
          const row: UnitFrameEntry[] = [];
          const dirKey = dirs === 8 ? dir : 0;
          for (let f = 0; f < frames; f++) {
            const frameKey = `${animName}/${dirKey}/${f}`;
            const frame = loaded.atlas.frames[frameKey];
            if (frame) {
              const batch = this.batches.get(`${assetId}_${frame.page}`);
              if (batch) {
                row.push({ batch, frame });
              }
            }
          }
          table.push(row);
        }
        this.unitAnimTables.set(key, table);

        anims[animName] = { table, fps, isLoop };

        if (animName === 'walk') {
          this.unitWalkTables.set(assetId, table);
          this.unitFps.set(assetId, fps);
        }
      }
      this.unitAssetAnims.set(assetId, anims);
    }

    this.isReady = true;
  }

  private recordEntityScreenRect(
    id: number,
    kind: string,
    anchorX: number,
    anchorZ: number,
    frame: AtlasFrame,
    spriteTopPx: number,
  ): void {
    if (!this.camera) return;
    const view = this.camera.view;

    let cached = this.entityRectMap.get(id);
    if (!cached) {
      cached = {
        id,
        kind,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        depth: 0,
        frameAy: 0,
        spriteTopPx: 0,
        stamp: 0,
      };
      this.entityRectMap.set(id, cached);
    }

    writeSpriteScreenRect(
      cached,
      id,
      kind,
      anchorX,
      anchorZ,
      frame,
      view,
      this.rectStamp,
    );
    cached.spriteTopPx = spriteTopPx;

    if (this.entityRectCount >= this.entityRectPool.length) {
      this.entityRectPool.push(cached);
    } else {
      this.entityRectPool[this.entityRectCount] = cached;
    }
    this.entityRectCount++;
  }

  render(snapshot?: SessionSnapshot, timeSeconds?: number): void {
    if (this.isDisposed || this.scene.isDisposed || this.engine.isDisposed) {
      return;
    }

    const t =
      timeSeconds ??
      (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

    // Update animated terrain (water UV scrolling)
    if (this.terrain) {
      this.terrain.update(t);
    }

    this.rectStamp++;
    if (this.rectStamp === 0x7fffffff) {
      this.rectStamp = 1;
      for (const rect of this.entityRectMap.values()) {
        rect.stamp = 0;
      }
    }
    this.entityRectCount = 0;

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

          const asset = getAssetForEntity(ent);
          const raw = ent.raw;
          const hasPath =
            'path' in raw && Array.isArray(raw.path) && raw.path.length > 0;

          // Select animation based on actual sim state
          const isMoving =
            Math.abs(ent.x - ent.previousX) > 0.0001 ||
            Math.abs(ent.z - ent.previousZ) > 0.0001 ||
            (ent.simX !== undefined &&
              (Math.abs(ent.simX - ent.previousX) > 0.0001 ||
                Math.abs(ent.simZ - ent.previousZ) > 0.0001)) ||
            hasPath;

          const isCartLoading =
            ent.workAnimation === 'load' || ent.cart?.phase === 'loading';

          const isWorking = ent.workAnimation === 'work';

          const animName = isMoving
            ? 'walk'
            : isCartLoading
              ? 'load'
              : isWorking
                ? 'work'
                : 'idle';

          const assetAnims = this.unitAssetAnims.get(asset);
          const animData =
            assetAnims?.[animName] ?? assetAnims?.idle ?? assetAnims?.walk;
          const table = animData?.table ?? this.unitWalkTables.get(asset);

          if (table) {
            const dir = (((ent.facing ?? 0) % 8) + 8) % 8;
            const dirRow = table[dir] ?? table[0];
            if (dirRow && dirRow.length > 0) {
              const fps = animData?.fps ?? this.unitFps.get(asset) ?? 12;
              const isLoop = animData?.isLoop ?? animName !== 'load';

              let frameIdx: number;
              const startTick = ent.workStartedTick;
              const cartTicks = ent.cart?.ticks;

              if (!isLoop) {
                // Nonloop clamping: elapsed advances frames, then holds on last frame
                let elapsed = t;
                if (startTick !== undefined) {
                  elapsed = Math.max(
                    0,
                    (snapshot.tick - startTick + snapshot.alpha) * 0.05,
                  );
                } else if (typeof cartTicks === 'number') {
                  elapsed = Math.max(0, (cartTicks + snapshot.alpha) * 0.05);
                }
                frameIdx = Math.min(
                  dirRow.length - 1,
                  Math.max(0, Math.floor(elapsed * fps)),
                );
              } else {
                let elapsed = t;
                if (startTick !== undefined) {
                  elapsed = Math.max(
                    0,
                    (snapshot.tick - startTick + snapshot.alpha) * 0.05,
                  );
                }
                frameIdx = Math.floor(elapsed * fps) % dirRow.length;
              }
              const entry = dirRow[frameIdx];
              if (entry) {
                this.scratchSprite.asset = asset;
                this.scratchSprite.animation = animName;
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

                this.recordEntityScreenRect(
                  ent.id,
                  'unit',
                  anchorX,
                  anchorZ,
                  entry.frame,
                  this.assetSpriteTopPx.get(asset) ?? entry.frame.ay,
                );
              }
            }
          }
        } else if (kind === 'building') {
          const asset = getAssetForEntity(ent);
          let desc: StaticEntityDescriptor | undefined;
          let animName = 'idle';

          // Construction progress 0 / .5 / 1
          if (
            ent.built === false ||
            (ent.buildProgress !== undefined &&
              ent.buildProgress < 1 &&
              !ent.built)
          ) {
            const constructFrames =
              this.buildingConstructDescriptors.get(asset);
            if (constructFrames && constructFrames.length > 0) {
              const progress = Math.max(0, Math.min(1, ent.buildProgress ?? 0));
              const frameIdx =
                progress < 0.5
                  ? 0
                  : progress < 1.0
                    ? 1
                    : Math.min(2, constructFrames.length - 1);
              desc =
                constructFrames[Math.min(frameIdx, constructFrames.length - 1)];
              animName = 'construct';
            }
          }

          if (!desc) {
            desc = this.staticDescriptors.get(asset);
            if (!desc && asset.startsWith('crown_')) {
              desc = this.staticDescriptors.get('crown_keep');
            }
          }

          if (desc) {
            const posX = ent.x + (ent.width ?? 1) * 0.5;
            const posZ = ent.z + (ent.height ?? 1) * 0.5;

            this.scratchSprite.asset = asset;
            this.scratchSprite.animation = animName;
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = posX;
            this.scratchSprite.z = posZ;
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

            this.recordEntityScreenRect(
              ent.id,
              'building',
              posX,
              posZ,
              desc.frame,
              this.assetSpriteTopPx.get(asset) ?? desc.frame.ay,
            );
          }
        } else if (kind === 'mine') {
          const asset = getAssetForEntity(ent);
          const desc = this.staticDescriptors.get(asset);
          if (desc) {
            const posX = ent.x + (ent.width ?? 2) * 0.5;
            const posZ = ent.z + (ent.height ?? 2) * 0.5;

            this.scratchSprite.asset = asset;
            this.scratchSprite.animation = 'idle';
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = posX;
            this.scratchSprite.z = posZ;
            this.scratchSprite.tint = TINT_NEUTRAL;
            this.scratchSprite.alpha = 1.0;

            desc.batch.add(desc.frame, this.scratchSprite);
            spriteCount++;
            shadowCount++;

            this.recordEntityScreenRect(
              ent.id,
              'mine',
              posX,
              posZ,
              desc.frame,
              this.assetSpriteTopPx.get(asset) ?? desc.frame.ay,
            );
          }
        } else if (kind === 'doodad') {
          const asset = getAssetForEntity(ent);
          const desc = this.staticDescriptors.get(asset);
          if (desc) {
            const posX = ent.x + 0.5;
            const posZ = ent.z + 0.5;

            this.scratchSprite.asset = asset;
            this.scratchSprite.animation = 'idle';
            this.scratchSprite.facing = 0;
            this.scratchSprite.x = posX;
            this.scratchSprite.z = posZ;
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

    // Update overlays with interaction state before rendering the scene
    if (this.overlays && this.camera) {
      this.overlayInput.snapshot = snapshot;
      this.overlayInput.view = this.camera.view;
      this.overlayInput.selectedIds = this.interactionSelectedIds;
      this.overlayInput.markers = this.interactionMarkers;
      this.overlayInput.box = this.interactionBox;
      this.overlayInput.timeSeconds = t;
      this.overlayInput.placement = this.interactionPlacement;
      this.overlays.update(this.overlayInput);
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
    this.buildingConstructDescriptors.clear();
    this.unitAnimTables.clear();
    this.unitAssetAnims.clear();
    this.unitAnimFps.clear();
    this.unitAnimLoop.clear();
    this.unitWalkTables.clear();
    this.unitFps.clear();
    this.assetSpriteTopPx.clear();

    this.unitShadows?.dispose();
    this.unitShadows = null;

    this.atlasCache?.dispose();
    this.atlasCache = null;

    this.terrain?.dispose();
    this.terrain = null;

    this.overlays?.dispose();
    this.overlays = null;

    this.entityRectCount = 0;
    this.entityRectMap.clear();
    this.entityRectPool.length = 0;
    this.rectStamp = 0;
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
