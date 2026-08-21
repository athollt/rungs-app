# Architectural Decision Records

Append-only. ADRs capture *why*; code shows *what*. New entries at the bottom; supersede rather than amend.

---

## ADR-001: Full recalculation over incremental updates

**Date**: 2026-06-05
**Status**: accepted

**Context**: The rating algorithm must process all sessions chronologically to produce correct ratings (new/returning player multipliers depend on session count and gaps). At ~20 players and 1–3 sessions/week, full recalculation from scratch is computationally trivial.

**Decision**: Every session submit/edit/delete triggers a full recalculation from raw session data. No incremental update path.

**Consequence**: Simple, correct, and auditable. If scale grows 100×, revisit.

---

## ADR-002: current_ratings and ladder are computed, not stored

**Date**: 2026-06-05
**Status**: accepted

**Context**: The spec's `Current_Ratings` and `Ladder` tabs are derived views. Storing them adds a cache invalidation problem.

**Decision**: Derive current ratings and ladder order at request time from `ratings_log` + settings. No stored table for these.

**Consequence**: Every page load runs the aggregation. Acceptable at this scale (~200 ratings_log rows after a year). Add caching/materialisation later if needed.

---

## ADR-003: Reject invalid sessions at submission time

**Date**: 2026-06-05
**Status**: accepted

**Context**: The Google Sheets spec stored invalid sessions and flagged them. In a web app, rejecting bad input at the form is better UX.

**Decision**: Validate on submission. Invalid sessions are never stored. The user sees inline validation errors and corrects before submitting.

**Consequence**: No `Errors` tab equivalent needed. Simplifies the data model.

---

## ADR-004: Players are not linked to Google accounts

**Date**: 2026-06-05
**Status**: accepted

**Context**: Most players will never log in. Player identity is just a display name for the ladder. Auth is only for admins and scorers.

**Decision**: Separate `users` table (Google accounts + roles) from `players` table (name roster). No foreign key between them.

**Consequence**: A scorer who is also a player appears in both tables independently. Simple and correct for this use case.

---

## ADR-005: Out-of-repo symlinks excluded from Tailwind source detection

**Date**: 2026-06-05
**Status**: accepted

**Context**: The repo root contains `.claude` / `.devin` symlinks pointing outside the project. Tailwind v4's automatic content detection walked the root and followed them, crashing the Turbopack dev server (see CHANGELOG step 01.1). This ADR back-fills the reference made there.

**Decision**: Disable Tailwind automatic detection (`@import "tailwindcss" source(none)`) and declare explicit `@source` lines for `app`, `components`, `lib`.

**Consequence**: New top-level dirs holding class-bearing files need their own `@source` line. Documented as a maintenance note in CHANGELOG step 01.1.

---

## ADR-006: Credentials provider alongside Google for testability

**Date**: 2026-06-05
**Status**: accepted

**Context**: Step 04 specified Google OAuth as the only sign-in method, but the Google Cloud credentials do not yet exist (provisioned at deployment, step 14). This blocked all end-to-end verification of auth and the admin pages, and prevented local manual testing. Step 04's spec explicitly allowed manual/deferred E2E, but the gap left behaviour 8 (non-allowlisted account denied) unverified end-to-end.

**Decision**: Add an Auth.js Credentials provider (username/password against the `User` table, bcrypt hash in a nullable `passwordHash` column) **alongside** the Google provider. The provider lives only in the Node-runtime config (`auth.ts`), never the edge `auth.config.ts`, preserving the step-04 split. The existing allowlist/role callbacks are unchanged — they are provider-agnostic. Two seeded users (admin + test scorer) serve as E2E fixtures.

**Consequence**: The app can be signed into and fully E2E-tested without Google. Both providers coexist; once Google works (step 14), the credentials fields are hidden from the sign-in UI while the provider remains for E2E. The tradeoff is a password surface that must not be exposed in production — mitigated by hiding the UI and keeping seed passwords env-driven. Supersedes the "Google OAuth only" intent of step 04.

