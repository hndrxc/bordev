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
