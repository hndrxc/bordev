import type { GameSession } from '../game/GameSession';
import type { SelectionController } from './SelectionController';
import type { BuildingEntity, UnitEntity } from '../sim/entity';
import { screenToGround } from '../render/iso';
import { setHudStatus } from '../ui/hud';
import type { OrderMarker } from '../render/Overlays';

export type { OrderMarker };

const MARKER_DURATION_SEC = 1.0;
const MAX_MARKERS = 32;

export class OrderController {
  private readonly session: GameSession;
  private readonly selection: SelectionController;

  public mode: 'move' | 'attackMove' | null = null;
  public submenu: 'economic' | 'military' | null = null;

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
  }

  public execute(action: string): void {
    if (this.isDisposed) return;
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
    const ownUnitIds = ownEntities
      .filter((e) => e.kind === 'unit')
      .map((e) => e.id);
    const hasOwnPeasant = ownEntities.some(
      (e) =>
        e.kind === 'unit' &&
        (e.type === 'peasant' ||
          e.type === 'crown_peasant' ||
          e.type.includes('peasant') ||
          e.type.includes('thrall')),
    );

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
        if (hasOwnPeasant) {
          this.submenu = 'economic';
        } else {
          setHudStatus('Economic buildings require an owned peasant');
        }
        break;

      case 'military':
        if (hasOwnPeasant) {
          this.submenu = 'military';
        } else {
          setHudStatus('Military buildings require an owned peasant');
        }
        break;

      case 'setRally':
        setHudStatus('Right-click ground to set rally');
        break;
      case 'back':
        this.submenu = null;
        this.mode = null;
        break;

      // Truthful reporting for future systems
      case 'build':
      case 'farm':
      case 'pinMine':
      case 'repair':
        setHudStatus('Economy and construction require Milestone 5');
        break;

      case 'train':
      case 'cancelTrain':
      case 'research':
      case 'cancelResearch':
        setHudStatus('Production and research require Milestone 6');
        break;

      default:
        // Unknown action or future action
        setHudStatus(`Action '${action}' is unavailable`);
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

    // 1. Rally Precedence: if single own building is selected
    if (ownEntities.length === 1 && ownEntities[0].kind === 'building') {
      const bldg = ownEntities[0];
      this.session.issue({
        kind: 'setRally',
        player: 0,
        buildingId: bldg.id,
        x: targetX,
        z: targetZ,
      });
      return;
    }

    const ownUnitIds = ownEntities
      .filter((e) => e.kind === 'unit')
      .map((e) => e.id);
    if (ownUnitIds.length === 0) return;

    // Look up target entity if provided
    const targetEntity =
      targetId !== undefined ? sim.world.getEntity(targetId) : undefined;

    // 2. Enemy target -> attack (Combat M7)
    if (
      targetEntity &&
      (targetEntity.kind === 'unit' || targetEntity.kind === 'building') &&
      targetEntity.player !== 0
    ) {
      setHudStatus('Combat system requires Milestone 7');
      return;
    }

    // 3. Gold mine with cart precedence -> pin mine (Economy M5)
    if (
      targetEntity &&
      (targetEntity.kind === 'mine' ||
        (targetEntity.kind !== 'projectile' &&
          targetEntity.type === 'gold_mine'))
    ) {
      const hasCart = ownEntities.some(
        (e) =>
          e.kind === 'unit' &&
          (e.type.includes('cart') || e.type.includes('wagon')),
      );
      if (hasCart) {
        setHudStatus('Mining economy requires Milestone 5');
        return;
      }
    }

    // 4. Unworked farm with peasant precedence -> farm (Economy M5)
    if (
      targetEntity &&
      targetEntity.kind === 'building' &&
      targetEntity.type.includes('farm')
    ) {
      const hasPeasant = ownEntities.some(
        (e) =>
          e.kind === 'unit' &&
          (e.type.includes('peasant') || e.type.includes('thrall')),
      );
      if (hasPeasant) {
        setHudStatus('Farming economy requires Milestone 5');
        return;
      }
    }

    // 5. Own unfinished/damaged building with peasant precedence -> build/repair (M5)
    if (
      targetEntity &&
      targetEntity.kind === 'building' &&
      targetEntity.player === 0 &&
      (!targetEntity.built || targetEntity.hp < targetEntity.maxHp)
    ) {
      const hasPeasant = ownEntities.some(
        (e) =>
          e.kind === 'unit' &&
          (e.type.includes('peasant') || e.type.includes('thrall')),
      );
      if (hasPeasant) {
        if (!targetEntity.built) {
          setHudStatus('Building construction requires Milestone 5');
        } else {
          setHudStatus('Building repair requires Milestone 5');
        }
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
