# Step 30: Timer - a swimming stopwatch inside Rungs

## Objective

Add a public, client-only stopwatch at top-level `/timer`, reachable from the header hamburger
for any signed-in staff user. Built for poolside lap timing where **the archive is a phone
screenshot**, not a database record: nothing is persisted server-side, and the whole run must
be legible in one viewport.

## Context

- Read first: `DECISIONS.md` (ADR-013 single shared PWA identity), `CONTEXT-rungs.md`, `AGENT-NOTES.md`
- Design settled in a grilling session; the shape decision and its rejected alternatives are
  recorded as **ADR-017** in this step.
- **Not a separate PWA.** Rejected: a separate repo + Fly app, `timer.rungs.co.za` on the
  existing Fly app, and a per-scope `manifest-timer.json` for a distinct home-screen icon.
  Chosen: one route in the existing app, no new infrastructure.

### Repo facts this step depends on

- `BottomNavBar` (`components/ui/bottom-nav.tsx:63`) returns `null` when the path has no
  `/l/{slug}` in it, so a top-level `/timer` renders with **only** the `SiteHeader` (~53px).
  That is what makes 10 lap rows fit without a two-column grid.
- `AdminMenu` (`components/admin-menu.tsx`) renders only when `role` is truthy, and off a
  league route shows `globalAdminLinks()` for an ADMIN and `[]` for a SCORER - in which case
  the whole menu hides. Adding a tools group fixes that gap as a side effect.
- `isPublicRoute` in `lib/auth-rules.ts` is the single gate `proxy.ts` consults.
- `lib/` convention is one module + one `.test.ts` per concern. `lib/share.ts` is the
  precedent for a browser-API-adjacent helper living there with pure unit tests.
- `app/sw.ts` precaches `__SW_MANIFEST` (build assets + `public/`) and falls back to
  `/~offline` for failed document navigations. App Router **pages** are not in the precache
  manifest, so a first-ever offline hit on `/timer` shows the offline page; after one online
  visit `defaultCache` runtime-caches it.

### Design decisions (settled, do not re-litigate)

| Decision | Choice |
|---|---|
| Timing source | Wall clock. `Date.now()` anchors; **never** accumulate interval ticks. |
| Repaint | `requestAnimationFrame`. |
| Screen sleep | Screen Wake Lock held while running, **re-acquired on `visibilitychange`**. |
| Precision | `mm:ss.hh`, rolling to `h:mm:ss.hh` past an hour. Monospace numerals. |
| Clock line | Live until Start, then **frozen at the start timestamp**. Reset returns it to live. |
| Stop | Records a final lap **and** ends the run. No resume. |
| Reset | Requires confirm (two-tap). Available while running too. |
| Lap order | Chronological, Lap 1 at top. |
| Persistence | `localStorage` only. No DB, no auth, no server data. |
| Stale runs | Discard a persisted run whose `startedAt` is over **12 hours** old. |
| Offline | No explicit precaching. Verified by an airplane-mode acceptance test. |

## Specification

### 1. Pure timer logic - `lib/timer.ts`

All state derives from wall-clock timestamps, so a restored run is correct with no bookkeeping.

```ts
export interface TimerRun {
  startedAt: number;          // epoch ms
  stoppedAt: number | null;   // epoch ms once ended
  lapMarks: number[];         // epoch ms, ascending; the final entry === stoppedAt when ended
}

export interface LapRow {
  index: number;   // 1-based
  lapMs: number;   // since the previous mark (or startedAt for lap 1)
  totalMs: number; // since startedAt
}
```

Functions, all pure and clock-injected:

- `formatDuration(ms: number): string` - `mm:ss.hh`; `h:mm:ss.hh` at or past one hour.
  Zero-pads minutes and seconds; hundredths always two digits.
- `elapsedMs(run: TimerRun, now: number): number` - `(run.stoppedAt ?? now) - run.startedAt`.
- `lapRows(run: TimerRun): LapRow[]` - derives rows from `lapMarks`; `lapMs` is the delta from
  the previous mark, falling back to `startedAt` for the first.
