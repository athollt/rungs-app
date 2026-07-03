# Step 27: Session intake deepening

## Objective

Unify the submit and edit session intake paths behind one pure module, fixing the duplicate-Player bug where editing a session and typing a "new" player name that matches an existing player creates a duplicate Player row.

## Context

- Read first: `CHANGELOG.md` (step 20 authz, step 16 submit/edit), `DECISIONS.md` (ADR-001 recalc, ADR-010 scorer session ownership), `CONTEXT-rungs.md` (frozen vocab: Player, Session, Scorer, Wins)
- The submit action (`app/l/[slug]/submit/actions.ts`) uses `resolvePlayerName` from `lib/players.ts` to reuse existing players by name (case-insensitive)
- The edit action (`app/l/[slug]/sessions/[id]/edit/actions.ts`) calls `prisma.player.create` directly for any `newName` slot, bypassing `resolvePlayerName` — typing "John" when John already exists creates a second Player row
- The edit action also hand-rolls authorization (`authoriseFor`) instead of composing the existing `requireLeagueScorer` + `canMutateSession`
- The edit *page* (`app/l/[slug]/sessions/[id]/edit/page.tsx`) already composes `requireLeagueScorer` + `canMutateSession` at the page boundary — the action re-derives the same check from scratch
- `requireLeagueScorer` in `lib/league-access.ts` redirects on failure (throws via Next.js `redirect`)
- The edit action returns `{ ok: false; error }` on failure — it cannot use a function that redirects
- `canMutateSession` in `lib/session-authz.ts` is a pure function checking ownership + league grant
- `validateSession` in `lib/session-validation.ts` is a pure function
- `runRecalculation` in `lib/recalc.ts` takes a `RecalcStore` port and orchestrates load → recalculate → persist
- `PlayerStore` interface in `lib/players.ts` has `findByName`, `create`, `updateName`, `updateStatus`
- `resolvePlayerName` in `lib/players.ts` takes a `PlayerStore` + name, reuses existing (case-insensitive) or creates new
- The repo is pure-core / thin-shell: push logic into pure `lib/` functions, keep Server Actions thin

### The design

Two new pure modules, following the existing store-port pattern:

1. **`resolveScorerContext(slug)`** — a pure, non-throwing resolver in `lib/league-access.ts`. Returns `{ ok: true; league; userId; role }` or `{ ok: false; error }`. Resolves league by slug, checks auth, checks scorer grant with admin bypass. `requireLeagueScorer` becomes a thin redirecting adapter over it (calls it, redirects on failure). The edit action calls `resolveScorerContext` directly and returns `{ ok: false; error }` on failure — no redirect mismatch.

2. **`intakeSession(input, store, mode)`** — a pure function in `lib/session-intake.ts`. Takes `{ leagueId, submittedById, slots, notes, now, mode: "create" | "update", sessionId? }` and a `SessionIntakeStore` port. Resolves slots via `resolvePlayerName`, validates via `validateSession`, persists (create or replace), recalcs via `runRecalculation`. One function, two call sites (submit + edit). `deleteSession` stays separate — it doesn't resolve or validate.

## Specification

### 1. Extract `resolveScorerContext`

Refactor `lib/league-access.ts`:
- Add `resolveScorerContext(slug)`: calls `auth()`, `leagueBySlug`, `prismaLeagueScorerStore.leagueIdsFor(userId)`. Returns `{ ok: true; league; userId; role }` if authenticated + granted (or admin), `{ ok: false; error }` otherwise. No `redirect` / `notFound` calls — pure return.
- Refactor `requireLeagueScorer(slug)` to call `resolveScorerContext` and redirect/notFound on failure. Same external behaviour (page callers unchanged).

### 2. Create `SessionIntakeStore` port + `intakeSession`

Create `lib/session-intake.ts`:
- Define `SessionIntakeStore` interface combining the ports the function needs: `PlayerStore` (findByName, create), `SessionWriteStore` (createSession, replaceSession), `RecalcStore` (load + persist for recalc)
- Define `SessionWriteStore` interface: `createSession(leagueId, submittedById, slots, notes, timestamp)` and `replaceSession(sessionId, leagueId, submittedById, slots, notes)`
- `intakeSession(input, store)`:
  1. Resolve each slot via `resolvePlayerName(store, leagueId, name)` — reuses existing player (any status) or creates new. This is the duplicate-Player fix: edit now reuses instead of always creating.
  2. Validate via `validateSession(resolvedSlots)` — return `{ ok: false; error }` if invalid
  3. Persist: `createSession` (mode "create") or `replaceSession` (mode "update")
  4. Recalc via `runRecalculation(store, now, leagueId)`
  5. Return `{ ok: true }` or `{ ok: false; error }`

### 3. Create Prisma adapter for `SessionWriteStore`

Create `lib/session-write-store.ts`:
- `createSession`: insert Session + SessionPlayers in a transaction (same logic as current submit action)
- `replaceSession`: delete existing SessionPlayers + insert new ones in a transaction (same logic as current edit action)
- Both scoped to `leagueId`

### 4. Refactor submit action

`app/l/[slug]/submit/actions.ts`:
- Call `resolveScorerContext(slug)` → return error if not ok
- Build `SessionIntakeStore` from Prisma adapters (`makePrismaPlayerStore`, `prismaSessionWriteStore`, `prismaRecalcStore`)
- Call `intakeSession({ mode: "create", ... }, store)`
- `revalidatePath` on success

### 5. Refactor edit action

`app/l/[slug]/sessions/[id]/edit/actions.ts`:
- Call `resolveScorerContext(slug)` → return error if not ok
- Load target session, check `canMutateSession` → return error if not allowed
- Build `SessionIntakeStore`
- Call `intakeSession({ mode: "update", sessionId, ... }, store)`
- `revalidatePath` on success
- Delete hand-rolled `authoriseFor`

### 6. Delete dead code

- Remove `authoriseFor` from edit actions (replaced by `resolveScorerContext` + `canMutateSession`)
- Remove direct `prisma.player.create` from edit actions (replaced by `resolvePlayerName` inside `intakeSession`)

**Behaviours to verify (TDD order):**
1. `intakeSession` create mode, all existing players → creates session + SessionPlayers, triggers recalc
2. `intakeSession` create mode, new name → creates Player, creates session, triggers recalc
3. `intakeSession` update mode, new name matching existing player → **reuses existing player (regression test for duplicate-Player bug)**, replaces SessionPlayers, triggers recalc
4. `intakeSession` update mode, replacing all players → deletes old SessionPlayers, inserts new, triggers recalc
5. `intakeSession` with invalid session (wrong player count, duplicate players, bad wins) → returns validation error, no persistence, no recalc
6. `resolveScorerContext` returns ok for granted scorer
7. `resolveScorerContext` returns error for ungranted non-admin user
8. `resolveScorerContext` returns ok for admin (bypass grant check)
9. `requireLeagueScorer` still redirects on failure (adapter behaviour unchanged)

## Validation

```bash
npm run build && npm run test
```

This step touches the existing edit route (action refactor) — extend the Playwright edit journey:

```bash
npm run test:e2e
```

The E2E extension covers: edit a session, type a new player name that matches an existing player, save, verify no duplicate Player row appears on the ladder.

## Completion

1. Update `CHANGELOG.md` with what was delivered (intake module, duplicate-Player fix, auth consolidation)
2. Mark step 27 complete in `RUNGS-PLAN.md`
3. Commit `step-27: session intake deepening`
4. Push `at-wip`
