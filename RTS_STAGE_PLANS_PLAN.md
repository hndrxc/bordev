# bordev — write the Alpha / Beta / Pre-release / Release plan documents

## Context

The user wants a 2.5D medieval RTS ("bordev") built with Babylon.js, and asked for **multiple plan files — Alpha, Beta, Pre-release, Release — each with detailed milestones, phases and clear goalposts**. The repo `/home/carter/projects/bordev` is empty (only `AGENTS.md`; git initialised on `main`, no commits, remote `git@github.com:hndrxc/bordev.git`). End state: five markdown files under `docs/plans/` whose content is given verbatim below. No game code is written in this task.

Environment facts verified this session (the docs rely on them):
- Blender **5.2.2 LTS** at `/snap/bin/blender`. Headless: EEVEE falls back to software GL (64×64 test render took 50 s) → unusable; **Cycles CPU works** (6 s incl. startup); Workbench works. Blender 5.2 API: `scene.compositing_node_group` exists, `scene.node_tree` is gone; `CompositorNodeKuwahara`, `render.use_freestyle`, `Object.is_shadow_catcher`, `render.film_transparent`, OIDN denoiser, glTF exporter all present.
- Node **v26.8.1** / npm (nvm). No bun. 8 cores, 62 GB RAM, no usable GPU (VMware SVGA).
- Current npm versions: `@babylonjs/core` 9.27.1, `vite` 8.3.0, `react` 19.3.0, `typescript` 7.0.2, `vitest` 5.0.1, `@playwright/test` 1.63.0, `electron` 44.4.4, `electron-builder` 26.15.3, `sharp` 0.35.4, `maxrects-packer` 2.7.3, `@vitejs/plugin-react` 6.1.1, `zustand` 5.0.15, `eslint` 10.11.0, `tsx` 4.23.15.

## Approach

1. Create directory `docs/plans/`.
2. Create these five files with **exactly** the content of the matching fenced block in "File contents" (strip only the outer ```` fence lines):
   - `docs/plans/00-overview.md`
   - `docs/plans/01-alpha.md`
   - `docs/plans/02-beta.md`
   - `docs/plans/03-pre-release.md`
   - `docs/plans/04-release.md`
3. Do not create any other files, do not scaffold code, do not commit (user reviews first).

## Verification

Run from `/home/carter/projects/bordev`:
- `ls docs/plans` → exactly the five filenames above.
- `grep -c '^### M' docs/plans/0[1-4]-*.md` → alpha 10, beta 8, pre-release 7, release 4.
- `grep -c 'Goalposts' docs/plans/0[1-4]-*.md` → every file ≥ its milestone count (each milestone has a Goalposts list).
- Open `docs/plans/00-overview.md` and confirm the unit tables render (pipes intact) — e.g. `grep -c '^| ' docs/plans/00-overview.md` ≥ 60.

## Assumptions & contingencies

Decisions the user made during grilling are baked in (pre-rendered 8-direction sprites, 2:1 dimetric flat tiles, HD painterly 96×48 tiles, medieval Crown vs Clans, Gold + Food + Faith economy with ox-carts, peasants build + farm, Skirmish vs AI only, 4 players / 150 pop / 128×128, fog + ages + walls/gates/towers, TS + Vite + Babylon + React, web + desktop wrapper, no audio until Pre-release, agent-executed with no calendar, destroy-Town-Centers victory, Easy/Normal/Hard AI, repo name "bordev"). Defaults chosen by me where the user did not answer, all overridable:
- Audio source (Pre-release): CC0 packs (Kenney, OpenGameArt CC0) + `CREDITS.md`.
- Desktop wrapper: Electron (Chromium WebGL parity; Tauri uses WebKitGTK on Linux). Targets Windows x64 (NSIS) + Linux x64 (AppImage); macOS excluded (needs Apple signing).
- English only; no save/load, replays, campaign, map editor, naval, multiplayer.
- Single-player ⇒ sim uses floats but a seeded RNG and fixed 20 Hz tick (reproducible headless AI-vs-AI runs).

## File contents

### docs/plans/00-overview.md

````markdown
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
````

### docs/plans/01-alpha.md

````markdown
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
- [ ] `npm run dev` serves a page with a full-window Babylon canvas clearing to a solid colour and a React "bordev" overlay.
- [ ] `npm run build` produces `dist/`; `npm test` runs a placeholder sim test; `npm run e2e` loads the page and asserts the canvas exists and no console errors.
- [ ] Importing `@babylonjs/core` from a file in `src/sim` fails `npm run lint`.

