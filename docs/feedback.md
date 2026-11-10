Human play test.

Agent Context: Check the findings in here against future plans. If addressed in future development mark as such, if not mark that and missed and schedule a fix in the appropriate doc, for the most fitting milestone.

this is my personal feedback right after Alpha M7 and it fixes. I played the game as a an avid fan and this is my feedback sofar
- Idle peasants should pathfind to the nearest unfinished building or unworked farm
- When building with selected peasants the build propmt should stay attached, to allow for many of the same building to be built with out having to reselect  
- there shoudl be a button to select all idle peasants.
- troop formations from age of empires should be added at some point 
- at some point the gold economy should be tuned, probaly a pre-release thing tho 
- Combat system still a little clunky. Spearmen tend to crowd each other causing hits not to register (or appear not to)

## Post-Alpha M7 feedback status (2026-11-09)

1. **Idle peasants seek work** — Missed; scheduled Beta M4 phase 6 (after a build/repair job, nearest unfinished building then unworked farm within 12 tiles).
2. **Build prompt stays attached** — Partially implemented (Shift kept placement active); scheduled Beta M4 phase 2: placement stays active by default.
3. **Select all idle peasants button** — Scheduled Beta M4 phase 2; now specified as the bottom-bar idle-peasant button and `Shift+.` selecting all idle peasants.
4. **AoE troop formations** — Missed; scheduled Beta M4 phase 7 (Line, Staggered, Box, Flank; slowest-member speed).
5. **Gold economy tuning** — Missed as an explicit target; scheduled Beta M6 (banked gold/food goalpost), rechecked in Pre-release M5 phase 4.
6. **Clunky combat / spearmen crowding** — Missed; scheduled Beta M4 phase 8 (melee contact slots, swings anchored against separation).

## Post-Alpha full match (2026-11-09)

The user confirmed their last E2E full match against AI was a complete match and added the following feedback. Both items are **not implemented** and are **scheduled under Beta M4 UX** (`docs/plans/02-beta.md#m4--complete-gameplay-features`, phase 2).

1. **Multi-building selection and even training queues** — Not implemented; scheduled for Beta M4 UX.
   Double-clicking an owned military building should select all owned buildings of the same type that are currently on screen (no off-screen buildings and no other building types). Units queued/trained from the selection should be distributed evenly across the selected buildings.

2. **Immediately visible unit prices** — Not implemented; scheduled for Beta M4 UX.
   Unit food and gold prices should be visible immediately in the training UI instead of depending on the delayed (about one second) hover tooltip.

Cross-reference: deliverables and unchecked acceptance goalposts are recorded in `docs/plans/02-beta.md` under [M4 — Complete gameplay features](plans/02-beta.md#m4--complete-gameplay-features).

