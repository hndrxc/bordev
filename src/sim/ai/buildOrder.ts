import { getBuildingData } from '../../data/buildings.js';
import type { Faction } from '../../data/types.js';
import { getUnitData } from '../../data/units.js';
import { AGE_RESEARCH_IDS } from '../systems/research.js';
import type { AiDifficulty } from './difficulty.js';
import crownNormal from './buildOrders/crown_normal.json' with { type: 'json' };

export type BuildStep =
  | { kind: 'build'; buildingType: string; minPeasants: number }
  | { kind: 'research'; upgradeId: string; minPeasants: number };

export interface BuildOrder {
  faction: Faction;
  steps: BuildStep[];
  army: Record<number, Record<string, number>>;
  maxAlive: Record<string, number>;
}

interface RawBuildOrder {
  faction?: unknown;
  steps?: unknown;
  army?: unknown;
  maxAlive?: unknown;
}

export function parseBuildOrder(json: unknown): BuildOrder {
  const raw: RawBuildOrder =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as RawBuildOrder)
      : {};
  const factionName =
    raw.faction === undefined ? 'unknown' : String(raw.faction);
  const invalid = (detail: string): never => {
    throw new Error(`Invalid build order ${factionName}: ${detail}`);
  };
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return invalid('expected an object');
  }
  const faction = raw.faction;
  if (faction !== 'crown' && faction !== 'clans') {
    return invalid('unknown faction');
  }
  if (!Array.isArray(raw.steps)) return invalid('steps must be an array');

  const steps: BuildStep[] = [];
  for (const [index, value] of raw.steps.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalid(`step ${index} must be an object`);
    }
    const step = value as {
      build?: unknown;
      research?: unknown;
      minPeasants?: unknown;
    };
    const minPeasants = step.minPeasants === undefined ? 0 : step.minPeasants;
    if (
      typeof minPeasants !== 'number' ||
      !Number.isInteger(minPeasants) ||
      minPeasants < 0
    ) {
      return invalid(`step ${index} has invalid minPeasants`);
    }
    if ((step.build !== undefined) === (step.research !== undefined)) {
      return invalid(
        `step ${index} must specify exactly one build or research`,
      );
    }
    if (step.build !== undefined) {
      if (
        typeof step.build !== 'string' ||
        !getBuildingData(step.build, faction)
      ) {
        return invalid(`unknown building ${String(step.build)}`);
      }
      steps.push({ kind: 'build', buildingType: step.build, minPeasants });
    } else {
      if (
        typeof step.research !== 'string' ||
        !AGE_RESEARCH_IDS.some((id) => id === step.research)
      ) {
        return invalid(`unknown age research ${String(step.research)}`);
      }
      steps.push({ kind: 'research', upgradeId: step.research, minPeasants });
    }
  }

  if (
    typeof raw.army !== 'object' ||
    raw.army === null ||
    Array.isArray(raw.army)
  ) {
    return invalid('army must be an object');
  }
  const army: Record<number, Record<string, number>> = {};
  for (const [age, composition] of Object.entries(raw.army)) {
    if (age !== '1' && age !== '2' && age !== '3') {
      return invalid(`unknown army age ${age}`);
    }
    if (
      typeof composition !== 'object' ||
      composition === null ||
      Array.isArray(composition)
    ) {
      return invalid(`army age ${age} must be an object`);
    }
    const weights: Record<string, number> = {};
    for (const [unit, weight] of Object.entries(composition)) {
      if (!getUnitData(unit, faction)) return invalid(`unknown unit ${unit}`);
      if (
        typeof weight !== 'number' ||
        !Number.isFinite(weight) ||
        weight <= 0
      ) {
        return invalid(`invalid army weight for ${unit}`);
      }
      weights[unit] = weight;
    }
    army[Number(age)] = weights;
  }

  if (
    typeof raw.maxAlive !== 'object' ||
    raw.maxAlive === null ||
    Array.isArray(raw.maxAlive)
  ) {
    return invalid('maxAlive must be an object');
  }
  const maxAlive: Record<string, number> = {};
  for (const [unit, limit] of Object.entries(raw.maxAlive)) {
    if (!getUnitData(unit, faction)) return invalid(`unknown unit ${unit}`);
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
      return invalid(`invalid maxAlive limit for ${unit}`);
    }
    maxAlive[unit] = limit;
  }
  return { faction, steps, army, maxAlive };
}

const cache = new Map<string, BuildOrder>();

export function getBuildOrder(
  faction: Faction,
  difficulty: AiDifficulty,
): BuildOrder {
  if (faction !== 'crown' || difficulty !== 'normal') {
    throw new Error(`AI for ${faction} is not available until Beta`);
  }
  const key = `${faction}:${difficulty}`;
  let order = cache.get(key);
  if (!order) {
    order = parseBuildOrder(crownNormal);
    cache.set(key, order);
  }
  return order;
}