### M1 — Sprite pipeline v1

Phases:
1. `art/blender/lib/rig.py`, `look.py`, `materials.py` (`TEAM` material convention), `anim.py` (keyframe helpers for rigid-part hierarchies: bob, swing, lean, fall), `io.py` (pass/anim/dir/frame output paths); `render_asset.py` CLI with `--asset`, `--out`, `--only-anim`, `--only-dir`.
2. Calibration assets: `calib_tile` (1×1 tile diamond with red +X and blue +Z edge markers) and `calib_arrow` (arrow pointing along model forward, 8 dirs, 1 frame).
3. `tools/pack-atlas.ts` and `tools/art-build.ts` per overview (parallelism 4, hash cache).
4. Vitest `tools/pack-atlas.test.ts`: packs `calib_tile`, asserts its trimmed diamond is 96±1 × 48±1 px and anchor lies at the diamond centre ±1 px; `calib_arrow` dir 0 points screen-down, dir 2 screen-left (dominant arrow-tip pixel quadrant).
5. First-pass Crown assets (low-poly, simple anims): `crown_peasant`, `crown_ox_cart`, `crown_spearman`, `crown_keep`, `crown_cottage`, `crown_farm`, `gold_mine`, `tree_1`–`tree_4`, `rock_1`–`rock_2`.
6. `render_terrain.py` producing grass, dirt, sand, shallow, water, rock-ground textures.

Goalposts:
- [ ] `npm run art:build && npm run art:pack` regenerates all M1 atlases from scratch on this machine; a second run skips everything (cache).
- [ ] Calibration test passes.
- [ ] Each atlas JSON validates against the overview format (Vitest schema test over `public/atlases/*.json`).
- [ ] Terrain textures tile seamlessly (Vitest: left/right and top/bottom edge pixel columns differ by mean < 3/255).

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
````

### docs/plans/02-beta.md

````markdown
# Stage 2 — Beta

**Goal**: content complete and feature complete. Both factions with final-quality art and animation, all upgrades, 3 AI difficulties per faction, 2–4 player skirmish with teams, 4 curated maps + random maps, balance and performance targets met. After Beta no new content or systems are added, only polish and fixes.

**Entry criteria**: Alpha exit gate checked by the user.

**Exit gate**:
- [ ] All M0–M7 goalposts checked.
- [ ] `npm run balance` report committed to `docs/balance/beta.md` meeting M5 targets.
- [ ] `npm run e2e` Beta smoke spec: 4-player match (human + 3 AI, both factions) runs 10 game-minutes at 8× speed via debug hook without errors.
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

### M1 — Final art pass (units)

Phases (one phase per 5 units; each phase delivers models, all anims, icons):
1. Crown: peasant, ox_cart, spearman, man_at_arms, halberdier.
2. Crown: longbowman, crossbowman, sergeant, knight, trebuchet.
3. Clans: thrall, haul_wagon, axeman, shield_bearer, berserker.
4. Clans: javelineer, hunter, horse_raider, war_rider, battering_ram.
5. Projectiles and effects sprites: arrow, bolt, javelin, trebuchet stone, hit sparks, dust puff, building-fire (3 sizes, 8-frame loops), rubble smoke; spawned by sim events in the renderer.

Art bar for every unit: readable silhouette at zoom 0.5; distinct per-faction palette (Crown: blues/whites/steel, stone grey; Clans: browns/furs/ochre, bone); team colour on ≥ 15 % of visible body pixels (tabard/shield/banner), measured from the mask atlas; walk cycle 8 frames with no foot-sliding at listed speed (stride length = speed × 8/12 s); attack impact on frame 5.

Goalposts:
- [ ] `npm run art:build` full rebuild completes on this machine in ≤ 90 minutes.
- [ ] Vitest mask-coverage test passes for all 20 units.
- [ ] Contact sheet `build/contact/units.png` (generated by `tools/pack-atlas.ts --contact`) reviewed by user: approved.

### M2 — Final art pass (buildings, doodads, terrain, UI)

Phases:
1. Crown 12 buildings: construct stages, idle, damaged (fires/cracks), rubble, gate open/closed, icons.
2. Clans 12 buildings: same.
3. Doodads: 8 tree variants (2 species per faction biome feel), 4 rocks, 3 bushes (decorative, passable), gold mine with 3 depletion stages.
4. Terrain textures final + tile transition noise tuning; shoreline foam band in water shader.
5. UI art: HUD frame (Blender-rendered stone/wood panels, 9-slice), resource icons, command icons (move, stop, hold, attack-move, build menus, cancel, rally), cursors (default, attack, build, gather, invalid) — PNG, 32 px and 64 px.

