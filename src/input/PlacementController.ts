import type { GameSession } from '../game/GameSession';
import type { SelectionController } from './SelectionController';
import type { BuildingEntity } from '../sim/entity';
import type { World } from '../sim/world';
import { screenToGround } from '../render/iso';
import { getBuildingData } from '../data/buildings';
import { isWorkerType } from '../data/roles';
import { validatePlacement } from '../sim/systems/construction';

export interface PlacementPreview {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly valid: boolean;
}

export function computeWallTiles(
  start: { x: number; z: number },
  end: { x: number; z: number },
): Array<{ x: number; z: number }> {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const stepX = dx >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;
  const absDx = Math.abs(dx);
  const absDz = Math.abs(dz);

  const tiles: Array<{ x: number; z: number }> = [];

  if (absDx === 0 && absDz === 0) {
    tiles.push({ x: start.x, z: start.z });
    return tiles;
  }

  // Straight horizontal line
  if (absDz === 0) {
    for (let x = start.x; x !== end.x + stepX; x += stepX) {
      tiles.push({ x, z: start.z });
    }
    return tiles;
  }

  // Straight vertical line
  if (absDx === 0) {
    for (let z = start.z; z !== end.z + stepZ; z += stepZ) {
      tiles.push({ x: start.x, z });
    }
    return tiles;
  }

  // L-shape: primary axis first, then secondary
  if (absDx >= absDz) {
    // Horizontal segment first
    for (let x = start.x; x !== end.x + stepX; x += stepX) {
      tiles.push({ x, z: start.z });
    }
    // Vertical segment next (skip duplicate corner at end.x, start.z)
    for (let z = start.z + stepZ; z !== end.z + stepZ; z += stepZ) {
      tiles.push({ x: end.x, z });
    }
  } else {
    // Vertical segment first
    for (let z = start.z; z !== end.z + stepZ; z += stepZ) {
      tiles.push({ x: start.x, z });
    }
    // Horizontal segment next (skip duplicate corner at start.x, end.z)
    for (let x = start.x + stepX; x !== end.x + stepX; x += stepX) {
      tiles.push({ x, z: end.z });
    }
  }

  return tiles;
}

export function inferGateOrientation(
  world: World | undefined,
  tileX: number,
  tileZ: number,
): 'horizontal' | 'vertical' | null {
  if (!world) return null;

  let horizontalWallCount = 0;
  let verticalWallCount = 0;

  for (const ent of world.entities.values()) {
    if (!ent || ent.kind !== 'building') continue;
    const isWall =
      ent.type === 'stone_wall' ||
      ent.type === 'palisade' ||
      getBuildingData(ent.type)?.isWall === true;
    if (!isWall) continue;

    // Check horizontal run: nearby in same row
    if (ent.z === tileZ && ent.x >= tileX - 2 && ent.x <= tileX + 4) {
      horizontalWallCount++;
    }
    // Check vertical run: nearby in same column
    if (ent.x === tileX && ent.z >= tileZ - 2 && ent.z <= tileZ + 4) {
      verticalWallCount++;
    }
  }

  if (horizontalWallCount > verticalWallCount) return 'horizontal';
  if (verticalWallCount > horizontalWallCount) return 'vertical';
  return null;
}

export function getBuildingDimensions(
  buildingType: string,
  orientation: 'horizontal' | 'vertical',
): { width: number; height: number; isWall: boolean; isGate: boolean } {
  const bData = getBuildingData(buildingType);
  if (!bData) {
    return { width: 1, height: 1, isWall: false, isGate: false };
  }
  const isWall =
    bData.isWall === true ||
    buildingType === 'stone_wall' ||
    buildingType === 'palisade';
  const isGate = bData.isGate === true || buildingType.includes('gate');

  let width = bData.width;
  let height = bData.height;

  if (isGate && bData.gateOrientations) {
    const dims = bData.gateOrientations[orientation];
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  }

  return { width, height, isWall, isGate };
}

export class PlacementController {
  private readonly session: GameSession;
  private readonly selection: SelectionController;

  public active = false;
  public buildingType: string | null = null;
  public orientation: 'horizontal' | 'vertical' = 'horizontal';

  private _preview: readonly PlacementPreview[] = [];
  private lastHoverGround: { x: number; z: number } | null = null;
  private lastHoverTile: { x: number; z: number } | null = null;
  private manualOrientation = false;
  private issuedThisSession = 0;

  private isDragging = false;
  private dragStartTile: { x: number; z: number } | null = null;
  private dragCurrentTile: { x: number; z: number } | null = null;

  public lastInvalidReason: string | undefined = undefined;
  private isDisposed = false;
  private readonly unbindSelectionChange: () => void;

  constructor(session: GameSession, selection: SelectionController) {
    this.session = session;
    this.selection = selection;

    this.unbindSelectionChange = this.selection.addSelectionChangeListener(
      () => {
        this.cancel();
      },
    );
  }

  public get preview(): readonly PlacementPreview[] {
    return this._preview;
  }

