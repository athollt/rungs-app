# Step 28: Share from session history + draft autosave

## Objective

Add a Share to WhatsApp button on each session history card (public, ungated — anyone can share) and autosave in-progress session form entries to localStorage so courtside scorers don't lose data if the app closes mid-capture.

## Context

- Read first: `CHANGELOG.md` (step 16.4 share screen), `DECISIONS.md` (ADR-009 Web Share API), `CONTEXT-rungs.md`
- ADR-009 established the Web Share API approach with a `pointer: coarse` gate (touch devices only — desktop share sheet can't reach a WhatsApp group). This step extends that to a new surface — a new ADR-016 records the extension.
- `buildShareText` in `lib/share.ts` builds the share text from `{ roster, ladderUrl, notes }` — pure, already unit-tested, no change needed
- `ladderUrlForSlug` in `lib/share.ts` builds the public ladder URL from `AUTH_URL` + slug
- `ShareRosterEntry` type in `lib/share.ts` is `{ name: string; wins: number }`
- Session history page (`app/l/[slug]/sessions/page.tsx`) is public (no auth), lists sessions with player names + wins per card. Each card already has a "More details →" link.
- `SessionForm` in `components/session-form.tsx` is the courtside entry form. Submit mode: `ladderUrl` set, `initialSlots` absent. Edit mode: `initialSlots` set, `ladderUrl` absent. The form already has a share success screen (submit mode only, driven by `ladderUrl`).
- The form receives `ladderHref` (`/l/${slug}`) but not the slug directly — the autosave key needs the slug

### The two features

1. **Share from session history**: a client `ShareButton` component on each card. The page is a server component — it passes the roster + ladderUrl as props to the client ShareButton. Same `pointer: coarse` + `navigator.share` gate as the form's success screen. Public/ungated: the ladder is already public, anyone can share.

2. **Draft autosave**: `SessionForm` (submit mode only) autosaves entries + notes to `localStorage` keyed by `rungs-draft-{slug}`. Restores on mount. Clears on successful submit. Edit mode does not autosave (it loads from the DB, not a draft).

## Specification

### 1. Create `ShareButton` client component

Create `components/share-button.tsx`:
- `"use client"` — uses `navigator.share`
- Props: `{ roster: ShareRosterEntry[]; ladderUrl: string; notes?: string }`
- Builds share text via `buildShareText` (same pure helper as the form)
- Same `canShare` gate as `SessionForm`: `typeof navigator.share === "function"` + `window.matchMedia("(pointer: coarse)").matches` — hidden on desktop
- Same re-entrancy guard as the form's `handleShare` (`sharing` ref)
- Renders a "Share" button; on tap calls `navigator.share({ text })`

### 2. Add ShareButton to session history cards

`app/l/[slug]/sessions/page.tsx`:
- Import `ShareButton` and `ladderUrlForSlug`
- Each card already has `sessionPlayers` (name + wins) — map to `ShareRosterEntry[]`
- Pass `roster`, `ladderUrl={ladderUrlForSlug(slug)}` to `ShareButton`
- Place the ShareButton next to or below the "More details →" link
- The page is already `force-dynamic` and public — no auth changes

### 3. Draft autosave in `SessionForm`

`components/session-form.tsx` (submit mode only — when `ladderUrl` is set and `initialSlots` is absent):
- Add a `slug` prop (needed for the localStorage key). The submit page passes it.
- On every `entries` or `notes` change, serialize to `localStorage` under `rungs-draft-{slug}`. Use `useEffect` watching `entries` + `notes`. Guard for SSR (`typeof window !== "undefined"`).
- On mount, if `localStorage` has `rungs-draft-{slug}` and no `initialSlots`, restore entries + notes from it. This replaces the empty initial state.
- On successful submit (the `setShareText` path), clear `rungs-draft-{slug}` from `localStorage`.
- Edit mode (`initialSlots` present): no autosave, no restore — the form loads from the DB.

### 4. Pass `slug` from submit page

`app/l/[slug]/submit/page.tsx`:
- Pass `slug={slug}` to `SessionForm`

### 5. ADR-016

Append to `DECISIONS.md`:
- **ADR-016: Share from session history (extends ADR-009)**
- Context: ADR-009 limited share to the post-submit success screen. Scorers sometimes forget to share and remember later; anyone viewing the ladder may want to share a result.
- Decision: Add a Share to WhatsApp button on each session history card. Same Web Share API, same `pointer: coarse` gate, same `buildShareText` pure helper. Public/ungated — the ladder is already public, no auth needed. Does not change the edit flow (ADR-009's "edit flow is unchanged" stands).
- Consequence: Share is available from two surfaces (post-submit success screen + session history). Zero new infra, consistent with ADR-009.

**Behaviours to verify (TDD order):**
1. `ShareButton` renders on touch device (coarse pointer), hidden on desktop (fine pointer) — component test or E2E with viewport emulation
2. `ShareButton` builds correct share text from roster + ladderUrl (delegates to `buildShareText` — existing test covers the pure helper)
3. `SessionForm` submit mode autosaves entries + notes to localStorage on change
4. `SessionForm` submit mode restores entries + notes from localStorage on mount
5. `SessionForm` clears localStorage on successful submit
6. `SessionForm` edit mode does NOT autosave (no localStorage writes when `initialSlots` present)

## Validation

```bash
npm run build && npm run test
```

This step adds UI to the existing session history route + alters the submit form — extend Playwright journeys:

```bash
npm run test:e2e
```

E2E covers: session history card shows Share button (touch viewport), tap triggers share sheet; submit form preserves entries across a page reload (localStorage restore), clears after submit.

## Completion

1. Update `CHANGELOG.md` with what was delivered (share from history, draft autosave, ADR-016)
2. Mark step 28 complete in `RUNGS-PLAN.md`
3. Commit `step-28: share from session history + draft autosave`
4. Push `at-wip`