---

## ADR-007: Adopt the `proxy.ts` convention and collapse the split auth config

**Date**: 2026-06-05
**Status**: accepted (supersedes the split-config rationale of ADR-006 / step 04)

**Context**: Next.js 16 deprecates the root `middleware.ts` convention in favour of `proxy.ts` (the build emits a deprecation warning). The two are not identical: **`middleware.ts` runs in the Edge runtime; `proxy.ts` defaults to the Node.js runtime** (and forbids the `runtime` config option). 

Step 04 introduced a *split* auth config specifically to work around the Edge runtime: `auth.config.ts` (Prisma-free, Edge-safe, shared with the middleware) and `auth.ts` (full Node instance with the Prisma-backed callbacks + Credentials provider). The split existed *only* because the middleware ran on the Edge and could not load Prisma/bcrypt. Under `proxy.ts` running in Node, that constraint no longer exists.

The project has **no users yet** — the cheapest possible moment to correct foundational architecture.

**Decision**:
1. Rename `middleware.ts` → `proxy.ts`. The `config.matcher` export is unchanged; the Auth.js `auth(...)` wrapper remains the default export. 
2. Collapse the split: merge `auth.config.ts` back into `auth.ts` and build the single auth instance once. The proxy imports `auth` from `auth.ts`. The Edge-safety carve-outs (e.g. the duplicated `session` callback added in step 05.1) are removed — there is one config with all providers and callbacks.
3. The pure, provider-agnostic logic (`authorizeRoute`, `resolveSignIn`/`resolveJwt`/`resolveSession`/`verifyCredentials` in `lib/`) is unchanged — those are not coupled to the runtime and keep their unit tests.

**Consequence**: One auth config instead of two; no Edge/Node duplication to keep in sync (the step 05.1 bug — the Edge instance silently missing the `session` callback — becomes structurally impossible). The proxy now runs in Node, so it *may* touch Prisma directly if ever needed (it currently does not — it still only reads `role` off the signed JWT). Risk: the migration touches the core auth wiring, but the 11 Playwright E2E specs from step 05.1 cover the exact behaviour (redirects + role gating) and are the acceptance gate. If a future need arises for Edge middleware, this decision would have to be revisited (re-introducing a Prisma-free config).

---

## ADR-008: Host on Fly.io (Johannesburg) instead of Hetzner; accept deprecated unmanaged Postgres

**Date**: 2026-06-06
**Status**: accepted (supersedes the Hetzner/Cape Town hosting choice of RESEARCH-tech-stack.md §7)

**Context**: The plan (RESEARCH-tech-stack.md §7) specified **Hetzner Cloud CX22, Cape Town (ZA)**, chosen explicitly for low ZA latency and a same-box self-hosted Postgres. At provisioning time two premises proved false: (1) **Hetzner has no South Africa datacenter** — its only locations are EU (Falkenstein/Nuremberg/Helsinki), US (Ashburn/Hillsboro), and Singapore; the "Cape Town" fact was wrong from the start; (2) **CX22 was discontinued 2026-02-13**. Hetzner-EU is ~150–180ms from ZA users. A same-day comparison (`RESEARCH-flyio-vs-hetzner.md`) initially favoured Hetzner *because* "Fly's managed Postgres isn't in ZA (~150ms)" — but with no Hetzner ZA region, that penalty applies to Hetzner too. The only option that puts the app physically in South Africa is **Fly.io's `jnb` (Johannesburg)** region (~10–30ms to ZA users).

