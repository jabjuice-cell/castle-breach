# Routing overrides (Castle Breach)

- Small, focused game changes (one feature, a handful of files): read and edit inline. Do not hand off to scout/builder for lookups; the round trips cost more than they save here.
- Delegate only broad sweeps (many files, the whole repo) or long independent jobs.
- The game is its own repo at C:\GameDesign\castle-breach\game. Edit, test and commit there, even when the session started in a worktree of the parent folder (whose game/ folder is empty).
- Balance check: `npm run sim:quick` (well under a minute) and compare with tools/sim-baseline.txt. Full `npm run sim` only for big balance changes; run it in the background.
