import { expect, type Page } from '@playwright/test';
import type { BuildingEntity } from '../../../src/sim/entity';
import { pickablePoint, playfield, waitForTicks } from './m4';

interface BaseBuilding {
  id: number;
  type: string;
  x: number;
  z: number;
  width: number;
  height: number;
}

interface ResearchRun {
  startTick: number;
  progressAtStart: number;
  time: number;
  elapsedTicks: number;
  ageEvents: { player: number; age: number }[];
}
const cardButton = (page: Page, id: string) =>
  page.getByTestId(`command-${id}`);

// ---------------------------------------------------------------------------
// World setup helpers (existing World create conventions, via the debug hook)
// ---------------------------------------------------------------------------

async function getKeep(page: Page): Promise<BaseBuilding> {
  return page.evaluate(() => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const keep = sim.world.entities.find(
      (e): e is BuildingEntity =>
        !!e && e.kind === 'building' && e.player === 0 && !!e.isTownCenter,
    );
    if (!keep) throw new Error('Player 0 Keep not found');
    return {
      id: keep.id,
      type: keep.type,
      x: keep.x,
      z: keep.z,
      width: keep.width,
      height: keep.height,
    };
  });
}

/**
 * Spawns completed player-0 buildings on free, passable, gapped ground near the
 * Keep (nearest first) and returns them in request order.
 */
