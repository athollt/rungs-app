# Step 29: Update documentation

## Objective

Close the documentation loop so docs match the merged feature (steps 27-28).

## Context

- Runs after the last feature step and after `/review-changes`.
- Diff baseline = step 27's start commit (whole feature: intake deepening + share from history + draft autosave).
- Read `DECISIONS.md` for ADR-016 (added in step 28) — confirm it's recorded.
- Read `OVERVIEW.md` — the architecture section describes the pure-core / thin-shell pattern; step 27 adds `lib/session-intake.ts` and `lib/session-write-store.ts` which should be reflected.

## Specification

Run the `update-docs` skill in lifecycle mode (Mode A). Update only docs the diff touched; promote deferred candidates per the skill. Specifically:

- `OVERVIEW.md`: add `lib/session-intake.ts` and `lib/session-write-store.ts` to the lib module list if one exists. Note `resolveScorerContext` as the non-throwing scorer resolver (page adapter = `requireLeagueScorer`).
- `OVERVIEW.md`: note the ShareButton component and the draft autosave if the component list is documented.
- `DECISIONS.md`: confirm ADR-016 is appended (step 28 adds it; this step verifies it's complete).
- If nothing else is touched and no candidates exist, record `no doc changes required`.

## Validation

- Every path in updated docs exists in the current commit; links relative.
- `npm run build && npm run test` still green (docs-only change, no code).

## Completion

1. Update `CHANGELOG.md`
2. Mark step 29 complete in `RUNGS-PLAN.md`
3. Commit `step-29: update documentation`
4. Push `at-wip`
