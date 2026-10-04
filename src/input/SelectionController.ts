import type { GameSession } from '../game/GameSession';
import type { CameraController } from './CameraController';
import type { Entity } from '../sim/entity';
import type { SelectionBox } from '../render/Overlays';

export type { SelectionBox };

export class SelectionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly session: GameSession;
  private readonly cameraController: CameraController;

  private _ids: number[] = [];
  private readonly groups: Entity[][] = Array.from({ length: 10 }, () => []);

  // Marquee drag state
  private isMouseDown = false;
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;
  private _currentBox: SelectionBox | null = null;

  // Double click and double tap tracking
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;

  private lastGroupNum = -1;
  private lastGroupTime = 0;

  private isDisposed = false;
  private readonly selectionChangeListeners: (() => void)[] = [];
  constructor(
    canvas: HTMLCanvasElement,
    session: GameSession,
    cameraController: CameraController,
  ) {
    this.canvas = canvas;
    this.session = session;
    this.cameraController = cameraController;

    this.attachEvents();
  }

  get ids(): readonly number[] {
    return this._ids;
  }

  get currentBox(): SelectionBox | null {
    return this._currentBox;
  }

  public addSelectionChangeListener(listener: () => void): () => void {
    this.selectionChangeListeners.push(listener);
    return () => {
      const idx = this.selectionChangeListeners.indexOf(listener);
      if (idx !== -1) {
        this.selectionChangeListeners.splice(idx, 1);
      }
    };
  }

  private notifySelectionChange(): void {
    if (this.isDisposed) return;
    for (let i = 0; i < this.selectionChangeListeners.length; i++) {
      this.selectionChangeListeners[i]();
    }
  }

  public set(ids: readonly number[]): void {
    const unique: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!unique.includes(id)) {
        unique.push(id);
      }
    }
    this._ids = unique;
    this.notifySelectionChange();
  }

  public clear(): void {
    this._ids = [];
    this.notifySelectionChange();
  }

  private pruneGroup(group: Entity[]): void {
    if (group.length === 0) return;
    const sim = this.session.sim;
    if (!sim) {
      group.length = 0;
      return;
    }

    let writeIdx = 0;
    for (let i = 0; i < group.length; i++) {
      const ent = group[i];
      if (
        sim.world.getEntity(ent.id) === ent &&
        (ent.kind === 'unit' || ent.kind === 'building') &&
        ent.player === 0 &&
        ent.hp > 0
      ) {
        group[writeIdx++] = ent;
      }
    }
    group.length = writeIdx;
  }

  public update(): void {
    const sim = this.session.sim;
    if (!sim) return;

    // Prune dead/missing group members even with empty active selection
    for (let g = 0; g < this.groups.length; g++) {
      this.pruneGroup(this.groups[g]);
    }

    if (this._ids.length === 0) return;

    let hasDead = false;
    for (let i = 0; i < this._ids.length; i++) {
      const ent = sim.world.getEntity(this._ids[i]);
      if (
        !ent ||
        ((ent.kind === 'unit' || ent.kind === 'building') && ent.hp <= 0)
      ) {
        hasDead = true;
        break;
      }
    }

    if (hasDead) {
      let writeIdx = 0;
      for (let i = 0; i < this._ids.length; i++) {
        const id = this._ids[i];
        const ent = sim.world.getEntity(id);
        if (
          ent &&
          (ent.kind === 'mine' ||
            ((ent.kind === 'unit' || ent.kind === 'building') && ent.hp > 0))
        ) {
          this._ids[writeIdx++] = id;
        }
      }
      this._ids.length = writeIdx;
      this.notifySelectionChange();
    }
  }

  public selectGroup(groupNum: number): void {
    if (groupNum < 0 || groupNum > 9) return;
    const sim = this.session.sim;
    if (!sim) return;

    const group = this.groups[groupNum];
    this.pruneGroup(group);

    const validIds: number[] = [];
    for (let i = 0; i < group.length; i++) {
      validIds.push(group[i].id);
    }
    this.set(validIds);

    const now = performance.now();
    if (
      this.lastGroupNum === groupNum &&
      now - this.lastGroupTime < 300 &&
      group.length > 0
    ) {
      // Double tap: center camera on group
      let sumX = 0;
      let sumZ = 0;
      let count = 0;
      for (let i = 0; i < group.length; i++) {
        const ent = group[i];
        const targetX = ent.kind === 'building' ? ent.x + ent.width / 2 : ent.x;
        const targetZ =
          ent.kind === 'building' ? ent.z + ent.height / 2 : ent.z;
        sumX += targetX;
        sumZ += targetZ;
        count++;
      }
      if (count > 0) {
        this.cameraController.centerOn(sumX / count, sumZ / count);
      }
      this.lastGroupNum = -1;
    } else {
      this.lastGroupNum = groupNum;
      this.lastGroupTime = now;
    }
  }

  public assignGroup(groupNum: number): void {
    if (groupNum < 0 || groupNum > 9) return;
    const sim = this.session.sim;
    if (!sim) return;

    // Filter dead and enemy/neutral entities from group assignment
    const group = this.groups[groupNum];
    group.length = 0;
    for (let i = 0; i < this._ids.length; i++) {
      const ent = sim.world.getEntity(this._ids[i]);
      if (
        ent &&
        (ent.kind === 'unit' || ent.kind === 'building') &&
        ent.player === 0 &&
        ent.hp > 0
      ) {
        if (!group.includes(ent)) {
          group.push(ent);
        }
      }
    }
  }

  public handlePointerDown(screenX: number, screenY: number): void {
    this.isMouseDown = true;
    this.isDragging = false;
    this.startX = screenX;
    this.startY = screenY;
    this.currentX = screenX;
    this.currentY = screenY;
    this._currentBox = null;
  }

  public handlePointerMove(screenX: number, screenY: number): void {
    if (!this.isMouseDown) return;
    this.currentX = screenX;
    this.currentY = screenY;

    if (
      !this.isDragging &&
      Math.hypot(this.currentX - this.startX, this.currentY - this.startY) > 5
    ) {
      this.isDragging = true;
    }

    if (this.isDragging) {
      this._currentBox = {
        left: Math.min(this.startX, this.currentX),
        top: Math.min(this.startY, this.currentY),
        right: Math.max(this.startX, this.currentX),
        bottom: Math.max(this.startY, this.currentY),
      };
    }
  }

  public handlePointerUp(shiftKey: boolean): void {
    if (!this.isMouseDown) return;
    const wasDragging = this.isDragging;
    const box = this._currentBox;

    this.isMouseDown = false;
    this.isDragging = false;
    this._currentBox = null;

    if (wasDragging && box) {
      this.finishBoxSelect(box, shiftKey);
    } else {
      this.finishClickSelect(this.startX, this.startY, shiftKey);
    }
  }

  public cancelDrag(): void {
    this.isMouseDown = false;
    this.isDragging = false;
    this._currentBox = null;
  }

  private finishClickSelect(
    screenX: number,
    screenY: number,
    shiftKey: boolean,
  ): void {
    const sim = this.session.sim;
    if (!sim) return;

    const now = performance.now();
    const isDoubleClick =
      now - this.lastClickTime < 300 &&
      Math.hypot(screenX - this.lastClickX, screenY - this.lastClickY) <= 8;
    this.lastClickTime = now;
    this.lastClickX = screenX;
    this.lastClickY = screenY;

    // Pick entity via renderer hit test
    const pickedId = this.pickEntityAt(screenX, screenY);

    if (pickedId !== undefined) {
      const picked = sim.world.getEntity(pickedId);
      if (
        isDoubleClick &&
        picked &&
        picked.kind === 'unit' &&
        picked.player === 0
      ) {
        // Double-click selects all own units of that type on screen
        const matchingIds = this.getOwnUnitsOfTypeOnScreen(picked.type);
        if (shiftKey) {
          const union = new Set([...this._ids, ...matchingIds]);
          this.set(Array.from(union));
        } else {
          this.set(matchingIds);
        }
      } else {
        if (shiftKey) {
          // Shift toggle
          if (this._ids.includes(pickedId)) {
            this.set(this._ids.filter((id) => id !== pickedId));
          } else {
            this.set([...this._ids, pickedId]);
          }
        } else {
          this.set([pickedId]);
        }
      }
    } else {
      // Clicked ground
      if (!shiftKey) {
        this.clear();
      }
    }
  }

  private finishBoxSelect(box: SelectionBox, shiftKey: boolean): void {
    const sim = this.session.sim;
    const renderer = this.session.renderer;
    if (!sim || !renderer) return;

    const entities = sim.world.entities;
    const inBox: Entity[] = [];

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || (ent.kind !== 'unit' && ent.kind !== 'building')) continue;
      if (ent.hp <= 0) continue;

      const rect = renderer.getEntityScreenRect(ent.id);
      if (!rect) continue;

      if (
        rect.right >= box.left &&
        rect.left <= box.right &&
        rect.bottom >= box.top &&
        rect.top <= box.bottom
      ) {
        inBox.push(ent);
      }
    }

    // Own-unit precedence: own units only; buildings only if no units in box
    const ownUnits = inBox.filter((e) => e.kind === 'unit' && e.player === 0);
    let chosenIds: number[] = [];

    if (ownUnits.length > 0) {
      chosenIds = ownUnits.map((u) => u.id);
    } else {
      const ownBuildings = inBox.filter(
        (e) => e.kind === 'building' && e.player === 0,
      );
      if (ownBuildings.length > 0) {
        chosenIds = ownBuildings.map((b) => b.id);
      }
    }

    if (shiftKey) {
      if (chosenIds.length > 0) {
        const allPresent = chosenIds.every((id) => this._ids.includes(id));
        if (allPresent) {
          // Remove them
          this.set(this._ids.filter((id) => !chosenIds.includes(id)));
        } else {
          // Add them
          const union = new Set([...this._ids, ...chosenIds]);
          this.set(Array.from(union));
        }
      }
    } else {
      this.set(chosenIds);
    }
  }

  private pickEntityAt(screenX: number, screenY: number): number | undefined {
    const sim = this.session.sim;
    const renderer = this.session.renderer;
    if (!sim || !renderer) return undefined;

    const pickedId = renderer.pickEntity(screenX, screenY);
    if (pickedId === undefined) return undefined;

    const ent = sim.world.getEntity(pickedId);
    if (
      ent &&
      (ent.kind === 'mine' ||
        ((ent.kind === 'unit' || ent.kind === 'building') && ent.hp > 0))
    ) {
      return pickedId;
    }

    return undefined;
  }

  private getOwnUnitsOfTypeOnScreen(type: string): number[] {
    const sim = this.session.sim;
    const renderer = this.session.renderer;
    const cam = renderer?.camera;
    if (!sim || !renderer || !cam) return [];

    const entities = sim.world.entities;
    const matched: number[] = [];
    const width = cam.view.width;
    const height = cam.view.height;

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || ent.kind !== 'unit' || ent.player !== 0 || ent.type !== type)
        continue;
      if (typeof ent.hp === 'number' && ent.hp <= 0) continue;

      const rect = renderer.getEntityScreenRect(ent.id);
      if (!rect) continue;

      const onScreen =
        rect.right >= 0 &&
        rect.left <= width &&
        rect.bottom >= 0 &&
        rect.top <= height;

      if (onScreen) {
        matched.push(ent.id);
      }
    }

    return matched;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target;
    if (
      target &&
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true')
    ) {
      return;
    }

    if (e.key >= '0' && e.key <= '9') {
      const groupNum = parseInt(e.key, 10);
      if (e.ctrlKey || e.metaKey) {
        this.assignGroup(groupNum);
        e.preventDefault();
      } else if (!e.altKey) {
        this.selectGroup(groupNum);
        e.preventDefault();
      }
    }
  };

  private attachEvents(): void {
    const target = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof target.addEventListener === 'function') {
      target.addEventListener('keydown', this.onKeyDown as EventListener);
    }
  }

  private detachEvents(): void {
    const target = typeof window !== 'undefined' ? window : this.canvas;
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('keydown', this.onKeyDown as EventListener);
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    for (let i = 0; i < this.groups.length; i++) {
      this.groups[i].length = 0;
    }
    this.selectionChangeListeners.length = 0;
    this.detachEvents();
  }
}
