# bordev — Project Overview & Locked Decisions

This file is the single source of truth for design and architecture. Stage plans (`01-alpha.md` … `04-release.md`) reference it. Any change to a locked decision is made here first, then in the affected stage plan.

## Vision

A single-player 2.5D real-time strategy game in the browser: Command & Conquer's readable, punchy base-building and army control combined with Age of Empires' peasants, farms and ages, set in a stylised medieval world. Two asymmetric factions — the feudal **Crown** and the northern **Clans** — fight skirmishes on 128×128-tile maps against up to three AI opponents. All art is pre-rendered from procedurally-modelled Blender scenes into painterly isometric sprites and drawn by Babylon.js.

## Locked decisions

| Area | Decision |
|---|---|
| Rendering style | Pre-rendered sprites (Blender → PNG atlases), drawn by Babylon.js on a flat 3D ground plane with an orthographic camera |
| Projection | 2:1 dimetric isometric, flat terrain, no elevation |
| Tile size | 96×48 px at zoom 1.0 (1080p native), camera zoom range 0.5–1.5 |
| Facings | 8 directions for all mobile units; buildings/doodads 1 direction |
| Art source | Agent-written Blender Python (bpy) scripts, headless Cycles CPU renders |
| Setting | Historical-flavoured medieval, 2 asymmetric factions: Crown, Clans |
| Resources | Gold (mined, hauled by ox-carts to drop-offs), Food (farms worked by peasants), Faith (power-grid style supply/usage) |
| Construction | AoE-style: peasants place foundations and build them |
| Modes | Skirmish vs AI only, 2–4 players, 1 human |
| Scale | 128×128 tiles, 150 pop cap per player, ≤ 600 units on map |
| Systems in scope | Fog of war + explored shroud, 3 ages, upgrades, walls/gates/towers |
| Out of scope | Multiplayer, save/load, replays, campaign, map editor, naval, heroes, localisation |
| Victory | A player is eliminated when they own no Town Center (completed or under construction); last team standing wins |
| AI | Easy / Normal / Hard, no resource cheats |
| Stack | TypeScript, Vite, Babylon.js (`@babylonjs/core`), React 19 HUD/menus, zustand, Vitest, Playwright |
| Platform | Web (itch.io) first; Electron desktop wrapper (Windows x64 NSIS, Linux x64 AppImage) |
| Audio | None until Pre-release; then CC0 SFX/music |
| Execution | AI agents implement, user reviews; no calendar. Each phase is sized for one agent task |

## Game design

### Economy

- **Gold**: Gold mines are neutral 2×2 map objects holding 6000 gold. Ox-carts (Crown) / Haul Wagons (Clans) automatically loop: drive to nearest non-depleted mine, load 100 gold in 6 s, drive to nearest owned drop-off (Town Center or Storehouse-type building), unload in 2 s, repeat. At most 2 carts load at one mine simultaneously; others wait adjacent. When a mine depletes, carts retarget the nearest mine within 20 tiles of their drop-off, else go idle. Players may right-click a cart onto a specific mine to pin it.
- **Food**: Farms are 2×2 buildings placed and built by peasants. One peasant works a farm and produces 0.5 food/s directly into the stockpile (no walking to drop-off). Farms are infinite. A peasant that finishes building a farm starts working it automatically. Right-clicking a peasant on an unworked farm assigns it.
- **Faith** (power grid): each player has Faith Produced and Faith Used. Producers: Town Center +5, Crown Chapel +15, Clans War Shrine +10. Consumers: military buildings (see tables, negative Faith). While Used > Produced the player is in **Low Faith**: all training and research runs at 50 % speed and towers/Town Centers attack at 50 % rate. Buildings under construction do not produce or consume Faith.
- **Population**: Town Center +10, House-type +10, hard cap 150. Units cost pop per table. Training blocks (paused, not cancelled) at the cap.
- **Starting state**: 1 Town Center, 4 peasants, 1 cart, 300 food, 200 gold; one gold mine 6–8 tiles from the TC and two more 14–18 tiles away (map guarantees).

### Faction asymmetry

