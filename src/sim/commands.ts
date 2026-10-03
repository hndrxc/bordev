export interface MoveCommand {
  kind: 'move';
  player: number;
  ids: number[];
  x: number;
  z: number;
  queued?: boolean;
}

export interface AttackMoveCommand {
  kind: 'attackMove';
  player: number;
  ids: number[];
  x: number;
  z: number;
  queued?: boolean;
}

export interface AttackCommand {
  kind: 'attack';
  player: number;
  ids: number[];
  targetId: number;
  queued?: boolean;
}

export interface StopCommand {
  kind: 'stop';
  player: number;
  ids: number[];
  queued?: boolean;
}

export interface HoldCommand {
  kind: 'hold';
  player: number;
  ids: number[];
  queued?: boolean;
}

export interface DeleteCommand {
  kind: 'delete';
  player: number;
  ids: number[];
  queued?: boolean;
}

export interface BuildCommand {
  kind: 'build';
  player: number;
  ids: number[];
  buildingType: string;
  x: number;
  z: number;
  queued?: boolean;
}

export interface RepairCommand {
  kind: 'repair';
  player: number;
  ids: number[];
  targetId: number;
  queued?: boolean;
}

export interface FarmCommand {
  kind: 'farm';
  player: number;
  ids: number[];
  targetId: number;
  queued?: boolean;
}

export interface PinMineCommand {
  kind: 'pinMine';
  player: number;
  ids: number[];
  targetId: number;
  queued?: boolean;
}

export interface TrainCommand {
  kind: 'train';
  player: number;
  buildingId: number;
  unitType: string;
}

export interface CancelTrainCommand {
  kind: 'cancelTrain';
  player: number;
  buildingId: number;
  slotIndex?: number;
}

export interface ResearchCommand {
  kind: 'research';
  player: number;
  buildingId: number;
  upgradeId: string;
}

export interface CancelResearchCommand {
  kind: 'cancelResearch';
  player: number;
  buildingId: number;
}

export interface SetRallyCommand {
  kind: 'setRally';
  player: number;
  buildingId: number;
  x: number;
  z: number;
}

export type Command =
  | MoveCommand
  | AttackMoveCommand
  | AttackCommand
  | StopCommand
  | HoldCommand
  | DeleteCommand
  | BuildCommand
  | RepairCommand
  | FarmCommand
  | PinMineCommand
  | TrainCommand
  | CancelTrainCommand
  | ResearchCommand
  | CancelResearchCommand
  | SetRallyCommand;

export const SUPPORTED_M3_COMMAND_KINDS = [
  'move',
  'attackMove',
  'stop',
  'hold',
  'delete',
] as const;

export type SupportedM3CommandKind = (typeof SUPPORTED_M3_COMMAND_KINDS)[number];

export function isSupportedM3CommandKind(
  kind: Command['kind'],
): kind is SupportedM3CommandKind {
  return (
    kind === 'move' ||
    kind === 'attackMove' ||
    kind === 'stop' ||
    kind === 'hold' ||
    kind === 'delete'
  );
}

export function cloneCommand(cmd: Command): Command {
  switch (cmd.kind) {
    case 'move':
    case 'attackMove':
      return {
        ...cmd,
        ids: [...cmd.ids],
      };
    case 'attack':
    case 'stop':
    case 'hold':
    case 'delete':
    case 'repair':
    case 'farm':
    case 'pinMine':
      return {
        ...cmd,
        ids: [...cmd.ids],
      };
    case 'build':
      return {
        ...cmd,
        ids: [...cmd.ids],
      };
    case 'train':
    case 'cancelTrain':
    case 'research':
    case 'cancelResearch':
    case 'setRally':
      return {
        ...cmd,
      };
  }
}

export interface UnitCreatedEvent {
  kind: 'unitCreated';
  entityId: number;
  player: number;
  unitType: string;
  x: number;
  z: number;
}

export interface UnitDiedEvent {
  kind: 'unitDied';
  entityId: number;
  player: number;
  killerEntityId?: number;
  x: number;
  z: number;
}

export interface BuildingCompletedEvent {
  kind: 'buildingCompleted';
  entityId: number;
  player: number;
  buildingType: string;
  x: number;
  z: number;
}

export interface UnderAttackEvent {
  kind: 'underAttack';
  entityId: number;
  player: number;
  attackerEntityId?: number;
  x: number;
  z: number;
}

export interface AgeReachedEvent {
  kind: 'ageReached';
  player: number;
  age: 1 | 2 | 3;
}

export interface PlayerEliminatedEvent {
  kind: 'playerEliminated';
  player: number;
  victorTeam?: number;
}

export type SimEvent =
  | UnitCreatedEvent
  | UnitDiedEvent
  | BuildingCompletedEvent
  | UnderAttackEvent
  | AgeReachedEvent
  | PlayerEliminatedEvent;
