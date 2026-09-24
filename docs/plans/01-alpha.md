# Stage 1 — Alpha

**Goal**: every core system of the game works end to end using the **Crown** faction only (AI also plays Crown), on one generated test map, with first-pass Blender art. Visual quality and balance are not goals; completeness and correctness are.

**Entry criteria**: `docs/plans/00-overview.md` approved.

**Exit gate** (all must hold):
- [ ] `npm run typecheck && npm run lint && npm test` pass.
- [ ] `npm run sim:headless -- --map alpha_test --p1 crown:normal --p2 crown:normal --seeds 1-10` finishes all 10 games with a winner within 72 000 ticks (60 game-minutes), zero exceptions.
- [ ] `npm run e2e` passes the Alpha smoke spec (boot → skirmish → debug-cheat to Age III → train one of each Crown unit → destroy enemy Keep → victory screen).
- [ ] `npm run bench:sim -- --units 300` reports average tick ≤ 4 ms.
- [ ] User plays a full match in the browser vs Normal AI and reaches victory or defeat without blockers.

### M0 — Project foundation

Phases:
1. Scaffold Vite + React 19 + TypeScript project in repo root with the layout and npm script names from the overview; pin versions (`@babylonjs/core` 9.x, `vite` 8.x, `react` 19.x, `typescript` 7.x, `vitest` 5.x, `@playwright/test` 1.63.x, `zustand` 5.x, `sharp`, `maxrects-packer`, `tsx`, `eslint` 10 + typescript-eslint, `prettier`).
2. ESLint `no-restricted-imports` rule forbidding `@babylonjs/*`, `react`, and `src/render|ui|input|game` imports inside `src/sim/**` and `src/data/**`.
3. `.gitignore` (`node_modules`, `dist`, `build/`, `test-results`, `playwright-report`); commit generated `public/` assets.
4. Playwright config: Chromium headless with `--use-angle=swiftshader --enable-unsafe-swiftshader`, `webServer` = `npm run preview`.
5. GitHub Actions workflow `.github/workflows/ci.yml`: ubuntu-latest, Node 26, `npm ci`, typecheck, lint, test, build, e2e.

Goalposts:
- [x] `npm run dev` serves a page with a full-window Babylon canvas clearing to a solid colour and a React "bordev" overlay.
- [x] `npm run build` produces `dist/`; `npm test` runs a placeholder sim test; `npm run e2e` loads the page and asserts the canvas exists and no console errors.
- [x] Importing `@babylonjs/core` from a file in `src/sim` fails `npm run lint`.

M0 verified: clean `npm ci`, typecheck, lint, one Node sim-environment test, production build, and one Chromium boot smoke passed. The smoke observes an opaque rendered frame and live WebGL context as well as canvas bounds, overlay, and zero console/page errors. Dev-page screenshots confirmed the solid clear and React overlay; resizing to 1024×768 resized both the canvas bounds and drawing buffer. A temporary Babylon import produced `no-restricted-imports` and lint exit 1; 105 allowed/forbidden import cases across sim/data passed. Temporary fixtures were removed.

Local browser verification used extracted Ubuntu libraries through `LD_LIBRARY_PATH`, because this headless host lacks Chromium system dependencies and passwordless sudo. CI installs dependencies with Playwright's `--with-deps`; the workflow itself has not been run on GitHub. Vite reports a non-fatal 500 kB chunk warning (main chunk approximately 851 kB, 218 kB gzip); no warning limit was raised.

### M1 — Sprite pipeline v1

Phases:
1. `art/blender/lib/rig.py`, `look.py`, `materials.py` (`TEAM` material convention), `anim.py` (keyframe helpers for rigid-part hierarchies: bob, swing, lean, fall), `io.py` (pass/anim/dir/frame output paths); `render_asset.py` CLI with `--asset`, `--out`, `--only-anim`, `--only-dir`.
2. Calibration assets: `calib_tile` (1×1 tile diamond with red +X and blue +Z edge markers) and `calib_arrow` (arrow pointing along model forward, 8 dirs, 1 frame).
3. `tools/pack-atlas.ts` and `tools/art-build.ts` per overview (parallelism 4, hash cache).
4. Vitest `tools/pack-atlas.test.ts`: packs `calib_tile`, asserts its trimmed diamond is 96±1 × 48±1 px and anchor lies at the diamond centre ±1 px; `calib_arrow` dir 0 points screen-down, dir 2 screen-left (dominant arrow-tip pixel quadrant).
5. First-pass Crown assets (low-poly, simple anims): `crown_peasant`, `crown_ox_cart`, `crown_spearman`, `crown_keep`, `crown_cottage`, `crown_farm`, `gold_mine`, `tree_1`–`tree_4`, `rock_1`–`rock_2`.
6. `render_terrain.py` producing grass, dirt, sand, shallow, water, rock-ground textures.