- **Crown**: stone buildings (more HP, more gold, slower build), stone walls/towers unlock in Age II, strongest heavy cavalry and trebuchet. Faction ability **Sanctuary**: each completed Chapel heals own non-siege units within 5 tiles by 1 HP/s.
- **Clans**: wooden buildings (cheaper, faster, weaker), palisades and watchtowers available in Age I, fast cheap infantry and cavalry, battering ram. Faction ability **Battle Fervor**: while Faith Produced − Faith Used ≥ 5, all Clans units get +1 attack.

### Ages

| Age | Crown name | Clans name | Cost (food/gold) | Research time | Requirement |
|---|---|---|---|---|---|
| I | Hamlet | Camp | start | — | — |
| II | Borough | Steading | 500 / 200 | 40 s at Town Center | 2 distinct completed buildings among {barracks-type, range-type, storehouse-type, faith-type} |
| III | Kingdom | Warhold | 800 / 600 | 60 s at Town Center | completed stable-type + 1 more distinct building from the Age II list |

Type mapping: barracks-type = `barracks` / `mead_hall`; range-type = `archery_range` / `hunters_lodge`; storehouse-type = `storehouse` / `hoard`; faith-type = `chapel` / `war_shrine`; stable-type = `stable` / `horse_pen`.

### Combat model

- Attack types: `melee`, `pierce`, `siege`. Armor: melee armor (M) and pierce armor (P). Siege damage ignores armor.
- Damage per hit = `max(1, attack − armor[type]) + Σ bonus[tag]` over every tag the target has (siege: `attack + Σ bonus`). Low Faith never changes damage, only rates.
- Tags: `infantry`, `cavalry`, `archer`, `siege`, `vehicle`, `worker`, `building`.
- Ranged attacks spawn a homing projectile (speed 8 tiles/s; trebuchet 5 tiles/s with parabolic visual arc); they never miss. Melee hits land on the attack frame (frame 5 of 8) if the target is still within `radiusA + radiusB + 0.3` tiles.
- Line of sight (tiles): infantry 6, archers range + 2, cavalry 7, carts 4, siege 6, buildings 4, towers 8, Town Center 8.
- Stances: units auto-acquire targets within LOS when idle or attack-moving; Hold Position units only attack within range and never move.
- Units killed play `die`, leave a corpse for 10 s (fades last 2 s). Buildings at 0 HP become rubble for 20 s.

### Units — Crown

Speed in tiles/s, times in seconds, armor M/P. "From" = training building.

| id | Name | Age | From | Food | Gold | Train | HP | Atk | Type | Range | Cooldown | Armor | Speed | Radius | Tags | Bonus | Pop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| peasant | Peasant | I | keep | 50 | 0 | 20 | 25 | 3 | melee | 0 | 2.0 | 0/0 | 1.0 | 0.2 | infantry, worker | — | 1 |
| ox_cart | Ox Cart | I | keep | 60 | 40 | 25 | 80 | 0 | — | — | — | 0/2 | 1.1 (0.8 loaded) | 0.4 | vehicle | — | 1 |
| spearman | Spearman | I | barracks | 35 | 25 | 20 | 45 | 3 | melee | 0 | 2.0 | 0/0 | 1.0 | 0.2 | infantry | cavalry +12 | 1 |
| man_at_arms | Man-at-Arms | II | barracks | 60 | 20 | 21 | 60 | 6 | melee | 0 | 2.0 | 1/1 | 0.9 | 0.2 | infantry | building +2 | 1 |
| halberdier | Halberdier | III | barracks | 40 | 30 | 22 | 60 | 5 | melee | 0 | 3.0 | 0/1 | 1.0 | 0.2 | infantry | cavalry +24 | 1 |
| longbowman | Longbowman | I | archery_range | 25 | 45 | 27 | 30 | 5 | pierce | 6 | 2.0 | 0/0 | 0.96 | 0.2 | infantry, archer | — | 1 |
| crossbowman | Crossbowman | II | archery_range | 30 | 50 | 30 | 38 | 7 | pierce | 5 | 2.5 | 0/1 | 0.9 | 0.2 | infantry, archer | cavalry +3 | 1 |
| sergeant | Mounted Sergeant | II | stable | 80 | 0 | 30 | 65 | 4 | melee | 0 | 2.0 | 0/2 | 1.5 | 0.35 | cavalry | archer +4 | 1 |
| knight | Knight | II | stable | 60 | 75 | 30 | 100 | 10 | melee | 0 | 1.8 | 2/2 | 1.35 | 0.35 | cavalry | — | 1 |
| trebuchet | Trebuchet | III | siege_workshop | 200 | 200 | 50 | 150 | 200 | siege | 12 (min 4) | 10.0 | 2/150 | 0.8 | 0.45 | siege | building +250 | 2 |