**Decision**:
1. **Host on Fly.io, primary region `jnb`.** App as an always-on single machine (`auto_stop_machines = "off"`, `min_machines_running = 1`) — no cold starts for the public ladder.
2. **Database: unmanaged Fly Postgres, also in `jnb`**, co-located with the app (~0ms app↔DB), attached via `fly postgres attach` (sets `DATABASE_URL`). Backups via Fly **volume snapshots** (daily, ~5-day retention); a `pg_dump`→object-storage cron is a deferred hardening option.
3. **Deploy via `flyctl deploy`** from GitHub Actions (`FLY_API_TOKEN` only); migrations run through `fly.toml`'s `release_command = "npx prisma migrate deploy"`. This removes the Dockerfile-only-via-GHCR, `docker-compose.prod.yml`, Caddy, and SSH-deploy machinery the Hetzner plan required. Runtime config lives in **Fly secrets**, not a VPS `.env`.

**Consequence**: Users get true in-SA latency — the property the original plan wanted but couldn't deliver on Hetzner. Deploy/TLS are simpler (`fly deploy`, `fly certs`, auto Let's Encrypt). Cost is modestly higher (~R240/mo vs Hetzner-EU ~R110) and there is **medium vendor lock-in** (fly.toml, Machines, flyctl). **Key accepted risk**: Fly has **deprecated and dropped support for unmanaged Postgres** — `fly postgres create` still works but ops/upgrades/DR are entirely ours, and Fly may remove it. Mitigation: it's a small club app; snapshots cover DR; if Fly retires unmanaged PG we migrate to an external managed Postgres (accepting the ~150ms hop) or revisit hosting. The supported alternative (Fly Managed Postgres) was rejected: not in `jnb` (~150ms) and $38/mo+, which defeats both the latency rationale and the budget. Revisit if Fly brings Managed Postgres to `jnb`. Supersedes ADR-nothing in code but overrides RESEARCH-tech-stack.md §7–§9 (hosting/CI/CD/future-proofing) and the step 14.2/14.4 Hetzner specs (rewritten).

---

## ADR-008: Identity-first, prototype-before-refactor sequencing for the redesign

**Date**: 2026-06-06
**Status**: accepted

**Context**: After step 13 the app worked but felt like a web page, not the mobile/PWA app it is meant to be, and the screens were visually inconsistent — every `page.tsx` hand-rolled its own shell/heading/width and defined local components (`StatusBadge`, `MovementIndicator`, `LadderCards` in `app/page.tsx`). The root cause is structural: no earlier step established shared UI primitives or a "reuse before you build" rule, so each feature page improvised. The obvious instinct — "add a refactor-for-consistency step at the end" — is a trap: extracting shared components *before* the look-and-feel and navigation model are decided produces primitives that get thrown away. The redesign covers two separable axes — **CI** (logo, palette, fonts) and **UX** (layout, navigation, interaction) — and the question was how to sequence them against the build.

**Decision**: Sequence the redesign as five steps, deciding before building, identity before structure:
1. **13.2 CI prototype** — a standalone `zTemp/` mood-board of 5 complete identities; lock the visual identity first.
2. **13.3 UX prototype** — in-app `?variant=` layouts for the two first-class phone journeys (ladder, submit), rendered *in the chosen CI* so feedback is about structure, not placeholder styling.
3. **13.4 design-system foundation** — build the shared primitives (page shell, card, badge, nav chrome) in the chosen identity. No feature page re-skinned.
4. **13.5 rollout** — re-implement every screen on those primitives. This is where consistency and the mobile-app feel actually land.
5. **13.6 skill-fixes** — retrofit `create-prd`/`create-plan` so a future plan mandates a design-system-first step + per-step reuse check (learn-then-retrofit, after living the redesign).

Deployment (14.4) depends on 13.5 so it ships the finished design. Prototype code is throwaway; the durable artifacts are `PROTOTYPE-NOTES-ci.md` and `PROTOTYPE-NOTES-ux.md`.

**Considered options**:
- *Refactor-for-consistency step at the end* — rejected: builds components before the design that defines them; guaranteed rework.
- *One combined redesign step* — rejected: too large to validate incrementally; conflates the CI decision, the UX decision, and the rollout.
- *UX-first, CI later* — rejected: layout variants would render in placeholder styling, and "ignore the colours" feedback is noisy. CI-first lets 13.3 be judged on structure alone.
- *Fix the skills up front* — rejected: would encode an unvalidated convention; 13.6 codifies what actually worked.

