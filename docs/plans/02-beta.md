# Stage 2 — Beta

**Goal**: content complete and feature complete. Both factions with final-quality art and animation, all upgrades, 3 AI difficulties per faction, 2–4 player skirmish with teams, 4 curated maps + random maps, balance and performance targets met. After Beta no new content or systems are added, only polish and fixes.

**Entry criteria**: Alpha exit gate checked by the user.

**Exit gate**:

- [ ] All M0–M8 goalposts checked.
- [ ] `npm run balance` report committed to `docs/balance/beta.md` meeting M6 targets.
- [ ] `npm run e2e` Beta smoke spec: 4-player match (human + 3 AI, both factions) runs 10 game-minutes at 8× speed via `__bordev.cheats.speed(8)` without errors.
- [ ] User plays one full match as each faction (vs Normal) and one 2v2; files issues; no issue labelled `blocker` remains open.

### M0 — Clans faction systems

Phases:

1. Clans data wired (units, buildings, upgrades from overview); faction-specific names for ages and buildings in command cards/tooltips.
2. Battle Fervor (faith surplus ≥ 5 ⇒ +1 attack, +2 with `blood_rites`), berserker regeneration, palisade/watchtower in Age I.
3. Faction choice in `SkirmishSetup`; starting TC/peasant/cart by faction.
4. First-pass art for all Clans assets (same quality bar as Alpha) so the faction is playable before final art.

Goalposts:

- [ ] Headless `--p1 clans:normal --p2 crown:normal --seeds 1-10` completes all games (AI uses a provisional Clans build order).
- [ ] Vitest: a Clans axeman's damage vs a man-at-arms is 5−1 = 4 normally and 5 during Battle Fervor.

### M1 — Art direction and lighting pass

Implements the overview's [Art direction](00-overview.md#art-direction) section in shared pipeline code plus a two-asset pilot, before the per-asset final art passes (M2, M3). Shared changes (lighting, look, bevel helper, human proportions, player colours, colour grade, grid, terrain) reach every existing asset through the full rebuild; per-asset reshaping of the remaining assets happens in M2 and M3.

Phases:

1. Review harness: `tests/e2e/art-review.spec.ts` is skipped unless `ART_REVIEW=<label>` is set. It uses `setupM4Session` and `capture` from `tests/e2e/fixtures/m4.ts` to write `build/review/<label>/<scene>-z<zoom>.png` at zoom 0.5, 1.0 and 1.5 for two scenes:
   - `start`: camera on player 0's start with the debug scene as booted.
   - `lineup`: on the M7 plain-grass area x 50..99, z 0..25, with debug walkers cleared via `clearDebugWalkers`. Stage one Crown Keep per player and, for each player, 3 peasants, 3 spearmen and 1 ox cart spaced 1.5 tiles apart.

   Run `ART_REVIEW=before` before any other phase.

2. Lighting and look: apply the overview's rig and look values in `art/blender/lib/rig.py` and `art/blender/lib/look.py`. First render the smallest representative cases (`calib_tile`, `calib_arrow`, one `crown_peasant` walk frame, and one `crown_keep` body/mask/shadow frame). Confirm that calibration output is unchanged and that the shadow pass contains only the key-sun shadow.
3. Shared modelling: in `art/blender/lib/model.py`, change `box` bevels to 2 segments with `limit_method = "ANGLE"` and add an optional `bevel` argument to `cylinder` and `cone`. In `art/blender/lib/characters.py`, apply the overview's character proportions: head 1.12×, hands 1.2×, legs as tapered cones (ankle radius 0.055, hip radius 0.068), tunic `r1` 0.24, and arms resting 0.10 rad away from the body. In `anim.character_clips`, add an idle weight shift (body roll ±0.03 rad) and a walk torso twist (±0.08 rad about Z, in phase with the legs).
4. Pilot assets:
   - **`crown_keep`** (`buildings.keep()`):
     - Gatehouse projects 0.4 forward from the front curtain wall, with an arched dark recess, existing door and portcullis, and three merlons.
     - Corner towers are 12-vertex tapered cones (radius 0.50 → 0.44), each with a corbel band and 8 crenellations.
     - The rear tower at (−1.45, 1.45) has a 12-vertex `ROOF` cone cap (radius 0.58, height 0.9), and the flag moves to that cap's tip.
     - The great-hall roof gets a 0.12 eave overhang, a `STONE_DARK` ridge cap and two dormers on the front (−Y) slope.
     - Masonry boxes use bevel 0.03; merlons use 0.02.
   - **`crown_peasant`**: overview proportions, segmented arms with a slight elbow bend, and the hoe held diagonally at idle.
