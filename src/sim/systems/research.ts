import { AGES } from '../../data/ages.js';
import { getBuildingData } from '../../data/buildings.js';
import { FACTIONS } from '../../data/factions.js';
import { ALL_UPGRADES } from '../../data/upgrades.js';
import type {
  AgeNumber,
  BuildingCategory,
  Faction,
  UpgradeEffect,
} from '../../data/types.js';
import type { CancelResearchCommand, ResearchCommand } from '../commands.js';
import type { BuildingEntity } from '../entity.js';
import type { World } from '../world.js';
import { completeUpgrade, isUpgradeEnabled } from './upgrades.js';

const SIM_DT = 0.05;

/** Command ids for Town Center age research. */
export const AGE_RESEARCH_IDS = ['age_2', 'age_3'] as const;

export type ResearchKind = 'age' | 'upgrade';

/** Faction-resolved research entry shared by validation, stepping and UI. */
export interface ResearchDefinition {
  readonly id: string;
  readonly kind: ResearchKind;
  readonly name: string;
  /** Building type that performs the research. */
  readonly building: string;
  /** Minimum current age needed to start it. */
  readonly requiredAge: AgeNumber;
  /** Age reached on completion (age research only). */
  readonly targetAge?: 2 | 3;
  readonly food: number;
  readonly gold: number;
  /** Seconds at full speed. */
  readonly time: number;
  readonly effectDescription: string;
  readonly effects: readonly UpgradeEffect[];
  /** False for Beta entries that are listed but never researchable. */
  readonly enabled: boolean;
}

export interface ResearchAvailability {
  allowed: boolean;
  reason?: string;
}

const AGE_BY_RESEARCH_ID: Record<string, 2 | 3> = { age_2: 2, age_3: 3 };

const CATEGORY_ORDER: readonly BuildingCategory[] = [
  'barracks',
  'range',
  'storehouse',
  'faith',
  'stable',
];

const DEFINITIONS_BY_FACTION: Record<
  Faction,
  Record<string, ResearchDefinition>
> = { crown: {}, clans: {} };

/** All definitions per researching building type (building ids are unique across factions). */
const DEFINITIONS_BY_BUILDING: Record<string, ResearchDefinition[]> = {};

function registerDefinition(
  faction: Faction,
  definition: ResearchDefinition,
): void {
  DEFINITIONS_BY_FACTION[faction][definition.id] = definition;
  (DEFINITIONS_BY_BUILDING[definition.building] ??= []).push(definition);
}

for (const faction of Object.keys(FACTIONS) as Faction[]) {
  const townCenter = FACTIONS[faction].townCenterId;
  for (const id of AGE_RESEARCH_IDS) {
    const targetAge = AGE_BY_RESEARCH_ID[id];
    const age = AGES[targetAge];
    registerDefinition(faction, {
      id,
      kind: 'age',
      name: age.name[faction],
      building: townCenter,
      requiredAge: (targetAge - 1) as AgeNumber,
      targetAge,
      food: age.cost.food,
      gold: age.cost.gold,
      time: age.researchTime,
      effectDescription: age.description,
      effects: [],
      enabled: true,
    });
  }
}

for (const upgrade of ALL_UPGRADES) {
  registerDefinition(upgrade.faction, {
    id: upgrade.id,
    kind: 'upgrade',
    name: upgrade.name,
    building: upgrade.building,
    requiredAge: upgrade.age,
    food: upgrade.food,
    gold: upgrade.gold,
    time: upgrade.time,
    effectDescription: upgrade.effectDescription,
    effects: upgrade.effects,
    enabled: isUpgradeEnabled(upgrade.id),
  });
}

/** Resolves an `age_2` / `age_3` / upgrade id for a faction. */
export function getResearchDefinition(
  faction: Faction,
  upgradeId: string,
): ResearchDefinition | undefined {
  const byId = DEFINITIONS_BY_FACTION[faction];
  return Object.hasOwn(byId, upgradeId) ? byId[upgradeId] : undefined;
}

/**
 * Every research entry (enabled or Beta-disabled) the given building type
 * performs, in stable order. The returned array is shared; do not mutate it.
 */
