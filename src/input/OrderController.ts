import type { GameSession } from '../game/GameSession';
import type { SelectionController } from './SelectionController';
import type { BuildingEntity, UnitEntity } from '../sim/entity';
import { screenToGround } from '../render/iso';
import type { CardAction, CommandSlot } from '../ui/commandSlots';
import type { PlacementController } from './PlacementController';
import { getUnitData } from '../data/units';
import {
  isCartType,
  isFarmType,
  isProductionType,
  isWorkerType,
} from '../data/roles';
import type { OrderMarker } from '../render/Overlays';

export type { OrderMarker };

const MARKER_DURATION_SEC = 1.0;
const MAX_MARKERS = 32;

export class OrderController {
  private readonly session: GameSession;
  private readonly selection: SelectionController;

  public mode: 'move' | 'attackMove' | null = null;
  public submenu: 'economic' | 'military' | null = null;
  public placement: PlacementController | null = null;

  public get placementBuilding(): string | null {
    return this.placement?.buildingType ?? null;
  }
  private readonly markerPool: OrderMarker[] = [];
  private markerCount = 0;
  private readonly exposedMarkers: OrderMarker[] = [];

  private isDisposed = false;
  private readonly unbindSelectionChange: () => void;

  constructor(session: GameSession, selection: SelectionController) {
    this.session = session;
    this.selection = selection;

    for (let i = 0; i < MAX_MARKERS; i++) {
      this.markerPool.push({ x: 0, z: 0, kind: 'move', expiresAt: 0 });
    }

    this.unbindSelectionChange = this.selection.addSelectionChangeListener(
      () => {
        this.clearModeAndSubmenu();
      },
    );
  }

  get markers(): readonly OrderMarker[] {
    this.exposedMarkers.length = this.markerCount;
    for (let i = 0; i < this.markerCount; i++) {
      this.exposedMarkers[i] = this.markerPool[i];
    }
    return this.exposedMarkers;
  }

  public clearModeAndSubmenu(): void {
    this.mode = null;
    this.submenu = null;
    if (this.placement?.active) {
      this.placement.cancel();
    }
  }

  public executeSlot(slot: CommandSlot): void {
    if (this.isDisposed) return;
    if (slot.disabled) {
      if (slot.reason) {
        this.session.showStatus(slot.reason);
      }
      return;
    }
    if (!slot.action) return;

    if (slot.action === 'build' && slot.buildingType) {
      if (this.placement) {
        this.placement.start(slot.buildingType);
      }
      return;
    }

    if (slot.action === 'train' && slot.unitType) {
      const sim = this.session.sim;
      if (!sim) return;
      // The slot already resolved the building that can take the order; selection scan is the fallback.
      const ids =
        slot.buildingId !== undefined ? [slot.buildingId] : this.selection.ids;
      for (let i = 0; i < ids.length; i++) {
        const ent = sim.world.getEntity(ids[i]);
        if (
          ent &&
          ent.kind === 'building' &&
          ent.player === 0 &&
          ent.hp > 0 &&
          ent.built &&
          getUnitData(slot.unitType, ent.faction)?.from === ent.type
        ) {
          this.session.issue({
            kind: 'train',
            player: 0,
            buildingId: ent.id,
            unitType: slot.unitType,
          });
          break;
        }
      }
      return;
    }

    if (
      (slot.action === 'research' || slot.action === 'cancelResearch') &&
      slot.buildingId !== undefined
    ) {
      const ent = this.session.sim?.world.getEntity(slot.buildingId);
      if (
        !ent ||
        ent.kind !== 'building' ||
        ent.player !== 0 ||
        ent.hp <= 0 ||
        !this.selection.ids.includes(ent.id)
      ) {
        return;
      }
      if (slot.action === 'research' && slot.upgradeId) {
        this.session.issue({
          kind: 'research',
          player: 0,
          buildingId: ent.id,
          upgradeId: slot.upgradeId,
        });
      } else if (slot.action === 'cancelResearch') {
        this.session.issue({
          kind: 'cancelResearch',
          player: 0,
          buildingId: ent.id,
        });
      }
      return;
    }

    this.execute(slot.action);
  }

