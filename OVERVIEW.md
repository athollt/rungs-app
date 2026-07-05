# OVERVIEW — rungs-app

Architecture and internals of **Rungs** — a multi-tenant ranking-ladder platform. For
*running* the app (setup, dev, tests, deploy) see
[`README.md`](README.md); this doc is the map of *how it is built*.

## Purpose

A mobile-first PWA hosting **many independent ranking ladders** — one **League** per club,
for any doubles sport where you count each player's wins per session. Each League lives at
its own URL `/l/{slug}` ([ADR-013](docs/plans/DECISIONS.md)) and its public ladder, session
history, and per-player rating trends are viewable without login. A signed-in **Scorer**
submits/edits their own sessions and manages players for the League(s) they're granted; a
global **Admin** administers every League, creates Leagues, and assigns Scorers
([ADR-012](docs/plans/DECISIONS.md)). Login is **staff-only**; a non-staff Google sign-in
can request scoring access in-app ([ADR-014](docs/plans/DECISIONS.md)). Hosted on Fly.io
(Johannesburg) — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

> **Branding:** the product/PWA identity is **Rungs** (single shared identity, ADR-013);
> individual Leagues keep their own display names (e.g. "Doubles Squash @ BSC"). The Fly
> app/Postgres and domain were renamed to `rungs` at the Rungs cutover (plan step 25,
> complete) — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Tech stack

- **Next.js 16** (App Router, TypeScript strict) — Server Components + Server Actions; no
  REST API layer for the app's own data.
- **Prisma 7** with the **`@prisma/adapter-pg`** driver adapter → **PostgreSQL**. The
  generated client lives in [`app/generated/prisma`](app/generated/prisma) (the
  `prisma-client` generator emits TypeScript).
- **Auth.js v5** (NextAuth) — Google OAuth (+ a Credentials provider for local/E2E only).
- **Tailwind CSS v4** (CSS-variable theme, no JS config) + **shadcn/ui** primitives.
- **Serwist** service worker for the PWA (emitted by the production webpack build only).
- **Vitest** (unit) + **Playwright** (E2E).

## Architecture at a glance

The codebase follows a **pure-core / thin-shell** pattern throughout:

- **Pure logic in [`lib/`](lib/)** — domain functions that take plain inputs (or a *store
  port*) and return results. No Prisma, no framework. Unit-tested in isolation.
- **Server Actions** ([`app/**/actions.ts`](app/)) — thin wrappers that authorise, call the
  pure function, persist via Prisma, and `revalidatePath`.
- **Server Components** (`page.tsx`) — load data via a Prisma store, run the pure engine, and
  render. Public pages are `force-dynamic` (no stored ladder cache — see
  [ADR-002](docs/plans/DECISIONS.md)).

This is why most behaviour is testable without a database or the OAuth runtime.

## Directory map

| Path | What's there |
|---|---|
| [`app/`](app/) | Routes (App Router). Landing/switcher: `/`. Per-League under **`/l/[slug]/`** — public: ladder, `sessions`, `sessions/[id]`, `players/[id]`; scorer: `submit`, `sessions/[id]/edit`, `admin/{players,sessions,settings}`. Global-admin (top-level): `/admin/{users,leagues,access-requests}`. Plus `/signin`, `/request-access` (non-staff bounce), `/unauthorised`, `/~offline`. Server Actions in `**/actions.ts`. |
| [`app/sw.ts`](app/sw.ts) | Serwist service-worker source (bundled to `public/sw.js` at build). |
| [`lib/`](lib/) | Pure domain logic (see below) + the Prisma singleton and store adapters. |
| [`components/`](components/) | App components (`site-header`, `session-form` (with draft autosave in submit mode), `share-button` (Web Share API, touch-only — ADR-009/016), `admin-menu`, `rating-trend-chart`, …) and `components/ui/` design-system primitives (`page-shell`, `card`, `badge`, `trend`, `bottom-nav`, …). |
| [`prisma/`](prisma/) | `schema.prisma`, `migrations/`, `seed.ts` (seeds the BSC + Padel Leagues, each with 15 settings, + the first admin), `seed-sample.ts` (opt-in demo data). |
| [`auth.ts`](auth.ts) | Single Auth.js config (providers + `signIn`/`jwt`/`session` callbacks). |
| [`proxy.ts`](proxy.ts) | Next 16 proxy (was `middleware.ts`) — route gating via `authorizeRoute`. |
| [`docs/`](docs/) | This repo's docs: deployment, rating algorithm, and the `plans/` design set. |