**Consequence**: The redesign is five tracked steps instead of one, with a clear decision→build boundary and no speculative component extraction. The cost is more plan ceremony and two prototype phases before any production code changes. The "refactor for consistency" work is reframed as 13.4 + 13.5 (implementation of a decided design), not an end-of-plan cleanup. The skill fix (13.6) makes the design-system-first convention the default for future features, so this inconsistency should not recur. A future reader asking "why is the redesign five steps / why CI before UX?" finds the answer here.

---

## ADR-009: WhatsApp results via the Web Share API (tap-to-share), not the Business API or a bridge

**Date**: 2026-06-07
**Status**: accepted

**Context**: Testing feedback asked for session results to land in the club's **WhatsApp group** cheaply, ideally automatically. The research ([`RESEARCH-whatsapp-notifications.md`](RESEARCH-whatsapp-notifications.md)) found no cheap *automated* post-to-group path exists: the official Cloud API sends 1:1 template messages and cannot post to a normal group (the 2025 Groups API caps at 8 participants and needs a Business account + provider); `wa.me` pre-fill is 1:1 only; and unofficial bridges (whatsapp-web.js, Baileys, …) are a flagrant ToS violation that gets the account banned in ~2–8 weeks. The only zero-cost, zero-infra, ToS-clean way to reach a group is to have the human post it.

**Decision**: After a successful **new** session submit, show a success screen ("Session logged ✓" + "View ladder"). On a **touch-primary device** that supports the Web Share API — `navigator.share` is a function **and** `matchMedia("(pointer: coarse)")` matches — the screen also shows a **Share to WhatsApp** button that calls `navigator.share({ text })` with a plain-text summary (date, each player + games won, public ladder link); the OS share sheet then lets the scorer pick the club group. On desktop (fine pointer) the Share button is hidden, because the desktop share sheet offers Mail/Messages and can't usefully reach the WhatsApp group — the confirmation + "View ladder" still show. The ladder URL is passed into the form from the server page (reusing `AUTH_URL`); the share text is built by a pure helper (`lib/share.ts`). The edit flow is unchanged (it redirects to `/`). No WhatsApp Business account, BSP, per-message fee, credentials, or new infrastructure.

**Consequence**: On a phone, results reach the group with one tap and the message is pre-written — but the post is **not fully automatic** (the scorer picks the group in the share sheet, the only ToS-clean option). On desktop it's just a confirmation. Cost and infra are R0. The `pointer: coarse` gate is a heuristic, not a WhatsApp check — it hides Share where the sheet is least useful. If WhatsApp ever ships a usable group-broadcast API for normal groups, revisit. Rationale and the rejected directions live in the research doc.