Goalposts:
- [x] `npm run art:build && npm run art:pack` regenerates all M1 atlases from scratch on this machine; a second run skips everything (cache).
- [x] Calibration test passes.
- [x] Each atlas JSON validates against the overview format (Vitest schema test over `public/atlases/*.json`).
- [x] Terrain textures tile seamlessly (Vitest: left/right and top/bottom edge pixel columns differ by mean < 3/255).

M1 verified on Blender 5.2.2 LTS: generated all 15 assets (650 atlas frames, 1,325 raw body/mask/shadow passes), 15 atlas pages and six 512×512 terrain textures. The initial render was interrupted after sprites completed; resuming generated terrain and packed every atlas. A subsequent `npm run art:build && npm run art:pack` skipped all 15 assets, terrain, and all atlas packs in 2.4 s.

`npm run typecheck`, `npm run lint`, `npm test` (16 tests), and `npm run build` passed. Calibration is exactly 96×48 with anchor (48,24), red +X right/down and blue +Z left/down; arrow direction tests pass. Public atlas schema/frame-count/pass-alignment tests and all six terrain seam tests pass. A full raw-image smoke found zero occupied outer-edge pixels across all 1,325 passes and visible changes in every multi-frame animation; the packed asset contact sheet was inspected. Freestyle was confirmed by an actual on/off render comparison; building/doodad shadows are separate ground-cast shadows, not duplicated body silhouettes.

Art commands, cache inputs, partial-render invocation, atlas page/trim conventions, and Blender 5.2 compositor details are documented in the overview. The existing non-fatal Vite 500 kB chunk warning remains unchanged. M2 world rendering is not part of this milestone.

### M2 — World rendering

Phases:
1. `render/IsoCamera`: orthographic camera per rendering contract; zoom 0.5–1.5 around cursor; pan clamped to map diamond + 4 tiles margin.
2. Iso math module `render/iso.ts` (`worldToScreen`, `screenToGround`) with Vitest tests of the axis convention.
3. `render/Terrain`: map → splat textures → ground `ShaderMaterial`; water UV animation.
4. `render/AtlasCache` + `render/SpriteBatch` (thin instances, team mask, alpha discard 0.5, depth write) and procedural unit shadow ellipses; building shadow layer.
5. `tools/mapgen.ts` minimal version generating `alpha_test` (2 players, grass/dirt/forest/rock/shallow/water, 3 mines per start + 4 contested) — full generator comes in Beta.
6. Debug scene: renders `alpha_test` with trees, rocks, mines, 2 Keeps and 50 random Crown sprites cycling walk animation in all 8 dirs.

Goalposts:
- [ ] Screenshot of the debug scene shows correct 2:1 diamond grid alignment: a Keep's footprint diamond matches a 4×4 tile overlay drawn by `Overlays` (debug grid toggle `G`).
- [ ] Sprites behind (north of) a Keep are hidden by it; sprites in front draw over it.
- [ ] Draw calls for the debug scene ≤ 30 (`scene.getEngine()._drawCalls` / instrumentation logged in `stats()`).

Implementation notes (M0/M1 review):
- `tools/pack-atlas.ts` sizes pages to their content (`smart: true, pot: false`; e.g. `calib_tile` 100×52, `crown_peasant` 1254×1202), not 2048×2048, and the atlas JSON records no page dimensions. `AtlasCache`/`SpriteBatch` must normalise `iUV` by each loaded texture's actual size. Correct the overview's "packs into 2048×2048 pages" wording in the same change.
- Building, mine and doodad sprites anchor at the footprint centre (Blender origin). Place them at top-left tile + size/2; the Keep footprint goalpost verifies this. Document the anchor rule in the overview's Sprite pipeline and Map format sections.

### M3 — Simulation core