Goalposts:
- [ ] Occluded-unit silhouette: own units behind buildings render a player-colour outline (second sprite pass with depth test `GREATER`, alpha 0.6).
- [ ] Screenshot review at zoom 0.5 / 1.0 / 1.5 approved by user.

### M3 — Complete gameplay features

Phases:
1. All 16 upgrades implemented with tooltips; upgrade icons.
2. UX: idle-peasant button + `.` hotkey; idle military counter; `Space` alert jump; rally point to mine auto-assigns carts; drag-select filters workers out when mixed with military; attack-move ground marker; Tab cycles subgroups in multi-selection; production queue display with cancel on click; building HP/queue in selection panel.
3. Notifications: under attack (throttled 1 per 10 s per area), building complete, research complete, unit trained (only when idle building), mine depleted, player eliminated.
4. Game speed setting (0.5×, 1×, 1.5×, 2×) and pause (`P`).
5. Teams: `SkirmishSetup` 2–4 slots, each Human (slot 1 only) / AI (Easy/Normal/Hard) / Closed, faction, colour (8 options, unique), team 1–4; allies share vision, gates, no friendly fire; victory by last team standing.

Goalposts:
- [ ] Vitest: allied units pass through each other's gates; allied fog shared; team victory declared when all enemy-team TCs are gone.
- [ ] E2E: pause freezes sim tick counter; 2× speed doubles ticks per real second ±10 %.

### M4 — AI: three difficulties, both factions

Phases:
1. Refactor AI into managers per overview; `difficulty.ts` table:

| Param | Easy | Normal | Hard |
|---|---|---|---|
| decision interval (ticks) | 60 | 30 | 10 |
| target peasants | 12 | 18 | 24 |
| target carts | 2 | 4 | 6 |
| first attack (game minute) | 14 | 10 | 7 |
| micro | none | retreat < 30 % HP | retreat, focus fire lowest HP in range, archers kite melee |
| upgrades researched | none | half (eco first) | all |
| counter-composition | no | no | yes (spear/halberd/shield vs cavalry, cavalry vs archers, siege vs towers) |
| walls/towers | no | towers only | towers + gated wall at chokepoints |

2. Build orders: `buildOrders/{crown,clans}_{easy,normal,hard}.json`.
3. Team AI: allies attack the same target; AI helps an ally under attack within 25 tiles.
4. Target selection: nearest known enemy building cluster; Hard prioritises carts/mines then TC.

Goalposts (headless, `npm run balance -- --matrix ai`):
- [ ] Hard beats Easy ≥ 90 %, Normal beats Easy ≥ 75 %, Hard beats Normal ≥ 65 % over 20 seeds per pairing per faction combination.
- [ ] No AI game stalls: every game ends before 72 000 ticks or with ≥ 1 building destroyed per 10 minutes after minute 15.

### M5 — Balance

Phases:
1. `tools/balance.ts`: runs matrices across maps/seeds/factions, outputs markdown with win rates, average game length, unit usage and kill/death per unit type.
2. Tune numbers in `src/data` and overview tables together (overview updated in the same change).

Goalposts:
- [ ] Crown vs Clans, Normal vs Normal, 40 seeds × 4 maps: each faction wins 40–60 %.
- [ ] Median game length Normal vs Normal 1v1: 18–30 minutes.
- [ ] Every unit type has ≥ 3 % share of AI army production for its faction (no dead units).

### M6 — Maps

Phases:
1. Full `tools/mapgen.ts`: templates `lowlands` (open), `riverlands` (river with 3 shallow fords), `forest_pass` (forest walls with chokepoints), `highland_ring` (rock ring centre); rotational symmetry for 2/3/4 players; guarantees from overview; contested central mines.
2. Curated maps committed: `lowlands_2p`, `riverlands_2p`, `forest_pass_3p`, `highland_ring_4p`; `Random` option in setup picks template + random seed.
3. Validation test: every start reaches every other start; each start has 3 mines within 18 tiles; no mine within 5 tiles of an enemy start.

Goalposts:
- [ ] Map validation Vitest passes for curated maps and 100 random seeds per template.

### M7 — Performance and stability

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
````

### docs/plans/03-pre-release.md

````markdown
# Stage 3 — Pre-release (Release Candidate)

**Goal**: ship quality. Audio, full menus and settings, onboarding, accessibility, loading/bundle budgets, error handling, desktop packaging, and external playtest fixes. No new units, buildings or systems.