### Units — Clans

| id | Name | Age | From | Food | Gold | Train | HP | Atk | Type | Range | Cooldown | Armor | Speed | Radius | Tags | Bonus | Pop |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| thrall | Thrall | I | great_hall | 45 | 0 | 18 | 25 | 3 | melee | 0 | 2.0 | 0/0 | 1.05 | 0.2 | infantry, worker | — | 1 |
| haul_wagon | Haul Wagon | I | great_hall | 55 | 35 | 22 | 70 | 0 | — | — | — | 0/1 | 1.2 (0.9 loaded) | 0.4 | vehicle | — | 1 |
| axeman | Axeman | I | mead_hall | 40 | 15 | 18 | 50 | 5 | melee | 0 | 2.0 | 0/0 | 1.05 | 0.2 | infantry | building +3 | 1 |
| shield_bearer | Shield-Bearer | I | mead_hall | 30 | 30 | 20 | 50 | 3 | melee | 0 | 2.0 | 1/2 | 0.95 | 0.2 | infantry | cavalry +12 | 1 |
| berserker | Berserker | II | mead_hall | 65 | 30 | 22 | 70 | 9 | melee | 0 | 1.8 | 0/0 | 1.1 | 0.2 | infantry | — (regenerates 0.5 HP/s) | 1 |
| javelineer | Javelineer | I | hunters_lodge | 35 | 30 | 22 | 40 | 4 | pierce | 4 | 2.0 | 0/1 | 1.05 | 0.2 | infantry, archer | infantry +3 | 1 |
| hunter | Hunter | II | hunters_lodge | 25 | 45 | 27 | 32 | 5 | pierce | 6 | 2.0 | 0/0 | 1.0 | 0.2 | infantry, archer | — | 1 |
| horse_raider | Horse Raider | II | horse_pen | 70 | 0 | 26 | 60 | 5 | melee | 0 | 2.0 | 0/1 | 1.6 | 0.35 | cavalry | archer +4, worker +3 | 1 |
| war_rider | War Rider | II | horse_pen | 70 | 65 | 30 | 95 | 11 | melee | 0 | 1.9 | 1/1 | 1.4 | 0.35 | cavalry | — | 1 |
| battering_ram | Battering Ram | III | ram_shed | 160 | 75 | 40 | 175 | 2 | siege | 0 | 5.0 | 0/180 | 0.6 | 0.45 | siege | building +125 | 2 |

### Buildings — Crown (stone, armor 3/8 unless noted)

Faith: + produces, − consumes. Build time is for one peasant; n builders take `3T/(n+2)`.