  public execute(action: CardAction): void {
    if (this.isDisposed) return;
    if (this.placement?.active) {
      this.placement.cancel();
    }
    const sim = this.session.sim;
    const ids = this.selection.ids;

    // Filter own units and buildings
    const ownEntities: (UnitEntity | BuildingEntity)[] = [];
    if (sim) {
      for (let i = 0; i < ids.length; i++) {
        const ent = sim.world.getEntity(ids[i]);
        if (
          ent &&
          (ent.kind === 'unit' || ent.kind === 'building') &&
          ent.player === 0 &&
          ent.hp > 0
        ) {
          ownEntities.push(ent);
        }
      }
    }
    const ownUnits = ownEntities.filter(
      (e): e is UnitEntity => e.kind === 'unit',
    );
    const ownUnitIds = ownUnits.map((e) => e.id);
    const hasOwnWorker = ownUnits.some((e) => isWorkerType(e.type));
    switch (action) {
      case 'move':
        this.mode = 'move';
        break;

      case 'attackMove':
        this.mode = 'attackMove';
        break;

      case 'stop':
        this.mode = null;
        if (ownUnitIds.length > 0) {
          this.session.issue({
            kind: 'stop',
            player: 0,
            ids: ownUnitIds,
            queued: false,
          });
        }
        break;

      case 'hold':
        this.mode = null;
        if (ownUnitIds.length > 0) {
          this.session.issue({
            kind: 'hold',
            player: 0,
            ids: ownUnitIds,
            queued: false,
          });
        }
        break;

      case 'delete':
        this.mode = null;
        if (ownEntities.length > 0) {
          this.session.issue({
            kind: 'delete',
            player: 0,
            ids: ownEntities.map((e) => e.id),
            queued: false,
          });
          this.selection.clear();
        }
        break;

      case 'economic':
        if (hasOwnWorker) {
          this.submenu = 'economic';
        } else {
          this.session.showStatus(
            'Economic buildings require an owned peasant',
          );
        }
        break;

      case 'military':
        if (hasOwnWorker) {
          this.submenu = 'military';
        } else {
          this.session.showStatus(
            'Military buildings require an owned peasant',
          );
        }
        break;

      case 'back':
        this.submenu = null;
        this.mode = null;
        break;
    }
  }

  public handleOrderClick(screenX: number, screenY: number): boolean {
    if (this.mode === null) return false;
    const cam = this.session.renderer?.camera;
    if (!cam) {
      this.mode = null;
      return true;
    }

    const ground = screenToGround(screenX, screenY, cam.view);
    const activeMode = this.mode;
    this.mode = null;

    const sim = this.session.sim;
    if (!sim) return true;

    const ids = this.selection.ids;
    const ownUnitIds: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ent = sim.world.getEntity(ids[i]);
      if (ent && ent.kind === 'unit' && ent.player === 0 && ent.hp > 0) {
        ownUnitIds.push(ent.id);
      }
    }

    if (ownUnitIds.length === 0) return true;

    if (activeMode === 'move') {
      this.session.issue({
        kind: 'move',
        player: 0,
        ids: ownUnitIds,
        x: ground.x,
        z: ground.z,
        queued: false,
      });
      this.addMarker(ground.x, ground.z, 'move');
    } else if (activeMode === 'attackMove') {
      this.session.issue({
        kind: 'attackMove',
        player: 0,
        ids: ownUnitIds,
        x: ground.x,
        z: ground.z,
        queued: false,
      });
      this.addMarker(ground.x, ground.z, 'attackMove');
    }

