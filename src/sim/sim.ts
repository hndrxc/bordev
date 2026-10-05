import type { Faction } from '../data/types.js';
import { isProductionType } from '../data/roles.js';
import type { GameMap } from './map.js';
import { World } from './world.js';
import type { PathQueue } from './path/pathQueue.js';
import { Rng } from './rng.js';
import {
  type Command,
  type SimEvent,
  cloneCommand,
  isSupportedCommandKind,
} from './commands.js';
import type { UnitEntity } from './entity.js';
import { assignFormationSlots, updateMovement } from './systems/movement.js';
export const SIM_DT = 0.05;

export class Sim {
  readonly world: World;
  readonly pathQueue: PathQueue;
  readonly rng: Rng;

  private pendingCommands: Command[] = [];

  constructor(
    map: GameMap,
    seed = 1,
    playerFactions?: Record<number, Faction>,
  ) {
    this.rng = new Rng(seed);
    this.world = new World(map, this.rng, playerFactions);
    this.pathQueue = this.world.pathQueue;
  }

  issue(cmd: Command): void {
    if (!isSupportedCommandKind(cmd.kind)) {
      throw new Error(`Command kind '${cmd.kind}' is not implemented yet`);
    }
    this.pendingCommands.push(cloneCommand(cmd));
  }

  step(): void {
    const commandsToProcess = this.pendingCommands;
    this.pendingCommands = [];

    for (let i = 0; i < commandsToProcess.length; i++) {
      this.applyCommand(commandsToProcess[i]);
    }

    updateMovement(this.world);
    this.world.tick++;
  }

  drainEvents(): SimEvent[] {
    const drained = [...this.world.events];
    this.world.events.length = 0;
    return drained;
  }

  private applyCommand(cmd: Command): void {
    switch (cmd.kind) {
      case 'move':
      case 'attackMove':
        this.applyMoveCommand(cmd);
        break;
      case 'stop':
        this.applyStopCommand(cmd);
        break;
      case 'hold':
        this.applyHoldCommand(cmd);
        break;
      case 'delete':
        this.applyDeleteCommand(cmd);
        break;
      case 'setRally':
        this.applySetRallyCommand(cmd);
        break;
      default:
        throw new Error(`Unsupported command: ${(cmd as Command).kind}`);
    }
  }

  private applySetRallyCommand(
    cmd: Extract<Command, { kind: 'setRally' }>,
  ): void {
    if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) {
      return;
    }
    const ent = this.world.entities[cmd.buildingId];
    if (
      ent &&
      ent.kind === 'building' &&
      ent.player === cmd.player &&
      isProductionType(ent.type)
    ) {
      const size = this.world.map.size;
      ent.rallyPoint = {
        x: Math.max(0, Math.min(size, cmd.x)),
        z: Math.max(0, Math.min(size, cmd.z)),
      };
    }
  }

  private applyMoveCommand(
    cmd: Extract<Command, { kind: 'move' | 'attackMove' }>,
  ): void {
    const units: UnitEntity[] = [];
    for (let i = 0; i < cmd.ids.length; i++) {
      const ent = this.world.entities[cmd.ids[i]];
      if (ent && ent.kind === 'unit' && ent.player === cmd.player) {
        units.push(ent);
      }
    }

    if (units.length === 0) return;

    if (units.length === 1) {
      const unit = units[0];
      const isMoving =
        unit.order &&
        (unit.order.kind === 'move' || unit.order.kind === 'attackMove');
      if (cmd.queued && isMoving) {
        unit.orders.push({
          kind: cmd.kind,
          x: cmd.x,
          z: cmd.z,
        });
      } else {
        unit.order = { kind: cmd.kind, x: cmd.x, z: cmd.z };
        unit.orders = [];
        unit.orderGeneration++;
        unit.formationSlotX = undefined;
        unit.formationSlotZ = undefined;
        unit.path = undefined;
        unit.pathTarget = undefined;
        this.world.pathQueue.cancel(unit.id);
        this.world.pathQueue.request(
          unit.id,
          unit.x,
          unit.z,
          cmd.x,
          cmd.z,
          unit.player,
        );
        unit.pathPending = true;
      }
      return;
    }

    // Group move: assign formation slots
    const slots = assignFormationSlots(
      units,
      cmd.x,
      cmd.z,
      this.world.grid,
      cmd.player,
    );

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const slot = slots[i];
      const targetX = slot ? slot.x : cmd.x;
      const targetZ = slot ? slot.z : cmd.z;

      const isMoving =
        unit.order &&
        (unit.order.kind === 'move' || unit.order.kind === 'attackMove');
      if (cmd.queued && isMoving) {
        unit.orders.push({
          kind: cmd.kind,
          x: targetX,
          z: targetZ,
        });
      } else {
        unit.order = { kind: cmd.kind, x: targetX, z: targetZ };
        unit.orders = [];
        unit.orderGeneration++;
        unit.formationSlotX = targetX;
        unit.formationSlotZ = targetZ;
        unit.path = undefined;
        unit.pathTarget = undefined;
        this.world.pathQueue.cancel(unit.id);
        this.world.pathQueue.request(
          unit.id,
          unit.x,
          unit.z,
          targetX,
          targetZ,
          unit.player,
        );
        unit.pathPending = true;
      }
    }
  }

  private applyStopCommand(cmd: Extract<Command, { kind: 'stop' }>): void {
    for (let i = 0; i < cmd.ids.length; i++) {
      const ent = this.world.entities[cmd.ids[i]];
      if (ent && ent.kind === 'unit' && ent.player === cmd.player) {
        const isMoving =
          ent.order &&
          (ent.order.kind === 'move' || ent.order.kind === 'attackMove');
        if (cmd.queued && isMoving) {
          ent.orders.push({ kind: 'stop' });
        } else {
          ent.order = { kind: 'stop' };
          ent.orders = [];
          ent.orderGeneration++;
          ent.formationSlotX = undefined;
          ent.formationSlotZ = undefined;
          ent.path = undefined;
          ent.pathTarget = undefined;
          ent.pathPending = false;
          this.world.pathQueue.cancel(ent.id);
        }
      }
    }
  }

  private applyHoldCommand(cmd: Extract<Command, { kind: 'hold' }>): void {
    for (let i = 0; i < cmd.ids.length; i++) {
      const ent = this.world.entities[cmd.ids[i]];
      if (ent && ent.kind === 'unit' && ent.player === cmd.player) {
        const isMoving =
          ent.order &&
          (ent.order.kind === 'move' || ent.order.kind === 'attackMove');
        if (cmd.queued && isMoving) {
          ent.orders.push({ kind: 'hold' });
        } else {
          ent.order = { kind: 'hold' };
          ent.orders = [];
          ent.orderGeneration++;
          ent.formationSlotX = undefined;
          ent.formationSlotZ = undefined;
          ent.path = undefined;
          ent.pathTarget = undefined;
          ent.pathPending = false;
          this.world.pathQueue.cancel(ent.id);
        }
      }
    }
  }

  private applyDeleteCommand(cmd: Extract<Command, { kind: 'delete' }>): void {
    for (let i = 0; i < cmd.ids.length; i++) {
      const ent = this.world.entities[cmd.ids[i]];
      if (ent && 'player' in ent && ent.player === cmd.player) {
        this.world.removeEntity(ent.id);
      }
    }
  }
}