| id | Name | Age | Size | Gold | Food | Build | HP | Faith | Pop | Role |
|---|---|---|---|---|---|---|---|---|---|---|
| keep | Keep (Town Center) | I (additional: II) | 4×4 | 300 | 100 | 150 | 2400 | +5 | +10 | Trains peasant, ox_cart; researches ages; gold drop-off; shoots 5 pierce, range 6, cooldown 2 |
| cottage | Cottage | I | 2×2 | 30 | 0 | 25 | 550 | 0 | +10 | Housing |
| farm | Farm | I | 2×2 | 60 | 0 | 15 | 300 | 0 | 0 | 0.5 food/s with one farmer; armor 0/0 |
| storehouse | Storehouse | I | 2×2 | 100 | 0 | 35 | 1000 | 0 | 0 | Gold drop-off; cart upgrade |
| chapel | Chapel | I | 2×2 | 120 | 0 | 40 | 900 | +15 | 0 | Sanctuary aura |
| barracks | Barracks | I | 3×3 | 150 | 0 | 50 | 1200 | −2 | 0 | Infantry |
| archery_range | Archery Range | I | 3×3 | 150 | 0 | 50 | 1200 | −2 | 0 | Archers |
| stable | Stable | II | 3×3 | 175 | 0 | 50 | 1200 | −3 | 0 | Cavalry |
| siege_workshop | Siege Workshop | III | 3×3 | 200 | 0 | 60 | 1500 | −4 | 0 | Trebuchet |
| stone_tower | Stone Tower | II | 1×1 | 125 | 0 | 80 | 1000 | −2 | 0 | 6 pierce, range 7, cooldown 2 |
| stone_wall | Stone Wall | II | 1×1 per tile | 5 | 0 | 8 | 800 | 0 | 0 | Armor 8/10; drag-placed line |
| stone_gate | Stone Gate | II | 3×1 or 1×3 | 30 | 0 | 60 | 1800 | 0 | 0 | Armor 8/10; passable for owner and allies only |

### Buildings — Clans (wood, armor 1/5 unless noted)

| id | Name | Age | Size | Gold | Food | Build | HP | Faith | Pop | Role |
|---|---|---|---|---|---|---|---|---|---|---|
| great_hall | Great Hall (Town Center) | I (additional: II) | 4×4 | 250 | 100 | 110 | 1900 | +5 | +10 | Trains thrall, haul_wagon; ages; gold drop-off; shoots 5 pierce, range 6, cooldown 2 |
| longhouse | Longhouse | I | 2×2 | 25 | 0 | 18 | 400 | 0 | +10 | Housing |
| field | Field | I | 2×2 | 50 | 0 | 12 | 250 | 0 | 0 | 0.5 food/s with one farmer; armor 0/0 |
| hoard | Hoard | I | 2×2 | 80 | 0 | 25 | 750 | 0 | 0 | Gold drop-off; wagon upgrade |
| war_shrine | War Shrine | I | 2×2 | 100 | 0 | 30 | 700 | +10 | 0 | Battle Fervor source |
| mead_hall | Mead Hall | I | 3×3 | 120 | 0 | 35 | 900 | −2 | 0 | Infantry |
| hunters_lodge | Hunter's Lodge | I | 3×3 | 120 | 0 | 35 | 900 | −2 | 0 | Ranged |
| horse_pen | Horse Pen | II | 3×3 | 140 | 0 | 35 | 900 | −3 | 0 | Cavalry |
| ram_shed | Ram Shed | III | 3×3 | 160 | 0 | 42 | 1100 | −4 | 0 | Battering ram |
| watchtower | Watchtower | I | 1×1 | 100 | 0 | 55 | 700 | −2 | 0 | 5 pierce, range 6, cooldown 2 |
| palisade | Palisade | I | 1×1 per tile | 3 | 0 | 5 | 250 | 0 | 0 | Armor 2/5; drag-placed line |
| palisade_gate | Palisade Gate | I | 3×1 or 1×3 | 20 | 0 | 40 | 900 | 0 | 0 | Passable for owner and allies only |

### Upgrades

