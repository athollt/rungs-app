# Step 30a: Timer entry time

## Objective

Capture an **entry time** (the seed time a swimmer is entered with for a race) and show it to the right of the timestamp under the title, in the same `mm:ss.hh` format as the main readout, so both land in the screenshot.

## Context

- Read first: `DECISIONS.md` (ADR-017), `steps/step-30-timer.md`, and the step 30.1-30.4 entries in `CHANGELOG.md`.
- Naming note: the earlier timer increments are logged as **30.1-30.4**; this one is **30a** as requested. Mixed, but recorded here so the sequence is not confusing later.
- The subtitle slot in `PageShell` currently takes the plain `clockLine` string. It becomes a node with the timestamp on the left and the entry field on the right.
- `formatDuration` is for elapsed durations and always pads to `mm:ss.hh`. Entry time needs its own formatter because it is *typed*, and a half-typed value has to render sensibly.

### Why digit entry

Typing `:` and `.` means the full keyboard on a phone. Entry is bare digits filling from the right, the way a stopwatch or a microwave takes input, with `inputMode="numeric"` for a keypad: `3045` is `30.45`, `13045` is `1:30.45`.

The subtlety is that the field *displays* a padded string, so the digits cannot simply be stripped back out of what the input carries — the padding zeros would be re-absorbed as though the user had typed them, and a minutes field would appear from nowhere. The buffer is therefore held as bare digits in state, and each edit is resolved by comparing digit **counts**.

## Specification

### 1. Pure helpers — `lib/timer.ts`

- `normaliseEntryDigits(input)` — strips to digits, keeps the last 6 (`mm:ss.hh`).
- `formatEntryDigits(digits)` — lays them out filling from the right, showing only what has been typed: `""` → `""`, `"4"` → `"00.04"`, `"3045"` → `"30.45"`, `"13045"` → `"1:30.45"`.
- `nextEntryDigits(current, displayed)` — the buffer after one edit. Compares the digit count of the displayed value against the digit count of the current buffer's rendering: a positive delta appends that many characters, a negative delta removes that many. **Sizing the change matters** — clearing the field removes several digits at once, and treating it as a single backspace would leave the field stubbornly almost-full.

No milliseconds conversion: nothing consumes it yet, and AGENTS.md §3 rules out speculative abstractions. It arrives with the first feature that compares against the entry time.

### 2. Component — `components/stopwatch.tsx`

- `entryDigits` state holds the bare digits; the input's value is `formatEntryDigits(entryDigits)`.
- Rendered in the `PageShell` subtitle, right-aligned opposite the timestamp, labelled `Entry`, `aria-label="Entry time"`, placeholder `--.--`, `inputMode="numeric"`.
- Persisted under `rungs-timer-entry`, restored on mount alongside the title. **It survives a Reset**, like the title: it describes the event, not the run, and you time the same race again with the same seed time.

**Behaviours to verify (TDD order):**

1. `normaliseEntryDigits` keeps only digits and caps at six.
2. `formatEntryDigits` fills `mm:ss.hh` from the right, and returns empty for empty.
3. `nextEntryDigits` appends a keystroke without re-absorbing the display padding — typing `11250` gives `00.01`, `00.11`, `01.12`, `11.25`, `1:12.50`, never a spurious minutes field.
4. `nextEntryDigits` drops exactly one digit on a backspace.
5. `nextEntryDigits` clears the buffer when the whole field is emptied.
6. `nextEntryDigits` reaches a full six digits (`12:30.45`).
7. The entry time survives a reload (E2E).

## Validation

```bash
npm run build && npm run test && npm run lint
```

This alters a user-facing route, so per `OVERVIEW.md` the Playwright journey is extended:

```bash
npm run test:e2e
```

## Completion

1. Update `CHANGELOG.md`.
2. Mark step 30a complete in `RUNGS-PLAN.md`.
3. Commit `step-30a: timer entry time`.
4. Push `at-wip` — it lands on the open PR #11.