export function listResearchDefinitions(
  buildingType: string,
): readonly ResearchDefinition[] {
  return Object.hasOwn(DEFINITIONS_BY_BUILDING, buildingType)
    ? DEFINITIONS_BY_BUILDING[buildingType]
    : [];
}

function deny(reason: string): ResearchAvailability {
  return { allowed: false, reason };
}

function ageName(faction: Faction, age: AgeNumber): string {
  return AGES[age].name[faction];
}

function buildingName(type: string, faction: Faction): string {
  return getBuildingData(type, faction)?.name ?? type;
}

/** Bit i set when the player owns a completed live building of CATEGORY_ORDER[i]. */
function completedCategoryMask(
  world: World,
  playerId: number,
  faction: Faction,
): number {
  const mapping = FACTIONS[faction].categoryMapping;
  let mask = 0;
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      !ent ||
      ent.kind !== 'building' ||
      ent.player !== playerId ||
      ent.faction !== faction ||
      !ent.built ||
      ent.hp <= 0
    ) {
      continue;
    }
    for (let c = 0; c < CATEGORY_ORDER.length; c++) {
      if (mapping[CATEGORY_ORDER[c]] === ent.type) {
        mask |= 1 << c;
      }
    }
  }
  return mask;
}

/** Missing age requirements as player-facing lines (empty when satisfied). */
function getAgeRequirementShortfall(
  world: World,
  playerId: number,
  faction: Faction,
  targetAge: 2 | 3,
): string[] {
  const requirement = AGES[targetAge].requirement;
  if (!requirement) {
    return [];
  }
  const mask = completedCategoryMask(world, playerId, faction);
  const mapping = FACTIONS[faction].categoryMapping;
  const missing: string[] = [];

  if (
    requirement.requiredCategory &&
    (mask & (1 << CATEGORY_ORDER.indexOf(requirement.requiredCategory))) === 0
  ) {
    missing.push(
      `Requires a completed ${buildingName(mapping[requirement.requiredCategory], faction)}`,
    );
  }

  let have = 0;
  const options: string[] = [];
  for (const category of requirement.buildingCategories) {
    if (mask & (1 << CATEGORY_ORDER.indexOf(category))) {
      have++;
    } else {
      options.push(buildingName(mapping[category], faction));
    }
  }
  if (have < requirement.minDistinctBuildings) {
    const more = requirement.minDistinctBuildings - have;
    missing.push(
      `Requires ${more} more distinct completed ${more === 1 ? 'building' : 'buildings'}: ${options.join(', ')}`,
    );
  }
  return missing;
}