| Faction | id | Name | Building | Age | Food | Gold | Time | Effect |
|---|---|---|---|---|---|---|---|---|
| Crown | heavy_plough | Heavy Plough | keep | II | 100 | 100 | 30 | Farms +20 % food |
| Crown | crop_rotation | Crop Rotation | keep | III | 250 | 150 | 45 | Farms +20 % food (stacks additively) |
| Crown | iron_axles | Iron Axles | storehouse | II | 100 | 100 | 30 | Carts +25 capacity, +10 % speed |
| Crown | gambeson | Padded Gambeson | barracks | II | 100 | 50 | 40 | Infantry +1 pierce armor |
| Crown | chainmail | Chainmail | barracks | III | 200 | 100 | 50 | Infantry +1/+1 armor |
| Crown | bodkin | Bodkin Arrows | archery_range | II | 100 | 100 | 35 | Archers +1 attack, +1 range |
| Crown | barding | Barding | stable | III | 150 | 150 | 50 | Cavalry +2 melee armor, +20 HP |
| Crown | devotion | Devotion | chapel | II | 100 | 100 | 30 | Chapels +5 Faith; Sanctuary 2 HP/s |
| Clans | slash_burn | Slash-and-Burn | great_hall | II | 100 | 100 | 30 | Fields +20 % food |
| Clans | tended_fields | Tended Fields | great_hall | III | 250 | 150 | 45 | Fields +20 % food |
| Clans | sledge_runners | Sledge Runners | hoard | II | 100 | 100 | 30 | Wagons +25 capacity, +10 % speed |
| Clans | hide_armor | Hide Armor | mead_hall | II | 100 | 50 | 40 | Infantry +1 pierce armor |
| Clans | scale_armor | Scale Armor | mead_hall | III | 200 | 100 | 50 | Infantry +1/+1 armor |
| Clans | barbed_javelins | Barbed Javelins | hunters_lodge | II | 100 | 100 | 35 | Ranged +1 attack; javelineer +1 range |
| Clans | steppe_breeding | Steppe Breeding | horse_pen | III | 150 | 150 | 50 | Cavalry +15 % speed, +15 HP |
| Clans | blood_rites | Blood Rites | war_shrine | II | 100 | 100 | 30 | War Shrines +5 Faith; Battle Fervor +2 attack instead of +1 |

### Terrain

Tile codes (Uint8): `0 GRASS`, `1 DIRT`, `2 SAND`, `3 SHALLOW` (passable, speed × 0.7), `4 WATER` (impassable), `5 FOREST` (impassable; grass ground + tree sprites), `6 ROCK` (impassable; rock ground + boulder sprites). No wood resource: forests and rocks are pure obstacles that shape the map.

### Controls

- Left click select; drag box-select (own units only; buildings only if no units in box); Shift adds/removes; double-click selects all own units of that type on screen; Ctrl+0–9 assigns group, 0–9 selects, double-tap centres camera.
- Right click context: ground → move; enemy → attack; own unfinished/damaged building with peasants → build/repair; unworked farm with peasant → farm; gold mine with cart → pin mine; from production building → set rally point. Shift+right-click queues waypoints/orders.
- Command card: 3×5 grid bound to `Q W E R T / A S D F G / Z X C V B`. Unit cards: Q Move, W Stop, E Hold, R Attack-move. Peasant card: A Economic buildings submenu, S Military buildings submenu, Esc back.
- Camera: arrow keys, screen-edge scroll (8 px margin), middle-mouse drag pan, wheel zoom 0.5–1.5 around cursor. `.` cycles idle peasants, `H` centres on Town Center, `Space` jumps to latest alert, `F10`/`Esc` opens game menu, `Delete` destroys selection.

## Technical architecture

### Repository layout

```
bordev/
  package.json  tsconfig.json  vite.config.ts  vitest.config.ts  playwright.config.ts  eslint.config.js  .prettierrc  index.html
  src/
    main.tsx            React root
    app/                screens: MainMenu, SkirmishSetup, GameScreen, Results, Settings
    ui/                 HUD components: TopBar, SelectionPanel, CommandCard, Minimap, Alerts; zustand store hud.ts
    game/               GameSession: owns Sim, Renderer, Input; fixed-step loop; HUD snapshots
    input/              CameraController, SelectionController, OrderController, Hotkeys, PlacementController
    render/             Renderer, IsoCamera, Terrain, SpriteBatch, AtlasCache, FogTexture, Overlays (selection ellipses, health bars, placement ghost, rally lines)
    sim/                PURE TypeScript. Must not import babylon, react, DOM or src/render|ui|input (enforced by eslint no-restricted-imports)
      sim.ts world.ts entity.ts commands.ts rng.ts map.ts grid.ts spatialHash.ts
      path/ (astar.ts, components.ts, pathQueue.ts)
      systems/ (movement.ts, economy.ts, construction.ts, production.ts, combat.ts, projectiles.ts, faith.ts, fog.ts, victory.ts, auras.ts)
      ai/ (aiPlayer.ts, economyManager.ts, buildOrder.ts, militaryManager.ts, defenseManager.ts, techManager.ts, difficulty.ts, buildOrders/*.json)
    data/               units.ts buildings.ts upgrades.ts ages.ts factions.ts (tables above as typed consts)
    assets/             atlas manifest types + loader
  art/
    manifest.json       every renderable asset
    blender/lib/        rig.py look.py materials.py anim.py io.py
    blender/assets/     one .py per asset exposing build() and anims()
    blender/render_asset.py   CLI entry
    blender/render_terrain.py seamless ground textures
  tools/                art-build.ts pack-atlas.ts mapgen.ts sim-headless.ts bench-sim.ts balance.ts
  public/               atlases/ terrain/ maps/  (generated; committed)
  build/                intermediate renders (gitignored)
  tests/e2e/            Playwright specs
  docs/plans/           these plans
```