Phases:
1. `sim/rng.ts`, `sim/world.ts`, `sim/entity.ts`, `sim/commands.ts`, `sim/map.ts` (loads map JSON), `sim/grid.ts`, `sim/spatialHash.ts`, `sim/sim.ts` (`step`, `issue`, event queue for the UI: `unitCreated`, `unitDied`, `buildingCompleted`, `underAttack`, `ageReached`, `playerEliminated`).
2. `sim/path/astar.ts`, `components.ts`, `pathQueue.ts` per contract.
3. `systems/movement.ts`: seek, separation, formations, stuck repath, shallow-water slowdown, facing index.
4. `data/*.ts`: all Crown and Clans tables from the overview as typed consts (Clans used from Beta).
5. `game/GameSession`: fixed-step accumulator, interpolation, owns Sim + Renderer.

Goalposts:
- [ ] Vitest: a unit ordered across `alpha_test` around a forest reaches within 0.5 tiles of its target; a unit ordered into a walled-off pocket stops at the nearest reachable tile; 20 units ordered to one point end with no pair overlapping by more than 0.1 tiles.
- [ ] Vitest: two sims with seed 7 and the same command log produce identical entity positions after 2 000 ticks.
- [ ] `bench:sim -- --units 300` (all moving randomly) ≤ 4 ms average tick.

### M4 — Selection, orders and HUD shell

Phases:
1. `input/SelectionController`: click, box, shift, double-click type-select, control groups.
2. `input/OrderController`: context right-click per overview; shift-queue; move/attack-move markers.
3. `input/CameraController`: arrows, edge scroll, middle drag, wheel, `H`, double-tap group.
4. `render/Overlays`: selection ellipses, health bars, rally lines, waypoint markers.
5. React HUD: `TopBar` (food, gold, faith used/produced, pop), `SelectionPanel` (single: portrait, HP, stats; multi: portrait grid), `CommandCard` (3×5 with hotkeys), fed from zustand store updated at 10 Hz from `GameSession`.
6. `Minimap` canvas (terrain, units as player-colour dots, camera trapezoid), click to jump, right-click to move.

Goalposts:
- [ ] E2E: box-select 5 debug-spawned peasants via mouse drag; right-click ground; within 20 s game time all 5 are within 2 tiles of the target (`__bordev.sim` query).
- [ ] Ctrl+1 then 1 reselects the group; hotkey `W` stops them.
- [ ] HUD numbers match sim state after cheats (`cheats.resources(1000)` → TopBar shows 1000 food and gold).

Implementation notes (M0/M1 review): fix before M5 starts rendering cart loading.
- `crown_ox_cart` `load` is declared `loop: true` in `art/manifest.json` and `anim.CART_ANIMS`, but the clip is a one-way fill (cargo scale 0.12 → 1.0). At 12 fps it would refill about 18 times per 6 s load. Set `loop: false` in both places (last frame holds) or make the clip cyclic, then rebuild and repack `crown_ox_cart`.

### M5 — Economy and construction

Phases:
1. `systems/construction.ts`: placement validation (in bounds, all footprint tiles free and explored, not overlapping units — units get pushed out), cost deduction on placement, builders, `3T/(n+2)` rule, construct frames at 0/50/100 %, repair at 50 % build rate free of cost, cancel refunds 100 % if 0 % built else 50 %.
2. `input/PlacementController`: ghost, Esc cancel, Shift keeps placing, wall/palisade drag lines (straight or L, tile by tile), gate orientation from wall line or `R` rotate.
3. `systems/economy.ts`: carts loop, mine queueing (2 loaders), drop-off selection, depletion retargeting; farms + farmers; pinMine.
4. `systems/faith.ts`: produced/used, Low Faith flag; population and cap.
5. Crown buildings with first-pass art: `storehouse`, `chapel`, `barracks`, `archery_range`.

Goalposts:
- [ ] Headless test: from standard start with scripted commands (build 2 farms, 1 cottage, train 1 more cart), after 5 game-minutes food ≥ 600 and gold ≥ 500 collected in total (sim counters).
- [ ] Building a barracks while faith produced is 5 and used would become 7 puts the player in Low Faith; a unit then trains in 2× its listed time (Vitest).
- [ ] A mine with 3 carts never has more than 2 loading at once and depletes exactly at 6000 delivered + carried.

