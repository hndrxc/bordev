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
