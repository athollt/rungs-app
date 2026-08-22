# Rungs — Plan (multi-tenant club ladder)

**Source**: [PRD-rungs.md](PRD-rungs.md)
**Target repo**: `rungs-app` (rebrand complete)
**Execution model**: one step per prompt, CHANGELOG as ground truth

> **Extends [PLAN.md](PLAN.md)** — it does not replace it. The BSC Doubles Squash
> Ladder plan (steps 01–17) is the foundation; Rungs continues the **same** step
> numbering from **18** and shares the same append-only [DECISIONS.md](DECISIONS.md),
> [CHANGELOG.md](CHANGELOG.md), and [CONTEXT-rungs.md](CONTEXT-rungs.md).
> **Step 17 (backup verification) is a prerequisite** — ADR-015's data migration
> (step 19) must not run without a verified backup.

---

## Execution Protocol

For each step the agent:
1. Reads `RUNGS-PLAN.md` (this file) → status; `PLAN.md` for prior-product history
2. Reads `CHANGELOG.md` → what prior steps delivered
3. Reads `DECISIONS.md` → locked-in architecture (Rungs = ADR-011…015)
4. Reads `CONTEXT-rungs.md` → glossary + **frozen vocab** (don't relabel Player/Session/Wins/Rating/Ladder/Scorer)
5. Reads `steps/step-XX-*.md` → spec
6. Executes via TDD — vertical tracer bullets, never horizontal
7. Validates: step-specific commands + global validation below
8. Updates `CHANGELOG.md` with what was delivered
9. Marks step `complete` in `RUNGS-PLAN.md`
10. Commits as `step-XX: <title>`; pushes `at-wip` to origin

### Context Window Protocol
- Human kicks off every step — never auto-continue
- If context permits, human may chain steps in one window
- Each step file is self-contained

### Git Workflow
- **Integration branch**: `main` · **Working branch**: `at-wip`
- **Commit format**: subject `step-XX: <title>`, blank, 1–2 sentence overview, blank, bulleted sections that apply (`New:`, `Wiring:`, `API:`, `Removed:`, `Tests:`), final `Validation:` line. No Trello (personal project — see AGENT-NOTES.md).
- After each commit: `git push origin at-wip`
- Agent MUST NOT merge to `main` — manual via `/create-pr`
- No force-push, no credentials in messages, no AI attribution in commit messages (AGENTS.md §6)

### TDD Discipline

Each step's `Specification` lists behaviours in order. Apply vertical TDD:

```
For each behaviour:
  RED:   one test → fails
  GREEN: minimal code → passes
```

No writing all tests up front. No testing internal collaborators. Single commit per step after all cycles green and validation passes. The repo is **pure-core / thin-shell** — push logic into pure `lib/` functions (unit-testable without a DB) and keep Server Actions/Components thin.

### Key Rules
- Read `CHANGELOG.md` + `DECISIONS.md` + `CONTEXT-rungs.md` before any step
- All tests pass before `complete`; document spec deviations in `CHANGELOG.md`
- One commit per step; only requested changes in the diff — no drive-by refactors
- **Reuse before you build**: consume the existing design-system primitives (steps 13.4–13.5) before creating new UI; flag missing primitives in `CHANGELOG.md`
- **E2E rule (inherited)**: any step adding/altering a user-facing route MUST add/extend Playwright journeys, using the ephemeral test-user/test-data pattern from step 05.1 (created in global setup, deleted in teardown — never seeded). A step touching no route records "no E2E required".
- **Engine is unchanged** — it already rates individuals from `{ playerId, wins }[]`. No rating-algorithm changes in this plan.

---

## Step Status

| # | Step | Status | Depends On |
|---|------|--------|------------|
| 18 | [Tenancy schema — League + leagueId + per-league Settings](steps/step-18-tenancy-schema.md) | complete | 17 |
| 19 | [BSC adoption migration + per-league recalc & read scoping](steps/step-19-adoption-recalc.md) | complete | 17, 18 |
| 20 | [Staff-only auth — LeagueScorer grants + league-scoped authz](steps/step-20-league-authz.md) | complete | 18 |
| 21 | [Path-prefix routing — `/l/{slug}` + slug lifecycle](steps/step-21-slug-routing.md) | complete | 19, 20 |
| 22 | [Landing, League switcher & admin provisioning](steps/step-22-provisioning.md) | complete | 20, 21 |
| 23 | [Non-staff bounce + access requests + approval queue](steps/step-23-access-requests.md) | complete | 22 |
| 24 | [Rungs rebrand & docs](steps/step-24-rebrand-docs.md) | complete | 21, 22, 23 |
| 25 | [Infra rename & rungs.co.za cutover](steps/step-25-infra-rename.md) | complete | 24 |
| 26 | [GitHub repo rename → `rungs-app`](steps/step-26-repo-rename.md) | complete | 25 |
| 27 | [Session intake deepening — unify submit/edit, fix duplicate-Player bug](steps/step-27-session-intake-deepening.md) | done | 26 |
| 28 | [Share from session history + draft autosave](steps/step-28-share-from-history-draft-autosave.md) | done | 27 |
| 29 | [Update documentation](steps/step-29-update-docs.md) | complete | 28 |
| 30 | [Timer - a swimming stopwatch inside Rungs](steps/step-30-timer.md) | complete | 29 |
| 30.5 | [Timer entry time](steps/step-30.5-entry-time.md) | complete | 30 |

> Risk isolation: **step 19** (data migration over live prod data) and **step 25**
> (Fly app/DB + domain rename to `rungs.co.za` — hard to reverse, touches GitHub
> Actions + Fly.io) are deliberately their own steps. **Step 24** (the cosmetic
> Rungs rebrand) is fully testable locally and carries the lifecycle `update-docs`
> close; **step 25** is the final step (manual infra cutover, verified live).

---

## Validation Command

```bash
npm run build && npm run test
```

Steps that touch user-facing routes also run the E2E suite (local Postgres up + migrated):

```bash
npm run test:e2e
```

---

## Reference Documents

- **PRD**: [PRD-rungs.md](PRD-rungs.md)
- **Decisions**: [DECISIONS.md](DECISIONS.md) (ADR-011…015) · **Glossary**: [CONTEXT-rungs.md](CONTEXT-rungs.md)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) (shared)
- **Prior product**: [PLAN.md](PLAN.md) · [PRD-doubles-squash-ladder.md](PRD-doubles-squash-ladder.md)
- **Agent notes**: [../../AGENT-NOTES.md](../../AGENT-NOTES.md)
- **Rebrand prototype**: `zTemp/rebrand-prototype/PROTOTYPE-NOTES-rebrand.md` (gitignored; decision mirrored in CONTEXT-rungs.md + ADR-013)
