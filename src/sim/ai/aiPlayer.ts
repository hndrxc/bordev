import type { Faction } from '../../data/types.js';
import type { Command } from '../commands.js';
import type { World } from '../world.js';
import { getBuildOrder, type BuildOrder } from './buildOrder.js';
import { AI_PARAMS, type AiDifficulty, type AiParams } from './difficulty.js';
import { runEconomy, type AiContext } from './economyManager.js';
import { MilitaryManager } from './militaryManager.js';
import { perceive } from './perception.js';

export class AiPlayer {
  private readonly player: number;
  private readonly params: AiParams;
  private readonly order: BuildOrder;
  private readonly military = new MilitaryManager();

  constructor(player: number, difficulty: AiDifficulty, faction: Faction) {
    this.player = player;
    this.params = AI_PARAMS[difficulty];
    this.order = getBuildOrder(faction, difficulty);
  }

  update(world: World, issue: (cmd: Command) => void): void {
    const state = world.players[this.player];
    if (
      world.outcome !== null ||
      state.eliminated ||
      (world.tick + this.player * 15) % this.params.decisionInterval !== 0
    ) {
      return;
    }

    const ctx: AiContext = {
      world,
      player: this.player,
      params: this.params,
      order: this.order,
      view: perceive(world, this.player),
      budget: { food: state.food, gold: state.gold },
      issue,
    };
    runEconomy(ctx);
    this.military.update(ctx);
  }
}