**Entry criteria**: Beta exit gate checked by the user.

**Exit gate**:
- [ ] All M0–M6 goalposts checked.
- [ ] RC build `1.0.0-rc.N` produced for web, Windows and Linux by CI and installed/run by the user on their own machine (with a GPU).
- [ ] Zero open issues labelled `P0` or `P1`.

### M0 — Audio

Phases:
1. Audio system via Babylon's `CreateAudioEngineAsync` (AudioEngineV2) — unverified that the API is unchanged in Babylon 9.x, confirm first; if absent, use `howler` 2.x. Buses: master, music, sfx, ui, voice; volumes from settings.
2. Source CC0 assets (Kenney audio packs, OpenGameArt CC0, freesound CC0 only) into `public/audio/`; `CREDITS.md` with author, source URL and licence per file.
3. SFX mapping from sim events: select/acknowledge (per unit class, 3 variants), attack impacts per damage type, arrow/bolt/javelin release, building place/complete/destroyed, cart unload coin, farm ambience, UI clicks, alerts (under attack, age up, research complete). Positional panning by screen x; volume attenuated off-screen; max 24 simultaneous voices; same-sound cooldown 80 ms.
4. Music: 3 in-game tracks shuffled + menu track, crossfade 2 s; victory/defeat stingers.

Goalposts:
- [ ] Every sim event type in `sim.ts` event queue has a mapped sound or is explicitly listed as silent in `src/audio/map.ts`.
- [ ] 100 simultaneous battle events in one second never exceed 24 voices (unit test on the voice limiter).
- [ ] Muting master in settings silences all output (E2E via AudioContext gain inspection).

### M1 — Menus, settings, onboarding

Phases:
1. Main menu: Skirmish, How to Play, Settings, Credits, Quit (desktop only).
2. Settings persisted in `localStorage` key `bordev.settings.v1`: volumes, scroll speed, edge scroll on/off, zoom sensitivity, UI scale (90–130 %), show health bars (always / damaged / selected), colourblind palette, graphics quality (Low: 0.75 render scale, no water animation, no building shadow layer; High: 1.0 render scale, all effects), hotkey reference page (no rebinding).
3. How to Play: 6 illustrated pages (camera & selection, economy, faith, building, ages & upgrades, combat & counters) using rendered icons.
4. Contextual first-match hints (dismissible, off after first match): place a farm, build carts, low faith warning explanation, age up.
5. Rich tooltips: cost, time, stats, bonuses, requirements, hotkey.

