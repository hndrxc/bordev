**info**
- This is a headless ubuntu linux install.

**workflow**
- Balance parallel work by prerequisites and likely duration, not just file count. Establish shared interfaces first; avoid assigning the shared implementation and all of its consumers to one oversized task while other agents finish early.
- Keep concrete integration work for the parent while agents run. When genuinely blocked, use completion notifications or the blocking wait tool; do not repeatedly check job status or logs.
- Before a line-targeted edit, read the exact current range and use its snapshot tag. Do not calculate line numbers from remembered or newly written content. If an edit result is unexpected, re-read before correcting it.
- Identify background results by command and purpose as well as job ID. If spawn and completion IDs disagree, report the tool issue and verify which command produced the result before using it as evidence.
- After an interruption, a missing job record does not prove that its process stopped. Recover running/completion evidence before relaunching work that writes the same outputs. Resume through verified caches rather than deleting successful outputs and rebuilding everything.

**art pipeline**
- Read the sprite-pipeline notes in `docs/plans/00-overview.md` before changing Blender rendering or atlas conventions; they record verified Blender 5.2 behavior.
- For renderer changes, first render the smallest representative cases: calibration tile/arrow, one animated unit frame, and one building body/mask/shadow frame. Check projection, alpha, TEAM coverage, shadow bounds, and compositor compatibility before a full asset build.
- Finalize render sources and cache-affecting edits before starting expensive full renders. Exercise the complete pipeline afterward, then verify that an unchanged rerun skips all work.

**skill**
- Use the codebase design skill as your guide when creating files and codebase structure.
- Use any other availble skill when needed.