  public start(buildingType: string): void {
    if (this.isDisposed) return;
    this.active = true;
    this.buildingType = buildingType;
    this.orientation = 'horizontal';
    this.manualOrientation = false;
    this.issuedThisSession = 0;
    this.isDragging = false;
    this.dragStartTile = null;
    this.dragCurrentTile = null;
    this.lastInvalidReason = undefined;

    if (this.lastHoverGround) {
      const tileX = Math.floor(this.lastHoverGround.x);
      const tileZ = Math.floor(this.lastHoverGround.z);
      this.lastHoverTile = { x: tileX, z: tileZ };

      const { isGate } = getBuildingDimensions(buildingType, this.orientation);
      if (isGate) {
        const inferred = inferGateOrientation(
          this.session.sim?.world,
          tileX,
          tileZ,
        );
        if (inferred) {
          this.orientation = inferred;
        }
      }
      this.updatePreview();
    }
  }

  public cancel(): void {
    this.active = false;
    this.buildingType = null;
    this.isDragging = false;
    this.dragStartTile = null;
    this.dragCurrentTile = null;
    this._preview = [];
    this.lastInvalidReason = undefined;
    this.manualOrientation = false;
    this.issuedThisSession = 0;
  }

  public rotate(): void {
    if (!this.active) return;
    this.orientation =
      this.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    this.manualOrientation = true;
    this.updatePreview();
  }

  public handlePointerMove(
    screenX: number,
    screenY: number,
    _shiftKey?: boolean,
  ): void {
    void _shiftKey;
    if (this.isDisposed) return;
    const cam = this.session.renderer?.camera;
    if (!cam) return;

    const ground = screenToGround(screenX, screenY, cam.view);
    this.lastHoverGround = { x: ground.x, z: ground.z };

    if (!this.active || !this.buildingType) return;

    const tileX = Math.floor(ground.x);
    const tileZ = Math.floor(ground.z);

    const tileChanged =
      !this.lastHoverTile ||
      this.lastHoverTile.x !== tileX ||
      this.lastHoverTile.z !== tileZ;
    if (tileChanged) {
      this.lastHoverTile = { x: tileX, z: tileZ };
      const { isGate } = getBuildingDimensions(
        this.buildingType,
        this.orientation,
      );
      if (isGate && !this.manualOrientation) {
        const inferred = inferGateOrientation(
          this.session.sim?.world,
          tileX,
          tileZ,
        );
        if (inferred) {
          this.orientation = inferred;
        }
      }
    }

    if (this.isDragging) {
      this.dragCurrentTile = { x: tileX, z: tileZ };
    }

    this.updatePreview();
  }

  public handlePointerDown(
    screenX: number,
    screenY: number,
    _shiftKey?: boolean,
  ): boolean {
    void _shiftKey;
    if (this.isDisposed || !this.active || !this.buildingType) return false;

    const cam = this.session.renderer?.camera;
    if (!cam) return false;

    const ground = screenToGround(screenX, screenY, cam.view);
    this.lastHoverGround = { x: ground.x, z: ground.z };
    const tileX = Math.floor(ground.x);
    const tileZ = Math.floor(ground.z);
    this.lastHoverTile = { x: tileX, z: tileZ };

    const { isWall } = getBuildingDimensions(
      this.buildingType,
      this.orientation,
    );

    if (isWall) {
      this.isDragging = true;
      this.dragStartTile = { x: tileX, z: tileZ };
      this.dragCurrentTile = { x: tileX, z: tileZ };
      this.updatePreview();
      return true;
    }

    return true;
  }

  public handlePointerUp(
    screenX: number,
    screenY: number,
    shiftKey: boolean,
  ): boolean {
    if (this.isDisposed || !this.active || !this.buildingType) return false;

    const cam = this.session.renderer?.camera;
    if (!cam) return false;

    const ground = screenToGround(screenX, screenY, cam.view);
    this.lastHoverGround = { x: ground.x, z: ground.z };
    const tileX = Math.floor(ground.x);
    const tileZ = Math.floor(ground.z);
    this.lastHoverTile = { x: tileX, z: tileZ };
    if (this.isDragging) this.dragCurrentTile = { x: tileX, z: tileZ };
    this.updatePreview();

    const { isWall } = getBuildingDimensions(
      this.buildingType,
      this.orientation,
    );

    const ownWorkerIds = this.getOwnWorkerIds();

    if (isWall) {
      const wallPreview = this._preview;

      this.isDragging = false;
      this.dragStartTile = null;
      this.dragCurrentTile = null;

      const validTiles = wallPreview.filter((tile) => tile.valid);

      if (validTiles.length === 0) {
        this.session.showStatus(
          this.lastInvalidReason ?? 'Cannot place wall here',
        );
      } else {
        for (let i = 0; i < validTiles.length; i++) {
          const t = validTiles[i];
          const unfinished = this.findUnfinishedBuilding(t.x, t.z);
          const isQueued = this.issuedThisSession > 0;
          this.session.issue({
            kind: 'build',
            player: 0,
            ids: ownWorkerIds,
            buildingType: this.buildingType,
            x: t.x,
            z: t.z,
            orientation: this.orientation,
            targetId:
              unfinished?.type === this.buildingType
                ? unfinished.id
                : undefined,
            queued: isQueued,
          });
          this.issuedThisSession++;
        }
      }

      if (shiftKey) {
        this.updatePreview();
      } else {
        this.cancel();
      }
      return true;
    }

    // Single building or gate
    const previewItem = this._preview[0];
    if (previewItem && previewItem.valid) {
      const unfinished = this.findUnfinishedBuilding(
        previewItem.x,
        previewItem.z,
      );

      this.session.issue({
        kind: 'build',
        player: 0,
        ids: ownWorkerIds,
        buildingType: this.buildingType,
        x: previewItem.x,
        z: previewItem.z,
        orientation: this.orientation,
        targetId: unfinished?.id,
        queued: this.issuedThisSession > 0,
      });
      this.issuedThisSession++;

      if (shiftKey) {
        this.updatePreview();
      } else {
        this.cancel();
      }
    } else {
      this.session.showStatus(
        this.lastInvalidReason ?? 'Cannot place building here',
      );
    }

    return true;
  }