(The first cut of step 16.4 wrongly assumed desktop browsers lack `navigator.share`; they don't — corrected same day with the coarse-pointer gate and a re-entrancy guard on the share call.)

---

## ADR-010: Scorers may manage Players & Sessions and view Settings; only Users and Settings-edit stay ADMIN-only

**Date**: 2026-06-07
**Status**: accepted (widens the ADMIN-only `/admin/*` gate of step 04)

**Context**: Originally every `/admin/*` route was ADMIN-only (`authorizeRoute` gated the whole prefix; the hamburger showed only to admins). In practice the club's scorers do the day-to-day data entry — adding players and logging sessions — so funnelling all of that through a single admin was friction. The ask: let scorers manage Players & Sessions and *see* the rating Settings, while keeping the genuinely sensitive surfaces admin-only.

**Decision**:
1. **Route gate** (`authorizeRoute`): `/admin/players`, `/admin/sessions`, `/admin/settings` are open to any signed-in user; only `/admin/users` (login accounts + roles) stays ADMIN-only. A new `isAdminOnly()` replaces the blanket `/admin` check.
2. **Menu** (`adminLinksFor(role)`): scorers see Players / Sessions / Settings in the hamburger; admins also see Users. The hamburger now shows for any signed-in user.
3. **Players actions**: `requireAdmin` → `requireUser` (any session) — scorers can add/rename/deactivate players.
4. **Sessions**: unchanged ownership rule — `canMutateSession` still lets a scorer edit/delete only their **own** sessions (others → `/unauthorised`). Scorers see the full list but can't alter another scorer's results.
5. **Settings**: read-only by default for everyone. An ADMIN gets an **Edit** button that reveals the inputs + Save; scorers never see Edit. The save action (`saveAndRecalculateAction`) still re-checks `role === "ADMIN"` — the Edit button is UI gating, the server is the real gate.

**Consequence**: Scorers can do the routine data entry without an admin; account/role management and rating-parameter changes remain admin-only, defended at the server action (not just the UI). The route gate and the menu are kept in sync deliberately (`isAdminOnly` ↔ `adminLinksFor`). A future reader asking "why can a scorer open /admin/players?" finds it here. If the club later wants scorers to edit any session (not just their own), revisit point 4 (`canMutateSession`).

> Note: there are two ADRs numbered **008** above (Fly hosting, and redesign sequencing). Pre-existing — left as-is rather than renumber an append-only log. Rungs ADRs continue from 010, i.e. start at **011**.

---

## ADR-011: League is the single tenant; the app becomes multi-tenant ("Rungs")

**Date**: 2026-06-09
**Status**: accepted (built — Rungs plan steps 18–24)

**Context**: The app is being generalised from the single BSC doubles-squash ladder into **Rungs**, a multi-tenant product that hosts many independent ladders. The grill weighed multi-deploy (one app per club) vs multi-tenant (one app, many leagues) and chose multi-tenant — the data-isolation cost is comparable, but multi-tenant gives per-league URLs, shared ops, and one deploy. A Club/Org hierarchy was considered and rejected as speculative.

**Decision**: **League is the single, flat tenant boundary.** Every domain row carries `leagueId`: `Player`, `Session`, `Setting`, `RatingsLog`, `LadderSnapshot`. A Player belongs to exactly one League (no cross-league player identity — ratings are inherently per-ladder). No Club/Org layer. The rating engine is unchanged: it already takes a session as a flat `{ playerId, wins }[]` and rates individuals, so it is format-agnostic and needs no rewrite.

**Consequence**: Every query becomes league-scoped; ADR-001's full-recalc becomes **per-league** recalc; ADR-002's request-time aggregation scopes to one league. The "same person in two leagues" need is *not* solved by the data model — it is deferred to a future Follow feature (see ADR-013 out-of-scope). Migrating existing BSC data is ADR-015. Revisit the flat model only if a real customer needs a shared cross-league roster (a Club layer).


---

## ADR-012: Staff-only authentication with an admin-managed allowlist; global admin + per-league scorer grants

**Date**: 2026-06-09
**Status**: accepted (built — Rungs plan steps 18–24)

**Context**: With many leagues, the single global `User.role` (ADR-004/010) no longer fits — a scorer for league A should have no power over league B. The grill also established that the *only* reason to log in is to be staff (the Follow feature, which would have given players a reason to sign in, is out of scope for v1).

**Decision**:
1. **`User` table = staff only.** A global **ADMIN** can see/administer all leagues, create leagues, assign scorers, and score in any league. A **SCORER** has no power on its own — authority comes entirely from per-league grants in a new **`LeagueScorer(userId, leagueId)`** table.
2. **Login is staff-only**, gated by the existing admin-managed allowlist (ADR-006's mechanism, retained): a Google account can sign in as staff only if an admin has created its `User` row. Assigning a scorer *is* the act of adding them to the allowlist.
3. **Session ownership is unchanged** (ADR-010 pt 4): a scorer edits/deletes only their own sessions, now within their granted league; the global admin edits any.
4. A non-staff Google sign-in lands on a dead-end "scorers/admins only" page (see ADR-014).

**Consequence**: Per-league authority replaces the global role; the `User` table stays free of junk rows from curious sign-ins (the door Follow would have opened stays shut). Earlier musing about "anyone can sign in, authz by membership" is **withdrawn** — it only made sense with Followers. Revisit if Follow (and player logins) come into scope.


---

## ADR-013: Path-prefix routing (`/l/{slug}`); public per-league ladder; single shared PWA identity

**Date**: 2026-06-09
**Status**: accepted (routing + Rungs PWA identity built — steps 21, 24; domain/infra rename to rungs.co.za pending step 25)

**Context**: "Each league its own URL." Options were path-prefix, subdomain (wildcard DNS + cert), or custom domain per league (per-tenant cert). The PWA also has *one* manifest per origin by default, which collides with per-league branding.

**Decision**:
1. **Path-prefix URLs:** `/l/{slug}/...` for each league's ladder/submit/history/admin. One domain, one cert (no wildcard DNS). The per-league public ladder (`/l/{slug}`) stays **publicly viewable without login**, preserving today's public-ladder property. `/` becomes a signed-out landing / staff entry.
2. **Slug:** suggested by slugifying the league name, editable at creation, unique, **immutable after creation** (changing it breaks shared/bookmarked ladder links — ADR-009's share text embeds the URL).
3. **Single shared PWA identity** ("Rungs", neutral icon/palette) for v1 — installing from any league page gives the same app; the league is content within it.

**Consequence**: Lowest infra; shareable public ladders preserved. **Out of scope (v2+):** subdomains, custom domains, per-league branding/logos/manifests, and slug rename/redirects. Revisit subdomains/custom domains if a paying club wants its own identity on the home screen.


---

## ADR-014: In-app access requests, no email infrastructure (extends ADR-009's no-outbound-messaging stance)

**Date**: 2026-06-09
**Status**: accepted (built — Rungs plan steps 18–24)

**Context**: A non-staff Google user who signs in needs a way to ask to become a scorer. The instinct ("email all admins") would drag a transactional email provider (sender domain, API key, new failure mode) into a project that has *deliberately* avoided outbound messaging — ADR-009 chose the Web Share API precisely to avoid send infrastructure.

**Decision**: The "scorers/admins only" page shows a **Request scorer access** button that writes an in-app **`AccessRequest(email, name, leagueId, status, createdAt)`** row; the requester picks which league (public ladders are browseable). A global admin reviews pending requests on an admin page and **approves** (→ creates the `User` + the `LeagueScorer` grant) or **dismisses**. **No email in v1.** Notification is "the already-logged-in admin sees the queue."

**Consequence**: Satisfies the access-request need with zero new infra, consistent with ADR-009. Email/push notification of new requests is a clean, well-fenced **v2** add-on (its own "notifications" increment, which might also revisit WhatsApp). The `mailto:` alternative was rejected (leaks admin emails, depends on a configured mail client).


---

## ADR-015: Adopt existing BSC data into a seed league on migration

**Date**: 2026-06-09
**Status**: accepted (built — Rungs plan steps 18–24)

**Context**: There is live production data (the BSC ladder). The multi-tenant migration adds `leagueId` to every domain table (ADR-011); existing rows must be adopted into a league, not orphaned.

**Decision**: The migration **creates a default "BSC Doubles Squash" league** and back-fills `leagueId` on all existing rows (`Player`, `Session`, `Setting`, `RatingsLog`, `LadderSnapshot`), seeds that league's settings from the current global `Setting` values, assigns it a slug (`bsc-doubles-squash`), and attaches the current admin + scorers as its members (`LeagueScorer` grants; the admin stays global ADMIN). Per-league settings are split off from the current single global `Setting` table at this point.

**Consequence**: No data loss; the BSC ladder becomes "just another league" with continuity of ratings and history. This is the riskiest single migration in the Rungs plan (touches every table + prod data) and warrants its own plan step with a verified backup taken first (ties to step-17 backup verification). Revisit nothing — this is a one-time adoption.

---

## ADR-016: Share from session history (extends ADR-009)

**Date**: 2026-07-03
**Status**: accepted (built — Rungs plan step 28)

**Context**: ADR-009 limited the Share to WhatsApp button to the post-submit success screen. In practice scorers sometimes forget to share at submit time and remember later, and anyone viewing the public ladder may want to share a past result. The session history page (`/l/{slug}/sessions`) is already public and lists each session's roster + wins per card.

**Decision**: Add a Share to WhatsApp button on each session history card via a new client `ShareButton` component. Same Web Share API, same `pointer: coarse` + `navigator.share` gate as the form's success screen (hidden on desktop), same `buildShareText` pure helper. The server component page passes the roster (mapped to `ShareRosterEntry[]`) + `ladderUrlForSlug(slug)` as props. Public/ungated — the ladder is already public, no auth needed. Does not change the edit flow (ADR-009's "edit flow is unchanged" stands).

**Consequence**: Share is available from two surfaces (post-submit success screen + session history). Zero new infra, consistent with ADR-009. The `ShareButton` is reusable; the form's success screen keeps its own inline share button (it shares the in-memory just-submitted roster, not a persisted one) rather than refactoring to the shared component — the two surfaces have different data lifecycles.



---

## ADR-017: Timer is a tool inside the Rungs app, not a separate PWA

**Date**: 2026-08-21
**Status**: accepted (built - Rungs plan step 30)

**Context**: A poolside swimming stopwatch was wanted, initially framed as its own PWA at `watch.rungs.co.za`. It shares nothing with the ladder domain: no data, no auth, no server work at all - the whole run is archived by taking a phone screenshot. Rungs is a personal project on a single always-on Fly machine, so avoiding new infrastructure and a second deploy pipeline was an explicit goal.

**Decision**: Ship it as a public top-level route `/timer` in the existing app. `isPublicRoute` in `lib/auth-rules.ts` lets it past the proxy so an expired session never bounces it to OAuth mid-swim; a new `toolLinks()` group in `lib/nav.ts`, appended in `AdminMenu` for any role, surfaces it in the header hamburger for signed-in staff. Pure logic lives in `lib/timer.ts` over absolute wall-clock timestamps; `components/stopwatch.tsx` owns only `requestAnimationFrame`, the Screen Wake Lock, and `localStorage`. No new origin, no second manifest, no new infrastructure.

**Rejected**:
- **Separate repo + Fly app.** Genuinely isolated (Rungs changes could never break it) and near-free on Fly with `auto_stop_machines`, but it buys two deploy pipelines, two Dockerfiles, and two Next/Node upgrades forever for a weekend tool - the expensive kind of cheap.
- **`watch.rungs.co.za` on the same Fly app.** Adds host-rewriting in `proxy.ts`, two cross-host redirect edges, a DNS record and a cert, while removing no coupling at all: same build, same `/sw.js`, same deploy, same `node_modules`. The routing complexity of a separate app with none of the isolation that would justify it.
- **A per-scope `manifest-timer.json`** for a distinct home-screen icon on the same origin. Viable on Android, unverified on iOS, and it requires lifting `SiteHeader`, `BottomNavBar` and `auth()` out of `app/layout.tsx` into an `app/(main)/` route group first.

**Consequence**: There is no separate home-screen icon - the Timer is reached by opening Rungs. This extends rather than contradicts ADR-013's single shared PWA identity. Two things are knowingly accepted: past ten laps the list scrolls, so a screenshot loses the top rows; and a first-ever offline hit on `/timer` falls back to `/~offline`, since App Router pages are not in the Serwist precache manifest (after one online visit `defaultCache` covers it). The per-scope manifest remains a cheap future upgrade if the extra tap becomes annoying, and the subdomain is cheap on top of that. One incidental fix: appending tools means the hamburger is never empty for a staff user, where previously a SCORER off a league route got no menu at all.