5. Runtime:
   - Change the Blue, Red, Green and Yellow entries of `PLAYER_COLOURS` in `src/render/playerColours.ts` to the overview player-colour tints, `css` and `ghostCss` (Purple, Orange, Teal and Pink arrive in M4 phase 5), and change the team gain in `src/render/SpriteBatch.ts` from 1.25 to 1.1.
   - Attach the overview grade as an `ImageProcessingPostProcess` on `IsoCamera.camera`.
   - In `src/render/overlays/DebugGrid.ts`, implement the grid as always visible in rendering group 1 with the overview colour/alpha, and hide footprints by default.
   - Rename `Renderer.toggleDebugGrid` → `toggleDebugFootprints`, `Overlays.toggleGrid` → `toggleFootprints`, `isGridVisible` → `areFootprintsVisible` and `setGridVisible` → `setFootprintsVisible`, updating `src/input/Hotkeys.ts` and `src/input/Hotkeys.test.ts`.
   - Run the full `npm run e2e`.
6. Terrain: apply the overview grass/dirt values in `art/blender/render_terrain.py`, then run `npm run art:terrain`.
7. Rollout and record:
   - Run full `npm run art:build && npm run art:pack`, then capture `ART_REVIEW=after`.
   - Rewrite these overview sections to the implemented values: Rendering contract (team-colour formula and grid layer), Sprite pipeline (rig, look and terrain lines), the `G` sentence in Controls, the `G` sentence in the Debug hooks section, and the `G` sentence in `README.md`.
   - Change the overview Art direction section's "Implementation is scheduled…" sentences to state that M1 implemented it.

Goalposts:

- [ ] `npx vitest run tools/pack-atlas.test.ts` passes, and the `calib_tile` and `calib_arrow` atlas PNGs are byte-identical to their pre-milestone versions.
- [ ] Vitest (Babylon `NullEngine`): the tile grid is visible by default in rendering group 1; Keep footprints are hidden by default; `toggleDebugFootprints()` changes only footprint visibility.
- [ ] Greyscale luminance standard deviation (sharp `stats()`) for `public/terrain/grass.png` and `public/terrain/dirt.png` is each ≤ 65 % of its pre-milestone value; record before/after numbers here.
- [ ] Full `npm run art:build` completes in ≤ 90 minutes, and unchanged reruns of `art:build` and `art:pack` skip every asset.
- [ ] The user approves `build/review/after/` against `build/review/before/` at all three zooms. The approved images become the visual reference for M2 and M3.

### M2 — Final art pass (units)

Phases (one phase per 5 units; each phase delivers models, all anims, icons):

1. Crown: peasant, ox_cart, spearman, man_at_arms, halberdier.
2. Crown: longbowman, crossbowman, sergeant, knight, trebuchet.
3. Clans: thrall, haul_wagon, axeman, shield_bearer, berserker.
4. Clans: javelineer, hunter, horse_raider, war_rider, battering_ram.
5. Projectiles and effects sprites: arrow, bolt, javelin, trebuchet stone, hit sparks, dust puff, building-fire (3 sizes, 8-frame loops), rubble smoke; spawned by sim events in the renderer.

Art bar for every unit: readable silhouette at zoom 0.5; distinct per-faction palette (Crown: blues/whites/steel, stone grey; Clans: browns/furs/ochre, bone); team colour on ≥ 15 % of visible body pixels (tabard/shield/banner), measured from the mask atlas; walk cycle 8 frames with no foot-sliding at listed speed (stride length = speed × 8/12 s); attack impact on frame 5. Every unit also follows the overview's Art direction and is reviewed against the M1-approved `build/review/after/` reference; the peasant starts from the M1 pilot.

Goalposts:

- [ ] `npm run art:build` full rebuild completes on this machine in ≤ 90 minutes.
- [ ] Vitest mask-coverage test passes for all 20 units.
- [ ] Contact sheet `build/contact/units.png` (generated by `tools/pack-atlas.ts --contact`) reviewed by user: approved.

### M3 — Final art pass (buildings, doodads, terrain, UI)

Phases:

1. Crown 12 buildings: construct stages, idle, damaged (fires/cracks), rubble, gate open/closed, icons.
2. Clans 12 buildings: same.
3. Doodads: 8 tree variants (2 species per faction biome feel), 4 rocks, 3 bushes (decorative, passable), gold mine with 3 depletion stages.
4. Terrain textures final (starting from M1's retuned grass/dirt) + tile transition noise tuning; shoreline foam band in water shader.
5. UI art: HUD frame (Blender-rendered stone/wood panels, 9-slice), resource icons, command icons (move, stop, hold, attack-move, build menus, cancel, rally), cursors (default, attack, build, gather, invalid) — PNG, 32 px and 64 px.

Art bar for every building and doodad: follows the overview's Art direction (one focal point, one silhouette peak, eave and ridge treatment, angle-limited bevels), reviewed against the M1-approved `build/review/after/` reference; the Keep starts from the M1 pilot.

Goalposts:

- [ ] Occluded-unit silhouette: own units behind buildings render a player-colour outline (second sprite pass with depth test `GREATER`, alpha 0.6).
- [ ] Screenshot review at zoom 0.5 / 1.0 / 1.5 approved by user.

### M4 — Complete gameplay features

Phases:

1. All 16 upgrades implemented with tooltips; upgrade icons.
2. UX: idle-peasant button in the bottom bar showing the idle count (click or `Shift+.` selects all idle peasants and centres on the first; `.` keeps cycling one at a time); placement stays active after each placement (overview Controls), replacing Shift-to-repeat; idle military counter; `Space` alert jump; rally point to mine auto-assigns carts; drag-select filters workers out when mixed with military; attack-move ground marker; Tab cycles subgroups in multi-selection; production queue display with cancel on click; building HP/queue in selection panel; double-click a military building selects all owned on-screen buildings of that type (not off-screen or other types) and training orders split evenly across the selection; unit food/gold prices shown immediately in the training UI (not only on hover).
3. Notifications: under attack (throttled 1 per 10 s per area), building complete, research complete, unit trained (only when that unit empties its building's queue), mine depleted, player eliminated.
4. Game speed setting (0.5×, 1×, 1.5×, 2×) and pause (`P`). Debug builds add `__bordev.cheats.speed(x)` accepting 0.5–8 for tests; the settings UI offers only the four listed speeds.
5. Teams: `SkirmishSetup` 2–4 slots, each Human (slot 1, sim player 0, only) / AI (Easy/Normal/Hard) / Closed, faction, colour (the 8 overview palette colours, unique per slot), team 1–4; allies share vision, gates, no friendly fire; victory by last team standing.
6. Worker auto-work: workers finishing a build or repair job seek work per the overview Economy **Worker auto-work** rule (12 tiles; unfinished building first, then unworked farm).
7. Formations: `setFormation` command, per-unit stored formation, Line / Staggered / Box / Flank slot layouts, slowest-member speed matching and `A`/`S`/`D`/`F` card slots per overview Controls.
8. Melee engagement: contact slots and swing anchoring per the overview Combat model **Melee contact slots** bullet, fixing crowded melee units whose swings fail to land.

Goalposts:

- [ ] Vitest: allied units pass through each other's gates; allied fog shared; team victory declared when all enemy-team TCs are gone.
- [ ] E2E: pause freezes sim tick counter; 2× speed doubles ticks per real second ±10 %.
- [ ] Player-facing: double-clicking one owned military building selects every owned on-screen building of that type; off-screen buildings of that type and other building types stay unselected, and queued training is split evenly across the selected buildings.
- [ ] Player-facing: the training UI shows each unit's food and gold price as soon as it opens, with no hover needed.
- [ ] Vitest: a peasant finishing a cottage with a second unfinished own cottage 8 tiles away and an unworked farm 4 tiles away walks to and builds the cottage. With only a farm 13 tiles away, it stays idle.
- [ ] Player-facing: after one Cottage placement the ghost stays active, and a second click queues a second Cottage for the same peasants without reselecting. `Esc` ends placement.
- [ ] Player-facing: clicking the idle-peasant button (or `Shift+.`) selects every idle peasant.
- [ ] Vitest: 6 spearmen and 4 longbowmen in Line moved 20 tiles east on open grass arrive with every longbowman behind every spearman along the move direction, and arrival times are within 2 s of each other. In a knight + trebuchet Line group, no knight exceeds trebuchet speed before arriving.
- [ ] Vitest: in Box, every ranged unit of a 12-unit mixed group ends inside the convex hull of the melee units.
- [ ] Vitest: 12 spearmen ordered to attack one stationary man-at-arms (HP staged to 10 000) on open grass: within 20 s, ≥ 6 distinct spearmen land hits, and zero swings start without dealing damage while the target is stationary.
- [ ] Existing M7 duel matrix still passes unchanged.

### M5 — AI: three difficulties, both factions

Phases:

1. Refactor AI into managers per overview; `difficulty.ts` table:

| Param                      | Easy | Normal            | Hard                                                                       |
| -------------------------- | ---- | ----------------- | -------------------------------------------------------------------------- |
| decision interval (ticks)  | 60   | 30                | 10                                                                         |
| target peasants            | 12   | 18                | 24                                                                         |
| target carts               | 2    | 4                 | 6                                                                          |
| first attack (game minute) | 14   | 10                | 7                                                                          |
| micro                      | none | retreat < 30 % HP | retreat, focus fire lowest HP in range, archers kite melee                 |
| upgrades researched        | none | half (eco first)  | all                                                                        |
| counter-composition        | no   | no                | yes (spear/halberd/shield vs cavalry, cavalry vs archers, siege vs towers) |
| walls/towers               | no   | towers only       | towers + gated wall at chokepoints                                         |

The Normal column replaces the Alpha tuning recorded in the overview Simulation contract (12 peasants, 4 carts, first attack tick 9000 or army 10). For every difficulty, no attack wave launches before the listed first-attack minute; after it, waves follow the existing Alpha wave logic (army size ≥ 10, minimum wave size 3). M5 updates the overview's tuned-Normal sentence to the final values.

2. Build orders: `buildOrders/{crown,clans}_{easy,normal,hard}.json`.
3. Team AI: allies attack the same target; AI helps an ally under attack within 25 tiles.
4. Target selection: nearest known enemy building cluster; Hard prioritises carts/mines then TC.

Goalposts (headless, `npm run balance -- --matrix ai`):

- [ ] Hard beats Easy ≥ 90 %, Normal beats Easy ≥ 75 %, Hard beats Normal ≥ 65 % over 20 seeds per pairing per faction combination.
- [ ] No AI game stalls: every game ends before 72 000 ticks or with ≥ 1 building destroyed per 10 minutes after minute 15.

### M6 — Balance

Phases:

1. `tools/balance.ts`: runs matrices across maps/seeds/factions, outputs markdown with win rates, average game length, unit usage and kill/death per unit type, plus per-faction median gold and food collected per minute and banked gold and food at minutes 5, 10, 15 and 20.
2. Tune numbers in `src/data` and overview tables together (overview updated in the same change). Gold-economy tuning (playtest feedback) happens here: adjust mine gold, cart capacity/load times and unit gold costs until the banked-resource goalpost holds.

Goalposts:

- [ ] Crown vs Clans, Normal vs Normal, 40 seeds × 4 maps: each faction wins 40–60 %.
- [ ] Median game length Normal vs Normal 1v1: 18–30 minutes.
- [ ] Every unit type has ≥ 3 % share of AI army production for its faction (no dead units).
- [ ] Normal vs Normal, 40 seeds × 4 maps: median banked gold and median banked food at minutes 10 and 20 are each ≤ 500 for both factions (neither resource floats).

### M7 — Maps

Phases:

1. Full `tools/mapgen.ts`: templates `lowlands` (open), `riverlands` (river with 3 shallow fords), `forest_pass` (forest walls with chokepoints), `highland_ring` (rock ring centre); rotational symmetry for 2/3/4 players; guarantees from overview; contested central mines.
2. Curated maps committed: `lowlands_2p`, `riverlands_2p`, `forest_pass_3p`, `highland_ring_4p`; `Random` option in setup picks template + random seed.
3. Validation test: every start reaches every other start; each start has 3 mines within 18 tiles; no mine within 5 tiles of an enemy start.

Goalposts:

- [ ] Map validation Vitest passes for curated maps and 100 random seeds per template.

### M8 — Performance and stability

Phases:

1. `bench:sim -- --units 600 --players 4` scenario (armies fighting + economies).
2. Optimise hot paths found by profiling (`node --cpu-prof`); typed-array hot state where needed.
3. Render: instance buffer reuse without per-frame allocation; frustum-cull sprite submission by screen rect; texture memory report.
4. Soak test: headless 4-player Hard AI games × 20 seeds with `--check-invariants` (no NaN positions, no entity on blocked tile for > 2 s, resources never negative, pop ≤ cap).

Goalposts:

- [ ] Sim tick average ≤ 8 ms, p99 ≤ 16 ms at 600 units.
- [ ] World draw calls ≤ 80; renderer CPU prep ≤ 4 ms per frame at 600 units (measured with `performance.now()` in `stats()`).
- [ ] Soak: zero invariant violations, zero exceptions.
- [ ] GPU texture memory for all atlases ≤ 512 MB (sum of page sizes × 4 bytes × 1.33 mipless estimate reported by AtlasCache).