## Key domain modules (`lib/`)

- **Rating** — [`rating-engine.ts`](lib/rating-engine.ts) (the pure `recalculate`),
  orchestrated by [`recalc.ts`](lib/recalc.ts) over a store port, backed by
  [`recalc-store.ts`](lib/recalc-store.ts). Full explanation:
  [`docs/RATING-ALGORITHM.md`](docs/RATING-ALGORITHM.md).
- **Auth** — [`auth-rules.ts`](lib/auth-rules.ts) (`authorizeRoute` + `canScoreLeague` +
  `canMutateSession` — pure route/league policy) and [`auth-callbacks.ts`](lib/auth-callbacks.ts)
  (provider-aware sign-in, role attach, credentials verify). [`password.ts`](lib/password.ts)
  for the Credentials provider.
- **Tenancy** — [`league.ts`](lib/league.ts) (`leagueBySlug`), [`league-access.ts`](lib/league-access.ts)
  (`resolveLeagueOr404` — slug→League for public pages; `resolveScorerContext` — the non-throwing
  scorer resolver used by Server Actions; `requireLeagueScorer` — its page-boundary adapter that
  redirects/404s), `league-scorer-store.ts`
  (grant/revoke/list), `landing.ts` (`visibleLeaguesFor` / `bounceTarget`), `slug.ts`
  (suggest/validate; slugs are immutable), `league-provisioning.ts` (create/update/delete League,
  assign/revoke Scorer), `access-requests.ts` (request/approve/dismiss — ADR-014), `page-title.ts`.
- **Entities** — `players.ts` / `users.ts` / `settings.ts` (pure create/update + validation
  over `*-store.ts` ports), `session-validation.ts`, `session-authz.ts`,
  `session-intake.ts` (pure `intakeSession` unifying submit + edit — resolves on-the-fly players,
  validates, persists, triggers per-league recalc) backed by `session-write-store.ts`
  (Prisma `SessionWriteStore` adapter).
- **Presentation helpers** — `public-ladder.ts`, `session-history.ts`, `player-trend.ts`,
  `nav.ts`, `default-settings.ts`.
- **Demo data** — `sample-data.ts` (deterministic generator used by `seed-sample.ts`).

## Data model (`prisma/schema.prisma`)

A **`League`** (name, `displayName`, unique immutable `slug`) is the tenant: `Player`,
`Session`, `Setting`, `RatingsLog`, and `LadderSnapshot` each carry a non-null `leagueId`
([ADR-011](docs/plans/DECISIONS.md)); `Setting` is unique on `(leagueId, key)`, so each League
has its own 15 algorithm parameters. `User` (Google accounts + global role) and `Player` (name
roster, now per-League) are **deliberately unlinked** ([ADR-004](docs/plans/DECISIONS.md)). A
`Session` has many `SessionPlayer` rows (wins per player). `RatingsLog` powers trends;
`LadderSnapshot` stores a ladder state as JSON (powers movement). **`LeagueScorer(userId,
leagueId)`** is a Scorer's per-League grant ([ADR-012](docs/plans/DECISIONS.md)). **`AccessRequest`**
(email, name, nullable `leagueId`, notes, status) is an in-app request to score a League or set
up a new one ([ADR-014](docs/plans/DECISIONS.md)). `SessionPlayer` + `RatingsLog` cascade-delete
with their `Session`; the tenant `leagueId` FKs are `onDelete: Restrict` (a League is deleted by
removing its children in order — see `league-provisioning-store.ts`).