async function createBuildings(
  page: Page,
  types: readonly string[],
): Promise<BaseBuilding[]> {
  const result = await page.evaluate(
    (requested) => {
      const sim = window.__bordev?.sim;
      if (!sim) throw new Error('Simulation not initialized');
      const world = sim.world;
      const grid = world.grid;
      const size = world.map.size;
      const keep = world.entities.find(
        (e): e is BuildingEntity =>
          !!e && e.kind === 'building' && e.player === 0 && !!e.isTownCenter,
      );
      if (!keep) throw new Error('Player 0 Keep not found');
      const cx = keep.x + keep.width / 2;
      const cz = keep.z + keep.height / 2;

      const footprints: { x: number; z: number; w: number; h: number }[] = [];
      const units: { x: number; z: number }[] = [];
      for (const e of world.entities) {
        if (!e) continue;
        if (e.kind === 'building' || e.kind === 'mine') {
          footprints.push({ x: e.x, z: e.z, w: e.width, h: e.height });
        } else if (e.kind === 'unit') {
          units.push({ x: e.x, z: e.z });
        }
      }

      const candidates: { x: number; z: number; d: number }[] = [];
      for (let z = 2; z < size - 2; z++) {
        for (let x = 2; x < size - 2; x++) {
          const d = Math.hypot(x - cx, z - cz);
          if (d >= 6 && d <= 28) candidates.push({ x, z, d });
        }
      }
      candidates.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);

      const result: BaseBuilding[] = [];
      for (const type of requested) {
        const dims =
          type === 'cottage' ||
          type === 'chapel' ||
          type === 'farm' ||
          type === 'storehouse'
            ? 2
            : 3;
        let placed: BaseBuilding | undefined;
        for (const c of candidates) {
          let ok = true;
          for (let tz = c.z - 1; ok && tz <= c.z + dims; tz++) {
            for (let tx = c.x - 1; tx <= c.x + dims; tx++) {
              if (!grid.isPassable(tx + 0.5, tz + 0.5, 0)) {
                ok = false;
                break;
              }
            }
          }
          if (!ok) continue;
          for (const f of footprints) {
            if (
              c.x < f.x + f.w + 1 &&
              c.x + dims + 1 > f.x &&
              c.z < f.z + f.h + 1 &&
              c.z + dims + 1 > f.z
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          for (const u of units) {
            if (
              u.x > c.x - 1.5 &&
              u.x < c.x + dims + 1.5 &&
              u.z > c.z - 1.5 &&
              u.z < c.z + dims + 1.5
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const b = world.spawnBuilding(0, type, c.x, c.z, true);
          footprints.push({ x: b.x, z: b.z, w: b.width, h: b.height });
          placed = {
            id: b.id,
            type: b.type,
            x: b.x,
            z: b.z,
            width: b.width,
            height: b.height,
          };
          break;
        }
        if (!placed) throw new Error(`No free site for ${type}`);
        result.push(placed);
      }
      return result;
    },
    [...types],
  );
  await waitForTicks(page, 2);
  return result;
}

/** Cottages needed so `extraPop` more units fit under the population cap. */
async function cottagesFor(page: Page, extraPop: number): Promise<number> {
  return page.evaluate((extra) => {
    const sim = window.__bordev?.sim;
    if (!sim) throw new Error('Simulation not initialized');
    const p = sim.world.players[0];
    return Math.max(0, Math.ceil((p.pop + extra - p.popCap) / 10));
  }, extraPop);
}
/**
 * Waits for the keep's research to be active, then steps the Sim until it clears.
 * Returns the observed research progress/time and elapsed ticks so callers can
 * assert exact timing independent of how many ticks the session loop ran.
 */
async function finishActiveResearch(
  page: Page,
  buildingId: number,
  upgradeId: string,
): Promise<ResearchRun> {
  await page.waitForFunction(
    ([id, up]) => {
      const e = window.__bordev?.sim?.world.getEntity(id as number);
      return e?.kind === 'building' && e.research?.upgradeId === (up as string);
    },
    [buildingId, upgradeId] as const,
    { timeout: 5_000 },
  );
  return page.evaluate(
    ([id, up]) => {
      const sim = window.__bordev?.sim;
      if (!sim) throw new Error('Simulation not initialized');
      const b = sim.world.getEntity(id as number) as BuildingEntity;
      if (b.research?.upgradeId !== up) throw new Error('Research not active');
      const eventStart = sim.world.events.length;
      const startTick = sim.world.tick;
      const progressAtStart = b.research.progress;
      const time = b.research.time;
      let elapsed = 0;
      while (b.research && elapsed < 6000) {
        sim.step();
        elapsed++;
      }
      return {
        startTick,
        progressAtStart,
        time,
        elapsedTicks: elapsed,
        ageEvents: sim.world.events
          .slice(eventStart)
          .flatMap((ev) =>
            ev.kind === 'ageReached'
              ? [{ player: ev.player, age: ev.age }]
              : [],
          ),
      };
    },
    [buildingId, upgradeId] as const,
  );
}
/** Real command path for tests that only need the age, not the UI. */
async function researchByCommand(
  page: Page,
  buildingId: number,
  upgradeId: string,
): Promise<ResearchRun> {
  await page.evaluate(
    ([id, up]) => {
      window.__bordev?.issue({
        kind: 'research',
        player: 0,
        buildingId: id as number,
        upgradeId: up as string,
      });
    },
    [buildingId, upgradeId] as const,
  );
  return finishActiveResearch(page, buildingId, upgradeId);
}
async function centerOnEntity(page: Page, id: number): Promise<void> {
  await page.evaluate((target) => {
    const bordev = window.__bordev;
    const ent = bordev?.sim?.world.getEntity(target);
    if (!bordev || !ent) {
      throw new Error(`Cannot centre on entity ${target}`);
    }
    let x: number;
    let z: number;
    if (ent.kind === 'unit') {
      x = ent.x;
      z = ent.z;
    } else if (ent.kind === 'building' || ent.kind === 'mine') {
      x = ent.x + ent.width / 2;
      z = ent.z + ent.height / 2;
    } else {
      throw new Error(`Cannot centre on ${ent.kind} entity ${target}`);
    }
    bordev.session.input.camera.centerOn(x, z);
  }, id);
}

/** Waits until the entity's screen rect is non-empty and inside the playfield band. */
async function waitForVisibleInPlayfield(
  page: Page,
  id: number,
): Promise<void> {
  await page.waitForFunction(
    (target) => {
      const renderer = window.__bordev?.renderer;
      const rect = renderer?.getEntityScreenRect(target);
      if (!renderer || !rect) return false;
      const canvas = document.querySelector('canvas[aria-label="Game view"]');
      const topBar = document.querySelector('[data-testid="hud-topbar"]');
      const bottomBar = document.querySelector(
        '[data-testid="hud-bottom-bar"]',
      );
      if (!canvas || !topBar || !bottomBar) return false;
      const c = canvas.getBoundingClientRect();
      const top = topBar.getBoundingClientRect().bottom;
      const bottom = bottomBar.getBoundingClientRect().top;
      const cx = c.left + (rect.left + rect.right) / 2;
      const cy = c.top + (rect.top + rect.bottom) / 2;
      return (
        rect.right - rect.left > 4 &&
        rect.bottom - rect.top > 4 &&
        cx > c.left &&
        cx < c.right &&
        cy > top &&
        cy < bottom
      );
    },
    id,
    { timeout: 10_000 },
  );
}

/** Centres, picks and left-clicks a real building; asserts the click point is in the playfield. */
async function selectBuilding(page: Page, id: number): Promise<void> {
  await centerOnEntity(page, id);
  await waitForTicks(page, 2);
  await waitForVisibleInPlayfield(page, id);
  const field = await playfield(page);
  const pt = await pickablePoint(page, id);
  expect(pt.y).toBeGreaterThanOrEqual(field.top);
  expect(pt.y).toBeLessThanOrEqual(field.bottom);
  expect(pt.x).toBeGreaterThanOrEqual(field.left);
  expect(pt.x).toBeLessThanOrEqual(field.right);
  await page.mouse.click(pt.x, pt.y, { button: 'left' });
  await page.waitForFunction(
    (target) => {
      const sel = window.__bordev?.session.input.selection.ids;
      return sel !== undefined && sel.length === 1 && sel[0] === target;
    },
    id,
    { timeout: 5_000 },
  );
}

export {
  cardButton,
  getKeep,
  createBuildings,
  cottagesFor,
  finishActiveResearch,
  researchByCommand,
  selectBuilding,
  centerOnEntity,
  waitForVisibleInPlayfield,
};
export type { BaseBuilding, ResearchRun };
