import { FACTIONS } from './factions.js';
import { getBuildingData } from './buildings.js';
import { ALL_UNITS, getUnitData } from './units.js';

// Role lookups by entity type id, derived from the data tables. Input, HUD,
// renderer and sim code must use these instead of matching type-name strings.

const PRODUCTION_BUILDING_IDS: ReadonlySet<string> = new Set(
  ALL_UNITS.map((unit) => unit.from),
);

const CART_UNIT_IDS: ReadonlySet<string> = new Set(
  Object.values(FACTIONS).map((faction) => faction.cartId),
);

/** Unit that builds, repairs and farms (data tag `worker`). */
export function isWorkerType(type: string): boolean {
  return getUnitData(type)?.tags.includes('worker') ?? false;
}

/** Unit that hauls gold (a faction's `cartId`). */
export function isCartType(type: string): boolean {
  return CART_UNIT_IDS.has(type);
}

/** Building a worker farms for food (data `isFarm`). */
export function isFarmType(type: string): boolean {
  return getBuildingData(type)?.isFarm === true;
}

/** A faction's Town Center building (data `isTownCenter`). */
export function isTownCenterType(type: string): boolean {
  return getBuildingData(type)?.isTownCenter === true;
}

/** Building that trains at least one unit (some unit's `from`); only these take rally points. */
export function isProductionType(type: string): boolean {
  return PRODUCTION_BUILDING_IDS.has(type);
}