## Authentication & authorisation

- Sign-in is **Google OAuth**. Staff (a `User` row) sign in regardless of provider; a
  **non-staff Google** account is allowed in too (role-less session) and is bounced to
  `/request-access` ([ADR-012](docs/plans/DECISIONS.md)/[ADR-014](docs/plans/DECISIONS.md)).
  The Credentials path stays staff-only. The `User` table stays staff-only; only *sessions*
  open up.
- [`proxy.ts`](proxy.ts) gates on route **shape** only (DB-free): public `/l/{slug}` reads
  open; scorer/admin shapes fall through to the auth gate. The real per-League check is at the
  **page boundary** — `requireLeagueScorer` ([`league-access.ts`](lib/league-access.ts))
  resolves the slug→League and enforces the `LeagueScorer` grant (admin bypasses; ADR-012).
  Global-admin routes (`/admin/{users,leagues,access-requests}`) require `ADMIN`.
- **Authority model** ([ADR-012](docs/plans/DECISIONS.md)): a global **ADMIN** can act on every
  League; a **SCORER** has power only via `LeagueScorer` grants and edits only their own
  sessions in a granted League (`canScoreLeague` / `canMutateSession`). Server Actions re-check
  (defence in depth).
- A **Credentials provider** exists for local manual testing and E2E only
  ([ADR-006](docs/plans/DECISIONS.md)); production uses Google.
- Single Auth.js config in `auth.ts` (the earlier Edge/Node split was collapsed —
  [ADR-007](docs/plans/DECISIONS.md)).

## Conventions

- **Reuse before building.** Shared UI lives in `components/ui/` (page shell, card, badge,
  trend, bottom-nav); pages compose these rather than hand-rolling chrome
  ([ADR-008, redesign sequencing](docs/plans/DECISIONS.md)).
- **Pure first.** New domain logic goes in `lib/` as a pure function over a store port, with
  a unit test, before any Server Action/Component wires it up.
- **Tailwind v4 source globs** are explicit (`@source` in `globals.css`) because automatic
  detection follows out-of-repo symlinks and breaks the dev server
  ([ADR-005](docs/plans/DECISIONS.md)). New top-level class-bearing dirs need a `@source`
  line.
- **E2E for any route change** — steps that add/alter a user-facing route extend the
  Playwright suite using the ephemeral test-user/test-data pattern (created in global setup,
  removed in teardown).

## Domain language

- **League** — a tenant: one club's ladder, at `/l/{slug}`, with its own players, sessions,
  and rating settings. The product/PWA shell is **Rungs**; a League keeps its own display name.
- **Session** — one night's play; a set of players with games won each (partners/opponents
  not recorded).
- **Rating** — a player's skill number (starts at 1000). **Ladder score** = rating + activity
  bonus; the ladder ranks by ladder score.
- **Provisional** — a player still within their first `NewPlayerSessions` sessions.
- **Active / Inactive** — played within / outside `ActiveThresholdDays`. **Removed** —
  off the visible ladder but kept in history.
- **Scorer** (per-League) / **Admin** (global) — the two staff roles; a Scorer's authority is
  its `LeagueScorer` grants. **Access request** — an in-app request by a signed-in non-staff
  user to become a Scorer (or to set up a new League). See
  [`docs/RATING-ALGORITHM.md`](docs/RATING-ALGORITHM.md) for every algorithm term.

## Where to read more

- Rating maths: [`docs/RATING-ALGORITHM.md`](docs/RATING-ALGORITHM.md)
- Production/runtime: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Decisions & history: [`docs/plans/DECISIONS.md`](docs/plans/DECISIONS.md),
  [`docs/plans/CHANGELOG.md`](docs/plans/CHANGELOG.md)
- Original requirements: [`docs/plans/PRD-doubles-squash-ladder.md`](docs/plans/PRD-doubles-squash-ladder.md),
  [`docs/plans/SPEC-original-google-sheets.md`](docs/plans/SPEC-original-google-sheets.md)