  private updatePreview(): void {
    if (!this.active || !this.buildingType || !this.lastHoverGround) {
      this._preview = [];
      return;
    }

    this.lastInvalidReason = undefined;
    const { width, height, isWall } = getBuildingDimensions(
      this.buildingType,
      this.orientation,
    );

    const tileX = Math.floor(this.lastHoverGround.x);
    const tileZ = Math.floor(this.lastHoverGround.z);

    if (
      isWall &&
      this.isDragging &&
      this.dragStartTile &&
      this.dragCurrentTile
    ) {
      const tiles = computeWallTiles(this.dragStartTile, this.dragCurrentTile);
      const items: PlacementPreview[] = [];
      let newTileCount = 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const res = this.validateFootprint(
          this.buildingType,
          t.x,
          t.z,
          this.orientation,
        );
        if (!res.valid && res.reason) {
          this.lastInvalidReason = res.reason;
        }
        const unfinished = this.findUnfinishedBuilding(t.x, t.z);
        if (res.valid && unfinished?.type !== this.buildingType) newTileCount++;
        items.push({
          x: t.x,
          z: t.z,
          width: 1,
          height: 1,
          valid: res.valid,
        });
      }
      const data = getBuildingData(this.buildingType);
      const player = this.session.sim?.world.players[0];
      if (
        data &&
        player &&
        (player.food < data.food * newTileCount ||
          player.gold < data.gold * newTileCount)
      ) {
        this.lastInvalidReason = 'Not enough resources for wall run';
        for (let i = 0; i < items.length; i++) {
          items[i] = { ...items[i], valid: false };
        }
      }
      this._preview = items;
      return;
    }

    const res = this.validateFootprint(
      this.buildingType,
      tileX,
      tileZ,
      this.orientation,
    );
    if (!res.valid && res.reason) {
      this.lastInvalidReason = res.reason;
    }
    this._preview = [
      {
        x: tileX,
        z: tileZ,
        width,
        height,
        valid: res.valid,
      },
    ];
  }

  private validateFootprint(
    buildingType: string,
    x: number,
    z: number,
    orientation: 'horizontal' | 'vertical',
  ): { valid: boolean; reason?: string } {
    const sim = this.session.sim;
    if (!sim) {
      return { valid: false, reason: 'Simulation not ready' };
    }

    const unfinished = this.findUnfinishedBuilding(x, z);
    if (unfinished && unfinished.type === buildingType) {
      return { valid: true };
    }

    try {
      const res = validatePlacement(
        sim.world,
        0,
        buildingType,
        x,
        z,
        orientation,
      );
      return res;
    } catch {
      return { valid: false, reason: 'Invalid placement' };
    }
  }

  private findUnfinishedBuilding(
    x: number,
    z: number,
  ): BuildingEntity | undefined {
    const sim = this.session.sim;
    if (!sim) return undefined;
    for (const ent of sim.world.entities.values()) {
      if (
        ent &&
        ent.kind === 'building' &&
        ent.player === 0 &&
        !ent.built &&
        ent.x === x &&
        ent.z === z
      ) {
        return ent;
      }
    }
    return undefined;
  }

  private getOwnWorkerIds(): number[] {
    const sim = this.session.sim;
    if (!sim) return [];
    const ids = this.selection.ids;
    const workerIds: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ent = sim.world.getEntity(ids[i]);
      if (
        ent &&
        ent.kind === 'unit' &&
        ent.player === 0 &&
        ent.hp > 0 &&
        isWorkerType(ent.type)
      ) {
        workerIds.push(ent.id);
      }
    }
    return workerIds;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cancel();
    this.unbindSelectionChange();
  }
}
