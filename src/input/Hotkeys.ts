import type { GameSession } from '../game/GameSession';
import type { InputController } from './InputController';
import { getCommandSlots, getCommandSlotContext } from '../ui/commandSlots';

export interface KeyboardEventLike {
  readonly code: string;
  readonly key?: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly target?: EventTarget | null;
  preventDefault?: () => void;
}

export function isEditableElement(
  target: EventTarget | null | undefined,
): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  if (
    typeof el.getAttribute === 'function' &&
    el.getAttribute('contenteditable') === 'true'
  ) {
    return true;
  }
  return false;
}

const CARD_CODE_TO_KEY: Readonly<Record<string, string>> = {
  KeyQ: 'Q',
  KeyW: 'W',
  KeyE: 'E',
  KeyR: 'R',
  KeyT: 'T',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyF: 'F',
  KeyG: 'G',
  KeyZ: 'Z',
  KeyX: 'X',
  KeyC: 'C',
  KeyV: 'V',
  KeyB: 'B',
};

const PAN_DIRECTION_BY_CODE: Readonly<
  Record<string, 'up' | 'down' | 'left' | 'right'>
> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export class Hotkeys {
  private readonly session: GameSession;
  private readonly input: InputController;
  private isDisposed = false;

  constructor(session: GameSession, input: InputController) {
    this.session = session;
    this.input = input;

    this.attachEvents();
  }

  public readonly handleKeyDown = (e: KeyboardEventLike): void => {
    if (this.isDisposed) return;
    if (isEditableElement(e.target)) return;

    const code = e.code;

    // 1. Arrows forward to camera.setPanKey on keydown/keyup regardless of modifiers
    const panDir = PAN_DIRECTION_BY_CODE[code];
    if (panDir) {
      this.input.camera.setPanKey(panDir, true);
      e.preventDefault?.();
      return;
    }
    // 2. Digits: Digit0-9
    // Modifier policy: Digit0-9 with Ctrl or Meta = assign group, plain = recall
    // double-tap within 300 ms of a non-repeat press centres via camera.centerOn
    const digitMatch = /^Digit([0-9])$/.exec(code);
    if (digitMatch) {
      const digit = parseInt(digitMatch[1], 10);
      if (e.ctrlKey || e.metaKey) {
        if (!e.altKey && !e.repeat) {
          this.input.selection.assignGroup(digit);
          e.preventDefault?.();
        }
      } else if (!e.altKey) {
        if (!e.repeat) {
          this.input.selection.selectGroup(digit);
          e.preventDefault?.();
        }
      }
      return;
    }

    // One-shot actions ignore Ctrl/Alt/Meta modifiers and ignore e.repeat
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) {
      return;
    }
    // Placement consumes these keys only after the normal one-shot filter.
    if (this.input.placement?.active) {
      if (code === 'Escape') {
        this.input.placement.cancel();
        e.preventDefault?.();
        return;
      }
      if (code === 'KeyR') {
        this.input.placement.rotate();
        e.preventDefault?.();
        return;
      }
    }

    // 3. KeyH -> camera.centerOnTownCenter()
    if (code === 'KeyH') {
      this.input.camera.centerOnTownCenter();
      e.preventDefault?.();
      return;
    }

    // 4. Period -> idle worker cycle
    if (code === 'Period') {
      this.input.cycleIdleWorker();
      e.preventDefault?.();
      return;
    }

    // 5. Delete -> delete order
    if (code === 'Delete') {
      this.input.orders.execute('delete');
      e.preventDefault?.();
      return;
    }

    // 6. Escape -> back order and cancel marquee drag
    if (code === 'Escape') {
      this.input.orders.execute('back');
      this.input.selection.cancelDrag?.();
      e.preventDefault?.();
      return;
    }
    // 7. Command card keys (QWERT / ASDFG / ZXCVB)
    const cardKey = CARD_CODE_TO_KEY[code];
    if (cardKey) {
      const selectionMeta = this.getLiveSelectedEntities();
      const slots = getCommandSlots(
        selectionMeta,
        this.input.orders.submenu,
        getCommandSlotContext(this.session.sim?.world),
      );
      const slot = slots.find((s) => s.key === cardKey);
      if (slot && (slot.action || (slot.disabled && slot.reason))) {
        this.input.orders.executeSlot(slot);
        e.preventDefault?.();
        return;
      }
      if (cardKey === 'G' && this.session.debugEnabled) {
        this.session.renderer?.toggleDebugGrid();
        e.preventDefault?.();
        return;
      }
      return;
    }
  };

  public readonly handleKeyUp = (e: KeyboardEventLike): void => {
    if (this.isDisposed) return;
    if (isEditableElement(e.target)) return;

    const panDir = PAN_DIRECTION_BY_CODE[e.code];
    if (panDir) {
      this.input.camera.setPanKey(panDir, false);
      e.preventDefault?.();
      return;
    }
  };

  private getLiveSelectedEntities(): {
    kind: string;
    type: string;
    player?: number;
  }[] {
    const sim = this.session.sim;
    if (!sim) return [];
    const ids = this.input.selection.ids;
    const result: { kind: string; type: string; player?: number }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ent = sim.world.getEntity(ids[i]);
      if (ent && (!('hp' in ent) || typeof ent.hp !== 'number' || ent.hp > 0)) {
        result.push({
          kind: ent.kind,
          type:
            'type' in ent && typeof ent.type === 'string' ? ent.type : ent.kind,
          player:
            'player' in ent && typeof ent.player === 'number'
              ? ent.player
              : undefined,
        });
      }
    }
    return result;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.handleKeyDown(e);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.handleKeyUp(e);
  };

  private attachEvents(): void {
    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
    }
  }

  private detachEvents(): void {
    if (
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function'
    ) {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.detachEvents();
  }
}
