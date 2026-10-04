# bordev

A single-player 2.5D medieval RTS for the browser. It combines Command & Conquer–style base building with Age of Empires–style peasants, farms and ages. Two asymmetric factions, the feudal **Crown** and the northern **Clans**, fight skirmishes against AI on 128×128 isometric maps. Babylon.js draws the sprites, which are pre-rendered from procedurally modelled Blender scenes.

> **Status: early Alpha, not playable yet.** This README is for developers. The game design, locked decisions and technical contracts are in [`docs/plans/00-overview.md`](docs/plans/00-overview.md), which is the source of truth. Progress is tracked in [`docs/plans/01-alpha.md`](docs/plans/01-alpha.md).

## Current state

| Milestone | State |
|---|---|
| M0 Project foundation | ✅ done |
| M1 Sprite pipeline v1 (15 Blender assets, atlases, terrain textures) | ✅ done |
| M2 World rendering (iso camera, terrain, sprite batches, shadows, overlays) | ✅ done |
| M3 Simulation core (20 Hz fixed step, grid, A*, movement, determinism) | ✅ done |
| M4 Selection, orders and HUD shell | ⏭ next |
| M5–M9 Economy, production, combat, fog, skirmish flow and AI | not started |

`npm run dev` currently loads `public/maps/alpha_test.json`, runs the sim at 20 Hz and renders the terrain along with a debug scene: the map's start units plus 40 seeded Crown units for player 0, in all eight facings. There is no selection, HUD or AI yet, so you interact through the [debug hook](#debug-hooks). The sim accepts the `move`, `attackMove` (movement only), `stop`, `hold` and `delete` commands. Other command kinds throw until their systems are built.

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 26.8.1 (`.nvmrc`, `engines: 26.x`) | everything |
| npm | 12 | `npm ci`. The pinned esbuild install script is allowed through `allowScripts` in `package.json` |
| Playwright Chromium | `@playwright/test` 1.63 | `npm run e2e` |
| Blender | 5.2 LTS on `PATH` as `blender` | regenerating art only |

Development runs on a headless Linux box with no GPU. Blender renders with Cycles on the CPU, and Playwright uses SwiftShader WebGL. You only need Blender to change art: the generated atlases, terrain textures and maps are committed under `public/`.

## Quick start

```sh
nvm use
npm ci
npm run dev        # Vite on :5173, bound to all interfaces (server.host: true)
```

On a headless machine, open `http://<host>:5173/` from another machine. The `G` key toggles the tile grid and Keep footprints, middle-drag pans, and the wheel zooms around the cursor (0.5–1.5).