- `fastestLapIndex(rows: LapRow[]): number | null` - `null` when fewer than two rows (a single
  lap is not "fastest").
- `restoreOrDiscard(run: TimerRun | null, now: number): TimerRun | null` - returns `null` when
  `run` is absent or `now - run.startedAt > 12 * 60 * 60 * 1000`; otherwise the run unchanged.

The 12-hour rule is checked against `startedAt` (not `stoppedAt`) so a run left ticking
overnight is discarded rather than restored as a 14-hour ghost.

### 2. Client component - `components/stopwatch.tsx`

`"use client"`. Holds only the effects: `requestAnimationFrame`, wake lock, and `localStorage`.
All display values come from `lib/timer.ts`.

Layout, top to bottom:

```
  Freestyle 50s        ✏️      title, tap to edit inline
  Thu 21 Aug 2026 · 17:42      live, frozen on Start

        12:34.56               monospace, large

  [ Start/Stop ] [ Lap ] [ Reset ]

  #   Lap        Total
  1   00:41.22   00:41.22
  2   00:39.87   01:21.09
```

- **Start/Stop is one toggling button.** **Lap is the largest tap target** - it is the only
  button pressed under time pressure. Lap is disabled while stopped.
- **Reset is a two-tap confirm** (the button becomes "Confirm?" for a few seconds). A stray tap
  must not destroy a set before it has been screenshotted.
- **Stop pushes `now` onto `lapMarks` and sets `stoppedAt = now`** - the final lap and the end
  of the run are the same event.
- **Title** is inline-editable, single line, truncated at ~40 chars, defaulting to the last one
  used.
- **Fastest lap** gets a subtle highlight, only when there are two or more laps.
- Ten rows is the **layout target, not a cap** - beyond that the list scrolls (and the
  screenshot will miss the top; that is accepted).
- Numerals are monospace throughout (`--font-geist-mono` is already wired) so digits do not
  jitter as they tick.

**Wake lock:** request `navigator.wakeLock.request("screen")` when a run starts; release on
stop and reset. Browsers release the lock whenever the page hides, so **re-acquire it on
`visibilitychange` when the page is visible and a run is active** - without this the screen
sleeps again after the first unlock. Feature-detect; degrade silently where unsupported.

**Persistence:** two keys, following the `rungs-draft-{slug}` naming already in `SessionForm`.

- `rungs-timer` - the `TimerRun`, written on every state change (start, lap, stop, reset clears it).
- `rungs-timer-title` - the last title, kept independently so it survives a discarded run.

On mount, read `rungs-timer`, pass it through `restoreOrDiscard(run, Date.now())`, and use the
result. Guard all access with `typeof window !== "undefined"`.

### 3. Route - `app/timer/page.tsx`

Thin server component: `export const metadata = { title: "Timer" }` (the root template appends
" - Rungs") rendering `<Stopwatch />`. **No Prisma import, no `auth()` call.** It inherits the
root layout's `SiteHeader`; the bottom nav self-hides because there is no slug in the path.

### 4. Public route gate - `lib/auth-rules.ts`

Add `pathname === "/timer"` to `isPublicRoute`. The stopwatch stores nothing, so there is
nothing to protect - and gating it means an expired session bounces you to Google OAuth on club
wifi when you are trying to time a swim.

### 5. Tools group in the hamburger - `lib/nav.ts` + `components/admin-menu.tsx`

Add to `lib/nav.ts`:

```ts
// Tools are not management and not league-scoped: they apply on every route and to
// every role. Kept separate from adminLinksFor/globalAdminLinks so the hamburger's
// management semantics stay intact.
export function toolLinks(): NavLink[] {
  return [{ key: "/timer", href: "/timer", label: "Timer" }];
}
```

In `AdminMenu`, append `toolLinks()` to the resolved `links` for **any** role. Keep the
`links.length === 0` guard. Side effect worth noting: a SCORER off a league route previously
saw no hamburger at all and would have been stranded on `/timer`; they now get one.

A signed-in **non-staff** user (the role-less ADR-014 session) still sees nothing, because
`SiteHeader` only renders `AdminMenu` when `role` is set. That is intended.

