import type { World } from '../world.js';

const MAX_POP_CAP = 150;
const previousLowFaith: boolean[] = [];

/**
 * Updates faith and population accounting for all players in the world.
 *
 * Runs deterministically each tick before production to ensure
 * Low Faith state takes effect in the same tick.
 */
export function updateFaith(world: World): void {
  for (let p = 0; p < world.players.length; p++) {
    const player = world.players[p];
    if (player) {
      previousLowFaith[p] = player.lowFaith;
      player.faithProduced = 0;
      player.faithUsed = 0;
      player.popCap = 0;
      player.pop = 0;
    }
  }

  for (let i = 0; i < world.entities.length; i++) {
    const entity = world.entities[i];
    if (!entity) {
      continue;
    }

    if (entity.kind === 'building') {
      const player = world.players[entity.player];
      if (player && entity.built && entity.hp > 0) {
        if (entity.pop > 0) {
          player.popCap += entity.pop;
        }
        if (entity.faith > 0) {
          player.faithProduced += entity.faith;
        } else if (entity.faith < 0) {
          player.faithUsed += -entity.faith;
        }
      }
    } else if (entity.kind === 'unit') {
      const player = world.players[entity.player];
      if (player && entity.hp > 0 && entity.pop > 0) {
        player.pop += entity.pop;
      }
    }
  }

  for (let p = 0; p < world.players.length; p++) {
    const player = world.players[p];
    if (player) {
      player.popCap = Math.min(MAX_POP_CAP, Math.max(0, player.popCap));
      player.pop = Math.max(0, player.pop);
      player.lowFaith = player.faithUsed > player.faithProduced;
      if (!previousLowFaith[p] && player.lowFaith) {
        world.emitEvent({ kind: 'faithLow', player: p });
      }
    }
  }
}