function isResearchInProgress(
  world: World,
  playerId: number,
  upgradeId: string,
): boolean {
  for (let i = 0; i < world.entities.length; i++) {
    const ent = world.entities[i];
    if (
      ent &&
      ent.kind === 'building' &&
      ent.player === playerId &&
      ent.research?.upgradeId === upgradeId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `playerId` may start `upgradeId` at `buildingId` right now. Checks
 * ownership, completion, faction, producing building, Beta gating, age and age
 * requirements (distinct completed owned categories), per-building busy state
 * (one research; mutually exclusive with training), player-wide duplicate and
 * in-progress locks across Town Centers, and cost. On refusal `reason` lists
 * what is missing for the command-card tooltip.
 */
export function getResearchAvailability(
  world: World,
  playerId: number,
  buildingId: number,
  upgradeId: string,
): ResearchAvailability {
  const player = world.players[playerId];
  if (!player || player.eliminated) {
    return deny('Player unavailable');
  }

  const building = world.getEntity(buildingId);
  if (
    !building ||
    building.kind !== 'building' ||
    building.player !== playerId ||
    !building.built ||
    building.hp <= 0
  ) {
    return deny('Building unavailable');
  }

  const def = getResearchDefinition(player.faction, upgradeId);
  if (!def) {
    return deny('Unknown research');
  }
  if (!def.enabled) {
    return deny('Not available yet (Beta)');
  }
  if (building.faction !== player.faction || building.type !== def.building) {
    return deny(`Researched at ${buildingName(def.building, player.faction)}`);
  }

  const missing: string[] = [];
  if (def.kind === 'age') {
    const targetAge = def.targetAge as 2 | 3;
    if (player.age >= targetAge) {
      return deny(`${def.name} already reached`);
    }
    if (player.age < def.requiredAge) {
      return deny(`Requires ${ageName(player.faction, def.requiredAge)} first`);
    }
    missing.push(
      ...getAgeRequirementShortfall(world, playerId, player.faction, targetAge),
    );
  } else {
    if (player.upgrades.has(upgradeId)) {
      return deny('Already researched');
    }
    if (player.age < def.requiredAge) {
      missing.push(`Requires ${ageName(player.faction, def.requiredAge)}`);
    }
  }
  if (missing.length > 0) {
    return deny(missing.join('; '));
  }

  if (building.research) {
    return deny('Already researching');
  }
  if (building.trainingQueue && building.trainingQueue.length > 0) {
    return deny('Training in progress');
  }
  if (isResearchInProgress(world, playerId, upgradeId)) {
    return deny('Already being researched');
  }

  const lacksFood = player.food < def.food;
  const lacksGold = player.gold < def.gold;
  if (lacksFood || lacksGold) {
    return deny(
      `Not enough ${lacksFood && lacksGold ? 'food and gold' : lacksFood ? 'food' : 'gold'}`,
    );
  }

  return { allowed: true };
}

/** Validates and starts research, deducting the full cost up front. */
export function issueResearch(world: World, cmd: ResearchCommand): boolean {
  if (
    !getResearchAvailability(world, cmd.player, cmd.buildingId, cmd.upgradeId)
      .allowed
  ) {
    return false;
  }
  const player = world.players[cmd.player];
  const building = world.getEntity(cmd.buildingId) as BuildingEntity;
  const def = getResearchDefinition(player.faction, cmd.upgradeId);
  if (!def) {
    return false;
  }
  player.food -= def.food;
  player.gold -= def.gold;
  building.research = {
    upgradeId: def.id,
    progress: 0,
    food: def.food,
    gold: def.gold,
    time: def.time,
  };
  return true;
}

/**
 * Refunds a building's active research in full and clears it. Returns whether
 * anything was refunded. Used by cancellation and deletion of the producer.
 */
export function refundResearch(
  world: World,
  building: BuildingEntity,
): boolean {
  const research = building.research;
  if (!research) {
    return false;
  }
  building.research = undefined;
  const player = world.players[building.player];
  if (player) {
    player.food += research.food;
    player.gold += research.gold;
  }
  return true;
}

/** Cancels the building's active research with a 100 % refund. */
export function cancelResearch(
  world: World,
  cmd: CancelResearchCommand,
): boolean {
  const player = world.players[cmd.player];
  if (!player) {
    return false;
  }
  const building = world.getEntity(cmd.buildingId);
  if (
    !building ||
    building.kind !== 'building' ||
    building.player !== cmd.player
  ) {
    return false;
  }
  return refundResearch(world, building);
}

function completeResearch(
  world: World,
  building: BuildingEntity,
  upgradeId: string,
): void {
  const player = world.players[building.player];
  building.research = undefined;
  if (!player) {
    return;
  }
  const def = getResearchDefinition(player.faction, upgradeId);
  if (!def) {
    return;
  }
  if (def.kind === 'age') {
    const targetAge = def.targetAge as 2 | 3;
    if (targetAge > player.age) {
      player.age = targetAge;
      world.emitEvent({
        kind: 'ageReached',
        player: player.id,
        age: targetAge,
      });
    }
    return;
  }
  completeUpgrade(player, upgradeId);
}

/**
 * Advances active research. Progress is `dt` seconds per tick, halved while
 * the owner is in Low Faith; completion applies the age or upgrade once.
 */
export function stepResearch(world: World, dt = SIM_DT): void {
  for (let i = 0; i < world.entities.length; i++) {
    const building = world.entities[i];
    if (
      !building ||
      building.kind !== 'building' ||
      !building.research ||
      !building.built ||
      building.hp <= 0
    ) {
      continue;
    }
    const player = world.players[building.player];
    if (!player || player.eliminated) {
      continue;
    }

    const research = building.research;
    if (!getResearchDefinition(player.faction, research.upgradeId)) {
      // Unknown research can never complete; release the lock and refund.
      refundResearch(world, building);
      continue;
    }

    research.progress += player.lowFaith ? dt * 0.5 : dt;
    if (research.progress >= research.time - 1e-6) {
      completeResearch(world, building, research.upgradeId);
    }
  }
}