Do not use `npm install --force` or `--legacy-peer-deps`. See [TypeScript and lint toolchain](#typescript-and-lint-toolchain) for the reason.

## Commands

The script names are fixed by the overview. Arguments to tools go after `--`.

| Script | What it does |
|---|---|
| `dev` | Vite dev server with HMR and the debug hook enabled |
| `build` | `tsc -b && vite build` → `dist/` |
| `preview` | Serves `dist/` at `127.0.0.1:4173` (strict port, also used by e2e) |
| `test` / `test:watch` | Vitest (Node environment) over `src/**/*.test.ts` and `tools/**/*.test.ts` |
| `e2e` | Playwright specs in `tests/e2e/` against `npm run preview`. **Run `npm run build` first** |
| `lint` | ESLint, including the sim/data import seam (see below) |
| `typecheck` | `tsc -b` across all three TS projects |
| `art:build` | Renders sprites and terrain through Blender into `build/` (cached). `-- --asset <id>` renders one asset |
| `art:pack` | Packs `build/renders/` into `public/atlases/` (cached). `-- --asset <id>` packs one asset |
| `art:terrain` | Re-renders the six terrain textures directly, with no cache |
| `map:gen` | Deterministic map generator, e.g. `-- --seed 1 --players 2 --out alpha_test` |
| `bench:sim` | Headless sim tick benchmark, e.g. `-- --units 300` |
| `sim:headless`, `balance`, `desktop:dev`, `desktop:build` | Names are reserved but not implemented yet (the tool files and Electron are missing) |

### Before pushing

CI (`.github/workflows/ci.yml`, ubuntu-latest) runs these steps in this order:

```sh
npm run typecheck && npm run lint && npm test && npm run build && npm run e2e
```

When the job fails, CI uploads `playwright-report/` and `test-results/` as artifacts.

## Repository layout

```
src/
  main.tsx          React root → app/GameScreen
  app/              screens (GameScreen today; menus/setup/results arrive in M9)
  game/             GameSession: owns Sim + Renderer, fixed-step loop, debug hook
  render/           Babylon: Renderer, IsoCamera, Terrain, SpriteBatch, AtlasCache,
                    UnitShadows, Overlays, DebugScene, iso math
  sim/              PURE TypeScript simulation: sim, world, entity, commands, rng,
                    map, grid, spatialHash, path/ (A*, components, queue), systems/
  data/             typed design tables: units, buildings, upgrades, ages, factions,
                    combat, economy, terrain
  assets/           art manifest + atlas JSON types/parsers (shared with tools)
  input/ ui/        empty placeholders until M4
art/
  manifest.json     every renderable asset (id, kind, script, frame size, dirs, anims)
  blender/          render_asset.py, render_terrain.py, lib/ (rig, look, materials, …),
                    assets/<id>.py (one script per asset)
tools/              art-build, pack-atlas, mapgen, bench-sim (+ tests); eslint/ workspace
tests/e2e/          Playwright specs
public/             GENERATED and COMMITTED: atlases/, terrain/, maps/
build/              GENERATED and IGNORED: raw renders, logs, caches
docs/plans/         overview + stage plans (alpha, beta, pre-release, release)
```

`RTS_STAGE_PLANS_PLAN.md` is the original planning brief that produced `docs/plans/`. Use `docs/plans/` instead.

## Architecture

```mermaid
flowchart LR
  Input["input/ + ui/ (M4+)"] -- Command --> Issue["sim.issue()"]
  AI["sim/ai (M9)"] -- Command --> Issue
  Issue --> Step["Sim.step() @ 20 Hz"]
  Step -- "interpolated snapshot" --> Render["render/ (Babylon)"]
  Step -- "drainEvents()" --> HUD["ui/ HUD"]
```

- **The sim/data seam.** `src/sim` and `src/data` may not import Babylon, React, the DOM, or `src/{render,ui,input,game,app}`. ESLint enforces this for static imports, `import()` and `import type`. `tsconfig.sim.json` also compiles these directories with ES2023 libs only, so no DOM or Node types are available. This keeps the sim runnable in Node for tests, benchmarks and the planned headless AI matches.
- **Determinism.** All randomness goes through `Rng` (mulberry32, seeded per match). The same seed and the same command log produce the same outcome, and a test checks this. Never call `Math.random()` in `src/sim`. Debug-only spawning uses its own `Rng`.
- **Commands.** Input and AI mutate state only through `sim.issue(cmd)`. The command is copied and applied at the start of the next tick. `Command` is a discriminated union on `kind`, and every command carries `player`. Unit commands carry `ids` and an optional `queued`.
- **Loop.** `GameSession` steps the sim at `SIM_DT = 0.05` s using an accumulator, then renders with `alpha = acc / SIM_DT` interpolation. Rendering never mutates sim state.
- **Entities.** A dense array indexed by numeric id, with a free list. Entities are plain objects tagged by `kind` (`unit | building | mine | projectile | doodad`). There is no class hierarchy.
- **Coordinates.** World +X projects to screen (+48, +24) px per tile and +Z to (−48, +24) at zoom 1. Tile (0,0) is the top corner of the map. Map JSON stores top-left tiles for footprints, but sprites anchor at the footprint centre.

The rendering, pathfinding, fog and sprite contracts are in the overview's [Technical architecture](docs/plans/00-overview.md#technical-architecture) section. Read it before changing those systems.

## Testing

**Unit and integration (Vitest).** Tests run in a Node environment and read the committed `public/` assets, so Blender is not required. Assert observable outcomes, such as a unit arriving or two seeded runs matching, rather than internals.

```sh
npm test
npx vitest run src/sim/movement.test.ts      # single file
```

A test file is type-checked by the TS project that owns its directory. Tests under `src/sim` and `src/data` therefore have no DOM or Node types.

**Browser (Playwright).** Chromium runs headless with SwiftShader at 1280×720. Specs drive the game through `window.__bordev`.

```sh
npx playwright install --with-deps chromium  # once; system deps need sudo on Linux
npm run build && npm run e2e
npx playwright test boot                     # single spec (still needs a fresh build)
```

The Playwright config starts its own `npm run preview` with `reuseExistingServer: false`, so port 4173 must be free. Failure screenshots and traces go to `test-results/`, and the HTML report goes to `playwright-report/` (both gitignored).

**Performance.**

```sh
npm run bench:sim -- --units 300   # flags: --ticks --warmup --seed --map <path> --max-ms
```

The benchmark reports tick percentiles and path-expansion counters. With 300 or more units, it exits non-zero if the average tick exceeds `--max-ms` (default 4).

## Debug hooks

The hook is available in dev builds, or in any build when the URL includes `?debug=1`.

```js
window.__bordev = { session, renderer, sim /* null while loading */, issue(cmd), stats() }
```

`stats()` reports load and error state, the tick, FPS, the accumulator, and renderer stats (draw calls, visible sprites, frame timings, camera, depth probes). The ids of the debug-scene units, all owned by player 0, are on the renderer:

```js
const ids = __bordev.renderer.debugProbes.allDebugUnitIds.slice(0, 5);
__bordev.issue({ kind: 'move', player: 0, ids, x: 40, z: 40 });
```

Economy, fog and construction cheats (`cheats.*` in the overview) will appear once those systems exist.

## Art pipeline

Read the sprite-pipeline section of [`docs/plans/00-overview.md`](docs/plans/00-overview.md#sprite-pipeline) before changing Blender rendering or atlas conventions. It records verified Blender 5.2 behaviour.

```
art/manifest.json + art/blender/assets/<id>.py + art/blender/lib/*.py
   │  npm run art:build      (≤4 Blender processes × 2 threads, logs → build/logs/<id>.log)
   ▼
build/renders/<id>/<pass>/<anim>/<dir>/<frame>.png      passes: body, mask, shadow*
   │  npm run art:pack       (50% Lanczos downscale, trim, maxrects pack)
   ▼
public/atlases/<id>.json + <id>_<page>.png / _mask.png / _shadow.png   (committed)
public/terrain/<type>.png                                              (committed)
```

\* Shadow passes are rendered only for buildings and doodads.

- **Adding an asset.** Add a manifest entry, then add `art/blender/assets/<id>.py` exposing `build()` and `anims()`. Name the team-coloured material `TEAM`. Run `npm run art:build -- --asset <id> && npm run art:pack -- --asset <id>`.
- **Previewing one animation or facing** without touching the cache:
  ```sh
  blender -b --factory-startup -t 2 --python-exit-code 1 --python art/blender/render_asset.py \
    -- --asset crown_peasant --out build/preview --only-anim walk --only-dir 2
  ```
- **Renderer changes.** Render the smallest representative cases first: `calib_tile`/`calib_arrow`, one animated unit frame, and one building body/mask/shadow frame. Check projection, alpha, TEAM coverage and shadow bounds, then start a full build.
- **Caching.** A raw render is skipped when its hash covers the Blender version, manifest entry, asset script, shared `lib/`, renderer and build tool, and every expected output exists. Packing hashes the frame contents, manifest, packer/schema and sharp version. After a full build, an unchanged rerun should skip everything. To force a complete rebuild, delete `build/`. The tracked `public/` files are overwritten, not deleted.
- **Known caveat.** `art:pack` does not yet check for the `build/renders/<id>/.hash` success marker. If you run it after an interrupted `art:build`, it can pack a mix of stale and new frames into `public/atlases/` without failing. This is fixed in M5. Until then, rerun `art:build` to completion before packing.

## Maps

```sh
npm run map:gen -- --seed 1 --players 2 --out alpha_test   # → public/maps/alpha_test.json
```

The generator is deterministic and produces rotationally symmetric 128×128 maps. Only 2 players are supported until Beta. The committed seed-1 `alpha_test` map is a test fixture: the movement tests and `bench:sim` import it, so regenerating it with different parameters changes their inputs. The JSON format is in the overview's [Map format](docs/plans/00-overview.md#map-format) section.

## TypeScript and lint toolchain

- `tsc -b` runs three projects:
  - `tsconfig.app.json`: browser `src/`, excluding sim/data and tests.
  - `tsconfig.sim.json`: `src/sim` and `src/data`, including their tests, with ES2023 libs only.
  - `tsconfig.node.json`: configs, `tools/`, `tests/`, and all other `*.test.ts`.
- TypeScript 7 handles typecheck and build. typescript-eslint still needs the TypeScript 6 compiler API, so `tools/eslint/` is an npm workspace pinned to TypeScript 6.0.3 for linting only. A `ts-api-utils` override in `package.json` keeps the parser away from TS 7.
- Prettier config: single quotes, trailing commas. There is no script, so use `npx prettier --write <files>`. Generated `public/` assets and the lockfile are ignored.

## Contributing workflow

- Design changes go into [`docs/plans/00-overview.md`](docs/plans/00-overview.md) first, then into the affected stage plan.
- Work is organised as stage → milestone → phase. Mark a goalpost `- [x]` in the stage file only when it passes. Don't start a stage before the user has signed off the previous stage's exit gate.
- Agent-specific rules (parallel work, line-targeted edits, render-before-full-build) are in [`AGENTS.md`](AGENTS.md).