### npm scripts (names are fixed)

`dev` (vite), `build` (tsc -b && vite build), `preview`, `test` (vitest run), `test:watch`, `e2e` (playwright test), `lint`, `typecheck`, `art:build` (tsx tools/art-build.ts), `art:pack` (tsx tools/pack-atlas.ts), `art:terrain`, `map:gen` (tsx tools/mapgen.ts), `sim:headless` (tsx tools/sim-headless.ts), `bench:sim` (tsx tools/bench-sim.ts), `balance` (tsx tools/balance.ts), `desktop:dev`, `desktop:build` (Pre-release).

M0 development setup: Node 26 (`.nvmrc` pins 26.8.1), npm 12, then `npm ci`. Run `npm run dev` for development. Browser tests require `npx playwright install --with-deps chromium` (Linux system dependencies need sudo), followed by `npm run build && npm run e2e`. CI performs these steps on Ubuntu.

TypeScript 7.0.2 runs typecheck/build. Current typescript-eslint 8.70.1 requires the TypeScript 6 compiler API, so `tools/eslint/` is an npm workspace with TypeScript 6.0.3 solely for linting. The `ts-api-utils` override keeps that parser dependency from resolving against the incompatible TypeScript 7 API. Do not use `--force` or `--legacy-peer-deps`. npm 12 explicitly permits the pinned esbuild install script via `allowScripts`.

All fixed script names are reserved in M0. Art, map generation, headless simulation, benchmarks, balance, and desktop commands target their planned entrypoints; those implementations and desktop dependencies arrive in their owning later milestones. M0 does not supply fake implementations.

### Simulation contract

- Fixed tick 20 Hz (`SIM_DT = 0.05` s). `Sim.step()` advances exactly one tick. The render loop uses an accumulator and interpolates positions with `alpha = acc / SIM_DT`.
- All randomness through `Rng` (mulberry32, seeded per match). Same seed + same commands ⇒ same outcome on the same machine (tested).
- Input and AI mutate state only via `sim.issue(cmd: Command)`; commands apply at the start of the next tick. `Command` is a discriminated union on `kind`: `move | attackMove | attack | stop | hold | build | repair | farm | pinMine | train | cancelTrain | research | cancelResearch | setRally | delete`. Every command carries `player: number`, and unit commands carry `ids: number[]` and `queued: boolean`.
- Entities: dense array indexed by numeric id with a free list; each entity is a plain object with `kind: 'unit' | 'building' | 'mine' | 'projectile' | 'doodad'` and optional component fields. No class hierarchy.
- Grid: `Uint8Array(128*128)` flags — bit0 terrain-blocked, bit1 building-blocked, bit2 gate. A gate tile is passable for units whose owner is the gate owner or an ally.
- Pathfinding: 8-neighbour A* (octile heuristic, binary heap, no diagonal corner cutting) + line-of-sight string pulling. Connected-component labels recomputed on building placement/destruction; a target in another component is replaced by the nearest tile (BFS from target) in the start component. Path requests are queued and processed up to 25 000 node expansions per tick.
- Movement: waypoint seek + separation steering from a spatial hash (cell 2 tiles); clamp out of blocked tiles; stuck detection (progress < 0.1 tiles in 2 s) triggers a repath. Group moves assign formation slots (box, spacing 0.6 tiles, facing move direction, greedy nearest assignment) and path each unit to its slot.
- Fog: per player `Uint8Array(128*128)`: 0 unexplored, 1 explored, 2 visible; recomputed every 4 ticks from LOS circles. Enemy buildings and mines seen once are remembered as ghosts with their last-seen state per player.
- AI players run inside the sim at their decision interval and issue normal commands. AI sees terrain, mines and enemy start positions; enemy units/buildings only through its own fog.

