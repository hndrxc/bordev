export type AiDifficulty = 'normal';

export interface AiParams {
  decisionInterval: number;
  targetPeasants: number;
  targetCarts: number;
  firstAttackTick: number;
  attackArmySize: number;
  minWaveSize: number;
  reinforceSize: number;
  retreatHpFraction: number;
  rejoinHpFraction: number;
  defendRadius: number;
  farStorehouseDistance: number;
  housingMargin: number;
}

export const AI_PARAMS: Record<AiDifficulty, AiParams> = {
  normal: {
    decisionInterval: 30,
    targetPeasants: 12,
    targetCarts: 4,
    firstAttackTick: 9000,
    attackArmySize: 10,
    minWaveSize: 3,
    reinforceSize: 6,
    retreatHpFraction: 0.3,
    rejoinHpFraction: 0.6,
    defendRadius: 20,
    farStorehouseDistance: 12,
    housingMargin: 5,
  },
};
