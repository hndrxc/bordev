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
import {
  applyBuildCommand,
  applyRepairCommand,
  cancelConstruction,
  updateConstruction,
} from './systems/construction.js';
import {
  applyFarmCommand,
  applyPinMineCommand,
  updateEconomy,
} from './systems/economy.js';
import { updateFaith } from './systems/faith.js';
import {
  applyCancelTrainCommand,
  applyTrainCommand,
  updateProduction,
} from './systems/production.js';

export const SIM_DT = 0.05;

function clearActiveWorkAndCartTransientState(unit: UnitEntity): void {
  unit.workAnimation = undefined;
  unit.workStartedTick = undefined;
  if (unit.cart) {
    unit.cart.phase = 'idle';
    unit.cart.ticks = 0;
    unit.cart.mineId = undefined;
    unit.cart.mineRef = undefined;
    unit.cart.dropOffId = undefined;
    unit.cart.dropOffRef = undefined;
    unit.cart.pinnedMineId = undefined;
    unit.cart.pinnedMineRef = undefined;
    unit.loaded = unit.cart.carriedGold > 0;
    unit.speed =
      unit.loaded && unit.loadedSpeed !== undefined
        ? unit.loadedSpeed
        : unit.baseSpeed;
  }
}

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
    updateConstruction(this.world);
    updateEconomy(this.world);
    updateFaith(this.world);
    updateProduction(this.world);
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
      case 'build':
        applyBuildCommand(this.world, cmd);
        break;
      case 'repair':
        applyRepairCommand(this.world, cmd);
        break;
      case 'farm':
        applyFarmCommand(this.world, cmd);
        break;
      case 'pinMine':
        applyPinMineCommand(this.world, cmd);
        break;
      case 'train':
        applyTrainCommand(this.world, cmd);
        break;
      case 'cancelTrain':
        applyCancelTrainCommand(this.world, cmd);
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
      const isBusy =
        unit.order !== undefined &&
        unit.order.kind !== 'idle' &&
        unit.order.kind !== 'stop' &&
        unit.order.kind !== 'hold';
      if (cmd.queued && isBusy) {
        unit.orders.push({
          kind: cmd.kind,
          x: cmd.x,
          z: cmd.z,
        });
      } else {
        clearActiveWorkAndCartTransientState(unit);
        unit.order = { kind: cmd.kind, x: cmd.x, z: cmd.z };
        unit.orders = [];
        unit.orderGeneration++;
        unit.formationSlotX = undefined;
        unit.formationSlotZ = undefined;
        unit.path = undefined;
        unit.stuckTicks = 0;
        unit.stuckProgressX = unit.x;
        unit.stuckProgressZ = unit.z;
        unit.stuckLastCheckTick = this.world.tick;
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

      const isBusy =
        unit.order !== undefined &&
        unit.order.kind !== 'idle' &&
        unit.order.kind !== 'stop' &&
        unit.order.kind !== 'hold';
      if (cmd.queued && isBusy) {
        unit.orders.push({
          kind: cmd.kind,
          x: targetX,
          z: targetZ,
        });
      } else {
        clearActiveWorkAndCartTransientState(unit);
        unit.order = { kind: cmd.kind, x: targetX, z: targetZ };
        unit.orders = [];
        unit.orderGeneration++;
        unit.formationSlotX = targetX;
        unit.formationSlotZ = targetZ;
        unit.stuckTicks = 0;
        unit.stuckProgressX = unit.x;
        unit.stuckProgressZ = unit.z;
        unit.stuckLastCheckTick = this.world.tick;
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
        const isBusy =
          ent.order !== undefined &&
          ent.order.kind !== 'idle' &&
          ent.order.kind !== 'stop' &&
          ent.order.kind !== 'hold';
        if (cmd.queued && isBusy) {
          ent.orders.push({ kind: 'stop' });
        } else {
          clearActiveWorkAndCartTransientState(ent);
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
        const isBusy =
          ent.order !== undefined &&
          ent.order.kind !== 'idle' &&
          ent.order.kind !== 'stop' &&
          ent.order.kind !== 'hold';
        if (cmd.queued && isBusy) {
          ent.orders.push({ kind: 'hold' });
        } else {
          clearActiveWorkAndCartTransientState(ent);
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
        if (ent.kind === 'building') {
          if (!ent.built) {
            cancelConstruction(this.world, ent);
            continue;
          } else {
            if (ent.trainingQueue && ent.trainingQueue.length > 0) {
              const pState = this.world.players[ent.player];
              if (pState) {
                for (let q = 0; q < ent.trainingQueue.length; q++) {
                  const item = ent.trainingQueue[q];
                  pState.food += item.food;
                  pState.gold += item.gold;
                }
              }
              ent.trainingQueue.length = 0;
            }
          }
        }
        this.world.removeEntity(ent.id);
      }
    }
  }
}