### Rendering contract

- One Babylon `Engine` + `Scene`. Orthographic camera, pitch 30° below horizontal, yaw 45°, so a 1×1 world tile projects to a 96×48 px diamond at zoom 1. Pixels per world unit `PPU = 96/√2 ≈ 67.882`. Ortho bounds = `±canvasPx/2 / (PPU·zoom)`.
- Axis convention (acceptance-tested): world +X projects to screen (+48, +24) px and world +Z to screen (−48, +24) px per tile at zoom 1; tile (0,0) is the top corner of the map.
- Terrain: one 128×128 ground mesh, `ShaderMaterial` blending tiling ground textures by two RGBA splat textures (splat0 = grass, dirt, sand, shallow; splat1 = water, rock-ground, unused, unused) built CPU-side at 4 texels per tile with bilinear filtering and noise-perturbed lookup; ground texture repeats once per 4 tiles; water animates UV. Terrain renders in rendering group 0 with depth write off.
- Sprites: one `SpriteBatch` per atlas page = a unit quad with thin instances. Per-instance attributes: `iPos` (vec3 world anchor), `iUV` (vec4 atlas rect), `iSize` (vec4 w, h, anchorX, anchorY in px), `iTint` (vec4 team rgb, alpha). Vertex shader builds a camera-facing quad; the whole quad has the anchor's depth. Fragment: discard alpha < 0.5, alpha blend, depth test + write. Team colour: `rgb = mix(base.rgb, base.rgb * team * 1.25, mask.r)` from the page's mask texture. Instance buffers are rebuilt every frame from interpolated sim state.
- Unit shadows are procedural ellipse quads (alpha 0.35, sized from unit radius) drawn after terrain, before sprites, no depth write. Building/doodad shadows come from a rendered shadow atlas layer drawn in the same pass.
- Overlays: selection ellipses (under sprites), health bars and rally lines (on top, no depth test), placement ghost (building sprite, 50 % alpha, tinted green valid / red invalid per footprint tile).
- Picking: screen → ground by ray/plane(y=0) math. Entity picking tests the cursor against each visible entity's trimmed sprite rect and chooses the one with the greatest iso depth (front-most).
- Fog: `R8` 128×128 texture (0 / 128 / 255) with linear filtering; terrain darkens explored to 50 % desaturated, unexplored to black; sprites of non-visible enemies are not submitted.

### Sprite pipeline