Implementation notes (M0/M1 review): harden the sprite pipeline before phase 5 renders new building art (and before M6 adds the remaining Crown units).
- `art:pack` must refuse an asset whose `build/renders/<id>/.hash` marker is missing. Today it packs whatever frames exist, so running it after an interrupted `art:build` writes a mix of stale and new frames into tracked `public/atlases/` and exits 0.
- Add the resolved `maxrects-packer` version to the atlas cache key (`tools/pack-atlas.ts`, next to `sharp.versions`); it alone decides frame placement and page splits.
- Frame counts live in both `art/manifest.json` and `art/blender/lib/anim.py`, but `render_asset.py` only cross-checks animation names. Validate counts and loop flags too.
- Delete unused `anim.keyframe`, `anim.STATIC_ANIMS` and the no-op per-frame `scene.frame_set` in `render_asset.py`: clips pose objects directly.

### M6 — Production and progression

Phases:
1. `systems/production.ts`: per-building queue of up to 5, pop blocking, rally points (ground or unit/building), cancel refund 100 %.
2. Ages I→III research with requirements; age-gated command card entries greyed with tooltip listing missing requirements.
3. Upgrades system with effect application (stat modifiers stack additively per upgrade), first Crown upgrade (`heavy_plough`) wired end to end; the rest in Beta.
4. Crown `stable`, `siege_workshop` buildings and all remaining Crown units' first-pass art.

Goalposts:
- [ ] Vitest: Age II research is unavailable until 2 qualifying buildings are complete; completes in 40 s (800 ticks) normally and 80 s in Low Faith.
- [ ] E2E (with cheats): train one of each of the 10 Crown units; all appear at the rally point.

### M7 — Combat, towers, walls and gates

Phases:
1. `systems/combat.ts`: target acquisition via spatial hash every 10 ticks, chase, melee hit frame, ranged projectiles (`systems/projectiles.ts`), bonus damage, min range, siege armor rule, death/corpse/rubble, building destruction frees grid + recomputes components.
2. Attack-move, hold position, attack building, auto-retaliation for idle units.
3. Towers and Keep arrows; Sanctuary aura (`systems/auras.ts`).
4. Stone wall/gate/tower art; gates open (animation frame swap) when an owned/allied unit is within 1 tile.

Goalposts:
- [ ] Vitest duel matrix (deterministic seed): 10 spearmen beat 5 knights; 5 knights beat 10 longbowmen in open ground; a trebuchet destroys a stone tower in 3 hits (200 + 250 bonus vs 1000 HP); a man-at-arms hitting a stone wall removes exactly `max(1, 6−8) + 2 = 3` HP per hit.
- [ ] Enemy units path around a closed wall ring; owner units pass through its gate; a unit inside a fully walled enemy base with no gate is unreachable and attack orders against it make attackers target the wall.

### M8 — Fog of war

Phases:
1. `systems/fog.ts` per contract, ghosts for enemy buildings/mines.
2. `render/FogTexture` + terrain shader integration; hide non-visible enemy sprites and health bars; minimap respects fog.
3. Placement requires explored tiles.

Goalposts:
- [ ] At match start only the area around the player's Keep is visible; the rest is black.
- [ ] An enemy building seen then left behind remains drawn as a ghost at last-seen HP/state; if destroyed while unseen, the ghost disappears only after its tile becomes visible again.
- [ ] Fog update cost ≤ 0.5 ms per update at 300 units (bench output).

### M9 — Skirmish flow and Normal AI

Phases:
1. Screens: `MainMenu` (Skirmish, Quit placeholder), `SkirmishSetup` (map = alpha_test, 2 slots, faction locked to Crown, AI difficulty locked to Normal, player colour), `GameScreen`, `Results` (winner, time, units trained/lost, resources gathered).
2. `systems/victory.ts`: elimination rule from overview; game menu (Esc) with Resume / Surrender / Quit to menu.
3. AI v1 (`sim/ai/*`) for Crown Normal: JSON build order (peasants to 12, carts to 4, farms per 4 peasants, cottages at pop-cap − 5, storehouse near far mines, barracks, archery range, Age II, stable, Age III, workshop); military composition per age; attack wave when army ≥ 12 or at minute 10; defend when own buildings attacked within 20 tiles; retreat units under 30 % HP to base.
4. `tools/sim-headless.ts` (args `--map`, `--p1 faction:difficulty` … `--p4`, `--seeds a-b`, `--max-ticks`, `--json`) printing winner, duration, per-player stats.
5. Alerts: "Under attack", "Age reached", "Not enough gold/food/population/faith" toasts with `Space` jump.

Goalposts:
- [ ] Exit-gate headless run (10 seeds) passes.
- [ ] A human who does nothing loses to Normal AI before minute 25 in 3/3 seeds (headless with an idle player slot `none`).
- [ ] Alpha E2E smoke spec passes.