### 6. ADR-017 - `docs/plans/DECISIONS.md`

**ADR-017: Timer is a tool inside the Rungs app, not a separate PWA**

- *Context:* a swimming stopwatch was wanted at `watch.rungs.co.za` as its own PWA. It shares
  nothing with the ladder domain - no data, no auth, no server work at all.
- *Decision:* ship it as a public top-level route `/timer` in the existing app, surfaced in the
  header hamburger via a new tools group. No new origin, no second manifest, no new infra.
- *Rejected:* **(a)** separate repo + Fly app - genuinely isolated, but two deploy pipelines and
  two Next/Node upgrades forever for a weekend tool. **(b)** `timer.rungs.co.za` on the same Fly
  app - adds host-rewriting in `proxy.ts`, cross-host redirect edges, DNS and a cert, while
  removing no coupling at all (same build, same `/sw.js`, same deploy): the routing complexity
  of a separate app with none of the isolation. **(c)** a per-scope `manifest-timer.json` for a
  distinct home-screen icon - viable on Android, unverified on iOS, and it requires lifting
  `SiteHeader`/`BottomNavBar`/`auth()` out of the root layout into an `app/(main)/` group.
- *Consequence:* no separate home-screen icon; the timer is reached by opening Rungs. Extends
  rather than contradicts ADR-013's single shared PWA identity. Option (c) remains a cheap
  future upgrade if the extra tap becomes annoying, and (b) is cheap on top of (c).

**Behaviours to verify (TDD order):**

1. `formatDuration` renders `mm:ss.hh` under an hour and `h:mm:ss.hh` at or past one hour, with
   correct zero-padding at boundaries (0ms, 999ms, 59.99s, exactly 1h).
2. `elapsedMs` uses `now` for a running run and `stoppedAt` for an ended one.
3. `lapRows` derives lap 1 from `startedAt` and each later lap from the previous mark; totals
   are cumulative from `startedAt`.
4. `fastestLapIndex` returns `null` for zero or one lap, and the correct index otherwise.
5. `restoreOrDiscard` returns the run at 11h59m, `null` at 12h01m, and `null` for absent input.
6. `toolLinks` returns the Timer link; `adminLinksFor` and `globalAdminLinks` are unchanged.
7. `authorizeRoute("/timer", null)` returns `"allow"` (public, no session).
8. Stopwatch restores a persisted sub-12h run on mount and ignores a stale one.
9. Stop records a final lap and ends the run in a single action.

## Validation

```bash
npm run build && npm run test
```

This step adds a user-facing route, so per `OVERVIEW.md` the Playwright suite must be extended:

```bash
npm run test:e2e
```

E2E covers one smoke journey only - load `/timer` **signed out** (proving the public gate),
Start, Lap, Stop, then Reset requires the confirm tap. It asserts wiring, not timing; all
clock-sensitive logic is unit-tested against injected values.

**Manual acceptance (post-deploy, on the actual phone):**

1. Airplane mode, open the installed PWA, navigate to Timer - it loads and runs.
2. Start a run, lock the phone, wait, unlock - the timer shows the correct elapsed time and the
   screen stays awake (wake lock re-acquired).
3. Ten laps fit in one screenshot with no scrolling.

## Completion

1. Update `CHANGELOG.md` with what was delivered (Timer route, tools nav group, ADR-017).
2. Update `OVERVIEW.md` - directory map (`/timer`, `lib/timer.ts`, `components/stopwatch.tsx`)
   and Domain Language (**Timer**: a client-only stopwatch tool, not league-scoped).
3. Update `README.md` - no new commands; the docs list needs no change unless ADR-017 warrants a
   mention.
4. Mark step 30 complete in `RUNGS-PLAN.md`.
5. Commit `step-30: timer`.
6. Push `at-wip`.
7. Release to prod via the `/create-pr` skill (runs build + test + lint + e2e, then opens the
   PR). Merging to `main` auto-deploys to Fly via `.github/workflows/fly-deploy.yml`.
8. Run the manual acceptance checks above against `https://app.rungs.co.za/timer`.