- `art/manifest.json` entry: `{ "id": "crown_knight", "kind": "unit|building|doodad|icon|calibration", "script": "assets/crown_knight.py", "frame": 128|192|256|…, "dirs": 8|1, "anims": { "idle": {"frames":4,"loop":true}, "walk": {"frames":8,"loop":true}, "attack": {"frames":8,"loop":false}, "die": {"frames":8,"loop":false} } }`. Workers add `work` (8, loop). Carts: `idle` 1, `walk` 8, `load` 4. Buildings: `construct` 3 frames (0 %, 50 %, 100 % scaffold), `idle` 1, `damaged` 1, `rubble` 1. Doodads: `idle` 1 with 4 variants as separate ids.
- Blender scene rig (`lib/rig.py`): orthographic camera rotation (60°, 0°, 45°) (tuned until the calibration test passes), `ortho_scale = frame / PPU`, sun from screen upper-left (strength 3.0, angle 5°) + world ambient 0.4, shadow-catcher plane at z = 0 for building/doodad shadow pass only.
- Look (`lib/look.py`): Cycles CPU, 32 samples, OIDN denoise, view transform `Standard`, film transparent, render at 2× frame size, Freestyle silhouette/crease/border lines thickness 2.0 colour (0.08, 0.06, 0.05), compositor via `scene.compositing_node_group`: Kuwahara (anisotropic, size 6) on RGB, original alpha re-applied. Freestyle-with-Cycles output is unverified on Blender 5.2 — confirm in Alpha M1; if lines are missing, replace Freestyle with an inverted-hull outline (Solidify modifier, thickness 0.02, flipped normals, black emission material) applied by `look.py` to every mesh.
- Passes per frame: `body` (normal), `mask` (all materials → black emission except material named `TEAM` → white emission, 16 samples). Buildings/doodads additionally `shadow` (asset `visible_camera = False`, shadow catcher on).
- 8 facings are produced by rotating the model, never the camera or light. Direction index 0 = facing screen-down, increasing clockwise on screen (1 = down-left, 2 = left, … 7 = down-right). In-game facing = `round(screenAngle/45°) mod 8` of the screen-projected velocity.
- Output: `build/renders/<id>/<pass>/<anim>/<dir>/<frame>.png`. `tools/pack-atlas.ts` downscales 50 % (sharp lanczos3), trims transparent borders, packs into 2048×2048 pages (maxrects, padding 2), writes `public/atlases/<id>_<page>.png`, `<id>_<page>_mask.png`, optional `<id>_<page>_shadow.png`, and `public/atlases/<id>.json`: `{ "version":1, "id", "pages":[…], "fps":12, "anims":{name:{frames,loop,dirs}}, "frames":{ "<anim>/<dir>/<frame>": {"page","x","y","w","h","ax","ay"} } }` where `ax, ay` is the anchor (projected world origin) inside the trimmed frame.
- `tools/art-build.ts` runs `blender -b --factory-startup --python art/blender/render_asset.py -- --asset <id> --out build/renders/<id>`, 4 processes in parallel with `-t 2` threads each, skipping assets whose script + lib hash (stored in `build/renders/<id>/.hash`) is unchanged.
- Icons: per unit/building/upgrade a 64×64 portrait (kind `icon`), packed into `public/atlases/icons.json`.
- Terrain textures: `render_terrain.py` renders 512×512 seamless top-down textures using 4D noise on a torus mapping (vector = (cos u, sin u, cos v), W = sin v), Kuwahara-filtered, to `public/terrain/<type>.png`.

### Map format

`public/maps/<id>.json`: `{ "version":1, "id", "name", "size":128, "players":2|3|4, "tiles":"<base64 Uint8Array 16384>", "goldMines":[[x,y],…], "starts":[[x,y],…], "doodads":[[x,y,"tree_1"],…] }`. Coordinates are top-left tiles. `tools/mapgen.ts --seed N --players P --out id` generates rotationally symmetric maps satisfying the start-state guarantees; forests/rocks get doodads automatically.

### Debug hooks

With `import.meta.env.DEV` or URL `?debug=1`: `window.__bordev = { session, sim, issue(cmd), cheats: { resources(n), reveal(), instantBuild(on) }, stats() }`. Playwright specs drive the game through these hooks.

### Testing strategy

- Vitest for `src/sim`, `src/data` validation, atlas/map parsers, iso math. Tests assert observable sim outcomes (a unit arrives, gold increases, a building dies), not internals.
- Playwright (Chromium headless, SwiftShader WebGL) for boot + one scripted skirmish smoke per stage.
- Headless AI-vs-AI in Node via `sim:headless` is the main integration test for economy, combat and AI.
- Visual checks: screenshot via Playwright or the agent browser, compared by eye at stage gates.

## Stage gates

| Stage | One-line goal | Gate owner |
|---|---|---|
| Alpha | Every core system works end to end with the Crown faction; ugly but complete loop vs Normal AI | User plays one full match |
| Beta | Content complete: both factions, final art, 3 AI difficulties, 4 maps, balance and performance targets hit | User plays both factions, reviews balance report |
| Pre-release | Ship-quality: audio, menus/settings, polish, accessibility, desktop builds, external playtest fixes | User signs off RC build |
| Release | 1.0.0 published on itch.io (web + desktop) with post-launch hotfix process | User publishes |

Rules for agents: each phase is one task; mark `- [x]` in the stage file when its goalposts pass; never start a stage before the previous stage's exit gate is checked by the user; any design change edits this overview first.