Goalposts:
- [ ] A new user (user's pick of tester) completes a first match without external explanation; notes recorded in `docs/playtests/`.
- [ ] Settings survive reload (E2E).

### M2 — Accessibility and readability

Phases:
1. Colourblind-safe player palette option (8 colours validated for deuteranopia/protanopia distinguishability — ΔE ≥ 20 under simulation, test in Vitest with a colour-vision simulation matrix).
2. Minimum UI font 14 px at UI scale 100 %; contrast ratio ≥ 4.5:1 for HUD text.
3. All HUD actions reachable by keyboard; tooltips show hotkeys.

Goalposts:
- [ ] Palette Vitest passes; contrast check script passes on HUD colour tokens.

### M3 — Loading, bundle and runtime budgets

Phases:
1. Loading screen with progress (atlases, terrain, audio) and tips; lazy-load faction atlases for factions present in the match.
2. Atlas compression: PNG → quantised PNG (sharp palette where lossless-enough) or KTX2/Basis via Babylon's KTX2 loader if PNG budget fails.
3. Code splitting: menus separate from game chunk.
4. Error boundary + global `error`/`unhandledrejection` handler showing a crash dialog with copyable report (version, seed, tick, stack) and "Return to menu".

Goalposts:
- [ ] Initial JS ≤ 1.5 MB gzip; total web download for a 2-faction match ≤ 120 MB; menu interactive ≤ 3 s after load on a cached visit.
- [ ] Throwing inside a sim system (debug hook `cheats.crash()`) shows the crash dialog, not a blank page.

### M4 — Desktop packaging

Phases:
1. `desktop/` Electron 44 main process: loads built `dist/`, fullscreen toggle (F11), disables devtools in production, `Quit` wired to main menu.
2. `electron-builder` config: Windows NSIS x64, Linux AppImage x64; app id `dev.bordev.game`; icon rendered in Blender (keep emblem, 1024 px).
3. CI workflow `release.yml` on tag `v*`: ubuntu builds web + AppImage, windows-latest builds NSIS; artifacts uploaded to the GitHub release.
4. Settings/localStorage persisted under Electron's userData.

Goalposts:
- [ ] Tag `v1.0.0-rc.1` produces 3 artifacts in the GitHub release.
- [ ] User installs Windows or Linux build, plays a match, settings persist across restarts.

### M5 — External playtest and bug bash

Phases:
1. itch.io restricted page (password) with web RC build.
2. Playtest round: ≥ 5 testers × ≥ 2 matches; feedback form fields: faction, difficulty, won?, most confusing thing, most fun thing, bugs.
3. Triage into GitHub issues with labels `P0` (crash/data loss/softlock), `P1` (major gameplay/visual bug), `P2`, `P3`; fix all P0/P1.
4. Balance adjustments from feedback go through `npm run balance` and must keep Beta M5 targets.

Goalposts:
- [ ] `docs/playtests/rc-round1.md` summarises feedback and resulting changes.
- [ ] Zero P0/P1 open.

### M6 — Browser and hardware matrix

Phases:
1. Test latest Chrome, Edge, Firefox on Windows and Linux; Safari best-effort (listed as "may work").
2. WebGL2 required; unsupported-browser screen when WebGL2 unavailable.
3. Low-spec check on the user's machine at Low quality.

Goalposts:
- [ ] Matrix table in `docs/playtests/compat.md` with pass/fail per browser; all Chrome/Edge/Firefox rows pass.
- [ ] ≥ 50 fps average at 1080p during a 4-player late-game on the user's GPU machine (`stats()` overlay `F3`).
````

### docs/plans/04-release.md

````markdown
# Stage 4 — Release

**Goal**: publish bordev 1.0.0 on itch.io as a browser game plus Windows and Linux downloads, with a working hotfix process.

**Entry criteria**: Pre-release exit gate checked by the user.

**Exit gate**:
- [ ] All M0–M3 goalposts checked.
- [ ] itch.io page public; web build playable; desktop downloads install and run.

### M0 — Release candidate freeze

Phases:
1. Freeze `main`: only P0/P1 fixes merge; each merge re-runs full CI + e2e + 20-seed soak.
2. Version `1.0.0` in `package.json`, shown in main menu footer and crash reports.
3. Final `CREDITS.md` (code, CC0 audio sources, tools: Babylon.js, Blender, React), `LICENSE` for code (user to choose; default: all rights reserved until chosen).

Goalposts:
- [ ] Last 3 RC builds had zero new P0/P1 found in a full match each (user-played).
- [ ] `npm run sim:headless` 4-player Hard soak × 20 seeds clean on the release commit.

### M1 — Store presence

Phases:
1. Key art (1920×1080 and 630×500 cover) rendered in Blender from the game's asset scripts in a staged battle scene with higher sample count.
2. 6 gameplay screenshots at 1080p (early economy, walls/gates, large battle, age up, fog/minimap, results screen) captured with HUD.
3. 30–60 s gameplay trailer: recorded from the game via the agent browser `recordStart` (1080p .mp4) and cut with ffmpeg (title, 4 shots, logo).
4. itch.io page text: pitch, features (2 factions, 20 units, 24 buildings, 3 ages, 4 maps + random, 3 AI levels), controls, system requirements (WebGL2, 4 GB RAM), credits.

Goalposts:
- [ ] All media files in `docs/store/` and uploaded to the itch.io page (still restricted).

### M2 — Publish

Phases:
1. Tag `v1.0.0`; `release.yml` produces web zip, Windows NSIS, Linux AppImage.
2. Upload with butler: channels `web`, `windows`, `linux` (`butler push <artifact> <user>/bordev:<channel> --userversion 1.0.0`).
3. Smoke each channel from itch.io: web in Chrome and Firefox, Windows installer, Linux AppImage — each boots to menu and starts a skirmish.
4. Make page public.

Goalposts:
- [ ] All 3 channels show version 1.0.0 on itch.io; all smoke checks pass.

### M3 — Post-launch hotfix process

Phases:
1. `docs/RELEASING.md`: branch `release/1.0.x` from tag; fix on branch, cherry-pick to `main`; tag `v1.0.N`; same CI + butler push; changelog entry.
2. In-game "Report a bug" button (menu) opening the itch.io community page with the crash-report text copied to clipboard.
3. Triage cadence: P0 within 48 h of report → hotfix release.

Goalposts:
- [ ] Dry run: a trivial fix released as `v1.0.1` through the documented process end to end.
````
