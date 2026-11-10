import { getUpgradeData } from '../../data/upgrades.js';
import type { PlayerState } from '../world.js';

/**
 * Upgrades that may be researched in the current milestone. Every other table
 * entry stays Beta-disabled: it is listed in data but never offered or applied.
 */
const ENABLED_UPGRADES: Record<string, true> = {
  heavy_plough: true,
  slash_burn: true,
  blood_rites: true,
};

export function isUpgradeEnabled(upgradeId: string): boolean {
  return Object.hasOwn(ENABLED_UPGRADES, upgradeId);
}

/**
 * Rebuilds every additive base-rate modifier from the player's completed
 * upgrades. Percentages from different upgrades add (never multiply), and the
 * result is a pure function of `player.upgrades`, so it is idempotent.
 */
export function recomputeUpgradeModifiers(player: PlayerState): void {
  let farmFoodRatePercent = 0;
  player.buildingFaithBonus.clear();
  player.battleFervorUpgradeAttack = 0;
  for (const upgradeId of player.upgrades) {
    const data = getUpgradeData(upgradeId, player.faction);
    if (!data) {
      continue;
    }
    for (const effect of data.effects) {
      if (effect.kind === 'farm_food_rate_pct') {
        farmFoodRatePercent += effect.percent;
      } else if (effect.kind === 'building_faith_bonus') {
        player.buildingFaithBonus.set(
          effect.buildingId,
          (player.buildingFaithBonus.get(effect.buildingId) ?? 0) +
            effect.amount,
        );
      } else if (effect.kind === 'battle_fervor_attack_bonus') {
        player.battleFervorUpgradeAttack = Math.max(
          player.battleFervorUpgradeAttack,
          effect.attackBonus,
        );
      }
      // The remaining effect kinds arrive with the Beta M4 upgrades.
    }
  }
  player.farmFoodRateMultiplier = (100 + farmFoodRatePercent) / 100;
}

/**
 * Marks an upgrade completed exactly once and applies its effects. Returns
 * false (and changes nothing) for unknown, foreign-faction, Beta-disabled or
 * already completed upgrades.
 */
export function completeUpgrade(
  player: PlayerState,
  upgradeId: string,
): boolean {
  if (!isUpgradeEnabled(upgradeId) || player.upgrades.has(upgradeId)) {
    return false;
  }
  if (!getUpgradeData(upgradeId, player.faction)) {
    return false;
  }
  player.upgrades.add(upgradeId);
  recomputeUpgradeModifiers(player);
  return true;
}