    return true;
  }

  public contextOrder(
    targetX: number,
    targetZ: number,
    queued: boolean,
    targetId?: number,
  ): void {
    if (this.isDisposed) return;
    const sim = this.session.sim;
    if (!sim) return;

    // Reset mode if a right-click occurs
    this.mode = null;

    const ids = this.selection.ids;
    if (ids.length === 0) return;

    const ownEntities: (UnitEntity | BuildingEntity)[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ent = sim.world.getEntity(ids[i]);
      if (
        ent &&
        (ent.kind === 'unit' || ent.kind === 'building') &&
        ent.player === 0 &&
        ent.hp > 0
      ) {
        ownEntities.push(ent);
      }
    }
    if (ownEntities.length === 0) return;

    const ownUnits = ownEntities.filter(
      (e): e is UnitEntity => e.kind === 'unit',
    );
    const ownBuildings = ownEntities.filter(
      (e): e is BuildingEntity => e.kind === 'building',
    );

    // 1. Rally Precedence: if ONLY own buildings are selected
    if (ownUnits.length === 0 && ownBuildings.length > 0) {
      const prodBuildings = ownBuildings.filter((b) =>
        isProductionType(b.type),
      );
      const pickedEntity =
        targetId !== undefined ? sim.world.getEntity(targetId) : undefined;
      const rallyTarget =
        pickedEntity &&
        (pickedEntity.kind === 'unit' || pickedEntity.kind === 'building') &&
        pickedEntity.player === 0
          ? pickedEntity.id
          : undefined;
      for (let i = 0; i < prodBuildings.length; i++) {
        this.session.issue({
          kind: 'setRally',
          player: 0,
          buildingId: prodBuildings[i].id,
          x: targetX,
          z: targetZ,
          ...(rallyTarget !== undefined && rallyTarget !== prodBuildings[i].id
            ? { targetId: rallyTarget }
            : {}),
        });
      }
      return;
    }

    const ownUnitIds = ownUnits.map((e) => e.id);
    // Look up target entity if provided
    const targetEntity =
      targetId !== undefined ? sim.world.getEntity(targetId) : undefined;

    // 2. Enemy target -> attack (Combat M7)
    if (
      targetEntity &&
      (targetEntity.kind === 'unit' || targetEntity.kind === 'building') &&
      targetEntity.player !== 0
    ) {
      this.session.showStatus('Combat system requires Milestone 7');
      return;
    }

    // 3. Gold mine with cart precedence -> pin mine (Economy M5)
    if (targetEntity && targetEntity.kind === 'mine') {
      const ownCarts = ownUnits.filter((e) => isCartType(e.type));
      if (ownCarts.length > 0) {
        this.session.issue({
          kind: 'pinMine',
          player: 0,
          ids: ownCarts.map((e) => e.id),
          targetId: targetEntity.id,
          queued,
        });
        this.addMarker(targetEntity.x, targetEntity.z, 'move');
        return;
      }
    }

    const hasWorker = ownUnits.some((e) => isWorkerType(e.type));

    // 4. Built farm with worker precedence -> farm (Economy M5)
    if (
      targetEntity &&
      targetEntity.kind === 'building' &&
      isFarmType(targetEntity.type) &&
      targetEntity.built
    ) {
      if (hasWorker) {
        const ownWorkers = ownUnits.filter((e) => isWorkerType(e.type));
        this.session.issue({
          kind: 'farm',
          player: 0,
          ids: ownWorkers.map((e) => e.id),
          targetId: targetEntity.id,
          queued,
        });
        this.addMarker(targetEntity.x, targetEntity.z, 'move');
        return;
      }
    }

    // 5. Own unfinished building with worker precedence -> build (M5)
    if (
      targetEntity &&
      targetEntity.kind === 'building' &&
      targetEntity.player === 0 &&
      !targetEntity.built
    ) {
      if (hasWorker) {
        const ownWorkers = ownUnits.filter((e) => isWorkerType(e.type));
        this.session.issue({
          kind: 'build',
          player: 0,
          ids: ownWorkers.map((e) => e.id),
          buildingType: targetEntity.type,
          x: targetEntity.x,
          z: targetEntity.z,
          orientation: targetEntity.orientation,
          targetId: targetEntity.id,
          queued,
        });
        this.addMarker(targetEntity.x, targetEntity.z, 'move');
        return;
      }
    }

    // 6. Own damaged building with worker precedence -> repair (M5)
    if (
      targetEntity &&
      targetEntity.kind === 'building' &&
      targetEntity.player === 0 &&
      targetEntity.built &&
      targetEntity.hp < targetEntity.maxHp
    ) {
      if (hasWorker) {
        const ownWorkers = ownUnits.filter((e) => isWorkerType(e.type));
        this.session.issue({
          kind: 'repair',
          player: 0,
          ids: ownWorkers.map((e) => e.id),
          targetId: targetEntity.id,
          queued,
        });
        this.addMarker(targetEntity.x, targetEntity.z, 'move');
        return;
      }
    }

    // 6. Ground move (or default move to target position)
    this.session.issue({
      kind: 'move',
      player: 0,
      ids: ownUnitIds,
      x: targetX,
      z: targetZ,
      queued,
    });
    this.addMarker(targetX, targetZ, 'move');
  }

  public addMarker(x: number, z: number, kind: 'move' | 'attackMove'): void {
    const expiresAt = performance.now() / 1000 + MARKER_DURATION_SEC;
    if (this.markerCount < MAX_MARKERS) {
      const slot = this.markerPool[this.markerCount++];
      slot.x = x;
      slot.z = z;
      slot.kind = kind;
      slot.expiresAt = expiresAt;
    } else {
      // Shift oldest out
      for (let i = 0; i < MAX_MARKERS - 1; i++) {
        const next = this.markerPool[i + 1];
        const cur = this.markerPool[i];
        cur.x = next.x;
        cur.z = next.z;
        cur.kind = next.kind;
        cur.expiresAt = next.expiresAt;
      }
      const last = this.markerPool[MAX_MARKERS - 1];
      last.x = x;
      last.z = z;
      last.kind = kind;
      last.expiresAt = expiresAt;
    }
  }

  public update(nowSec: number): void {
    if (this.isDisposed) return;

    // In-place prune expired markers without allocations
    let writeIdx = 0;
    for (let i = 0; i < this.markerCount; i++) {
      const m = this.markerPool[i];
      if (m.expiresAt > nowSec) {
        if (writeIdx !== i) {
          const dest = this.markerPool[writeIdx];
          dest.x = m.x;
          dest.z = m.z;
          dest.kind = m.kind;
          dest.expiresAt = m.expiresAt;
        }
        writeIdx++;
      }
    }
    this.markerCount = writeIdx;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.unbindSelectionChange();
    this.markerCount = 0;
    this.exposedMarkers.length = 0;
  }
}
