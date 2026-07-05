"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { buildShareText } from "@/lib/share";

export type Player = { id: string; name: string };

export interface FormSlot {
  playerId?: string;
  newName?: string;
  wins: number;
}

export type SessionFormResult = { ok: true } | { ok: false; error: string };

const NEW = "__new__";

// Persisted shape the edit page passes in (one per existing session player).
interface SlotState {
  playerId: string; // player id, "" (none), or NEW
  newName: string;
  wins: string;
}

// In-form entry: one selected player (existing or new), with a stable key so
// removing one doesn't reshuffle the others' React state.
interface Entry {
  key: number;
  playerId: string; // a real player id, or NEW for an on-the-fly player
  newName: string;
  wins: string;
}

interface Props {
  players: Player[];
  // Pre-populated slots/notes for edit; submit starts with nothing selected.
  initialSlots?: SlotState[];
  initialNotes?: string;
  submitLabel: string;
  onSubmit: (slots: FormSlot[], notes: string) => Promise<SessionFormResult>;
  // Optional delete (edit mode). Receives nothing; parent binds the id.
  onDelete?: () => Promise<SessionFormResult>;
  // Submit mode only: the public ladder URL. When present (and the device
  // supports the Web Share API), a successful submit shows a share screen instead
  // of redirecting (step 16.4). Edit mode omits it, so it always redirects.
  ladderUrl?: string;
  // Where to go after a successful submit/delete (the league's ladder). Defaults
  // to "/" for callers that don't set it (e.g. edit pages bind their own).
  ladderHref?: string;
  // Submit mode only: the league slug, used as the localStorage draft key so a
  // courtside scorer's in-progress entries survive an app close mid-capture.
  // Edit mode omits it (the form loads from the DB, not a draft).
  slug?: string;
}

// Draft autosave (step 28): submit-mode entries + notes are persisted to
// localStorage under `rungs-draft-{slug}` so a courtside scorer doesn't lose
// data if the app closes mid-capture. Restored on mount, cleared on submit.
// Edit mode never reads or writes a draft (it loads from the DB).
interface Draft {
  entries: Entry[];
  notes: string;
}

function draftKey(slug: string): string {
  return `rungs-draft-${slug}`;
}

function readDraft(slug: string): Draft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft(slug: string, draft: Draft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(slug), JSON.stringify(draft));
  } catch {
    // Quota / privacy mode — autosave is best-effort; swallow.
  }
}

function clearDraft(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(slug));
  } catch {
    // Swallow — best-effort.
  }
}

// Courtside doubles capture (step 16.2, rev. single-grid): one "Choose players"
// grid where the scorer taps to select/unselect any number of players (+ "+ New"
// for on-the-fly creation). Each selected player gets a score block below, in
// selection order, with a segmented 0–9 "wins" selector. A flat list, no teams
// (the engine infers pairings). The public contract (props + FormSlot payload) is
// unchanged, so both /submit and the edit page reuse it; edit (initialSlots) opens
// with those players pre-selected.
export function SessionForm({
  players,
  initialSlots,
  initialNotes = "",
  submitLabel,
  onSubmit,
  onDelete,
  ladderUrl,
  ladderHref = "/",
  slug,
}: Props) {
  const router = useRouter();
  // Submit mode = no initialSlots. State initializers match the server render
  // (empty in submit mode) to avoid a hydration mismatch — localStorage is
  // only available on the client, so the draft is restored in a mount effect
  // below, not in the initializers. Edit mode pre-populates from the DB.
  const [entries, setEntries] = useState<Entry[]>(() =>
    initialSlots
      ? initialSlots.map((s, i) => ({
          key: i,
          playerId: s.playerId,
          newName: s.newName,
          wins: s.wins,
        }))
      : [],
  );
  // Monotonic key source for entries added after mount; seeded past the initial
  // entries' indices. The draft-restore effect bumps this past the restored
  // max key. Only touched in event handlers/effects, never during render.
  const keySeq = useRef(initialSlots ? initialSlots.length : 0);
  const nextKey = () => keySeq.current++;
  const [notes, setNotes] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Inline "+ New" chip: when adding, the chip becomes a text field. Holds the
  // typed name and any validation error shown under the chip row.
  const [adding, setAdding] = useState(false);
  const [newChipName, setNewChipName] = useState("");
  const [newChipError, setNewChipError] = useState<string | null>(null);
  // Set on a successful submit (submit mode only) — drives the success screen
  // (step 16.4). Null = stay on the form.
  const [shareText, setShareText] = useState<string | null>(null);
  // Guards against a second navigator.share() call while one is still pending
  // (the API throws InvalidStateError otherwise).
  const sharing = useRef(false);
  // Skips the autosave on the very first mount so it doesn't overwrite the
  // saved draft with empty entries before the restore effect (below) reads it.
  const autosaveSkip = useRef(true);

  // Autosave (submit mode only): persist entries + notes to localStorage on every
  // change so a courtside scorer doesn't lose data if the app closes mid-capture.
  // Edit mode (initialSlots present) loads from the DB and never writes a draft.
  // The first mount run is skipped (autosaveSkip) to let the restore effect read
  // the existing draft first; subsequent changes persist normally.
  useEffect(() => {
    if (initialSlots || !slug) return;
    if (autosaveSkip.current) {
      autosaveSkip.current = false;
      return;
    }
    writeDraft(slug, { entries, notes });
  }, [entries, notes, initialSlots, slug]);

  // Draft restore (submit mode only, once on mount): read the saved draft from
  // localStorage and apply it. This runs after hydration so the server-rendered
  // HTML (empty form) matches the first client render - no hydration mismatch.
  // The autosave effect above then keeps the draft in sync from here on.
  useEffect(() => {
    if (initialSlots || !slug) return;
    const draft = readDraft(slug);
    if (!draft) return;
    setEntries(draft.entries);
    setNotes(draft.notes);
    keySeq.current =
      draft.entries.length > 0
        ? Math.max(...draft.entries.map((e) => e.key)) + 1
        : 0;
    // Run once on mount only - reading the draft again on every entries/notes
    // change would clobber the user's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedIds = new Set(
    entries.filter((e) => e.playerId !== NEW).map((e) => e.playerId),
  );

  function togglePlayer(id: string) {
    setEntries((es) =>
      selectedIds.has(id)
        ? es.filter((e) => e.playerId !== id)
        : [...es, { key: nextKey(), playerId: id, newName: "", wins: "0" }],
    );
  }

  // Confirm the inline "+ New" chip: add a named on-the-fly entry, unless the
  // name is blank or already on the list (an existing roster player or another
  // new entry). Reuses the NEW/newName payload — the player is created at submit.
  function confirmNewChip() {
    const trimmed = newChipName.trim();
    if (trimmed === "") {
      setAdding(false);
      setNewChipName("");
      setNewChipError(null);
      return;
    }
    const lower = trimmed.toLowerCase();
    const onRoster = players.some((p) => p.name.toLowerCase() === lower);
    const alreadyNew = entries.some(
      (e) => e.playerId === NEW && e.newName.trim().toLowerCase() === lower,
    );
    if (onRoster || alreadyNew) {
      setNewChipError(`${trimmed} is already on the list.`);
      return;
    }
    setEntries((es) => [
      ...es,
      { key: nextKey(), playerId: NEW, newName: trimmed, wins: "0" },
    ]);
    setNewChipName("");
    setNewChipError(null);
    setAdding(false);
  }

  function cancelNewChip() {
    setAdding(false);
    setNewChipName("");
    setNewChipError(null);
  }

  function patch(key: number, p: Partial<Entry>) {
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...p } : e)));
  }

  function remove(key: number) {
    setEntries((es) => es.filter((e) => e.key !== key));
  }

  function toPayload(): FormSlot[] {
    return entries
      .filter((e) => e.playerId !== NEW || e.newName.trim() !== "")
      .map((e) => ({
        playerId: e.playerId === NEW ? undefined : e.playerId,
        newName: e.playerId === NEW ? e.newName : undefined,
        wins: Number(e.wins),
      }));
  }

  // Display roster (name + wins) for the share text, from current entries.
  function shareRoster() {
    return toPayload().map((e) => ({
      name:
        e.playerId === undefined
          ? (e.newName ?? "")
          : (players.find((p) => p.id === e.playerId)?.name ?? ""),
      wins: e.wins,
    }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(toPayload(), notes);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Submit mode (ladderUrl set) → show the success screen; edit mode → redirect.
      if (ladderUrl != null) {
        setShareText(
          buildShareText({ roster: shareRoster(), ladderUrl, notes }),
        );
        if (slug) clearDraft(slug);
      } else {
        router.push(ladderHref);
      }
    });
  }

  function handleDelete() {
    if (!onDelete) return;
    setError(null);
    startTransition(async () => {
      const result = await onDelete();
      if (result.ok) router.push(ladderHref);
      else setError(result.error);
    });
  }

  function handleShare() {
    if (!shareText || sharing.current) return;
    sharing.current = true;
    // The share sheet resolves on send and rejects on cancel — both just end the
    // in-flight share. Swallow the rejection so a cancel isn't an unhandled error.
    Promise.resolve(navigator.share({ text: shareText }))
      .catch(() => {})
      .finally(() => {
        sharing.current = false;
      });
  }

  // Success screen (step 16.4) — shown after a successful submit, in place of the
  // form. The Share button only appears on a touch-primary device with the Web
  // Share API (a desktop share sheet can't reach the WhatsApp group); elsewhere
  // the confirmation + "View ladder" still show. Computed here (client render
  // only, never SSR) so it reflects the real device.
  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true;

  if (shareText !== null) {
    return (
      <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-4">
        <p className="font-heading text-lg font-bold">Session logged ✓</p>
        {canShare && (
          <>
            <p className="text-muted-foreground text-sm">
              Share the result to the club WhatsApp group.
            </p>
            <Button type="button" onClick={handleShare}>
              Share to WhatsApp
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(ladderHref)}
        >
          View ladder →
        </Button>
      </div>
    );
  }

  // Stable 1-based ordinal for each on-the-fly entry, by creation order — so an
  // unnamed new block is labelled "New player N" regardless of how many others
  // are named. (Naming a block just swaps the label to the typed name.)
  const newOrdinal = new Map<number, number>();
  let n = 0;
  for (const e of entries) {
    if (e.playerId === NEW) newOrdinal.set(e.key, ++n);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Choose players"
        className="bg-card border-border flex flex-col gap-2 rounded-xl border p-3"
      >
        <p className="text-muted-foreground text-xs">Choose players</p>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={selectedIds.has(p.id)}
              className={cn(
                "border-border rounded-full border px-3 py-2 text-sm font-medium",
                selectedIds.has(p.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-background",
              )}
              onClick={() => togglePlayer(p.id)}
            >
              {p.name}
            </button>
          ))}
          {/* On-the-fly players appear here as selected chips too (they aren't on
              the saved roster yet). Tapping one removes it — an unsaved player only
              exists while selected. */}
          {entries
            .filter((e) => e.playerId === NEW)
            .map((e) => (
              <button
                key={e.key}
                type="button"
                aria-pressed={true}
                className="border-primary bg-primary/10 text-primary rounded-full border px-3 py-2 text-sm font-medium"
                onClick={() => remove(e.key)}
              >
                {e.newName}
              </button>
            ))}
          {adding ? (
            <span className="border-primary inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-3">
              <input
                aria-label="New player name"
                autoFocus
                value={newChipName}
                onChange={(ev) => {
                  setNewChipName(ev.target.value);
                  setNewChipError(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    confirmNewChip();
                  } else if (ev.key === "Escape") {
                    cancelNewChip();
                  }
                }}
                // Tapping outside the chip cancels. The ✓ uses onPointerDown so it
                // confirms before this blur fires (blur would otherwise cancel first).
                onBlur={cancelNewChip}
                className="w-28 bg-transparent text-sm font-medium outline-none"
                placeholder="Name"
              />
              <button
                type="button"
                aria-label="Add player"
                className="border-primary text-primary flex h-8 w-8 items-center justify-center rounded-full border text-base font-bold"
                onPointerDown={(ev) => {
                  ev.preventDefault();
                  confirmNewChip();
                }}
              >
                ✓
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="border-primary text-primary rounded-full border border-dashed px-3 py-2 text-sm font-medium"
              onClick={() => {
                setAdding(true);
                setNewChipError(null);
              }}
            >
              + New
            </button>
          )}
        </div>
        {newChipError && (
          <p className="text-destructive text-sm">{newChipError}</p>
        )}
      </div>

      {entries.map((e) => {
        const name =
          e.playerId === NEW
            ? e.newName.trim() || `New player ${newOrdinal.get(e.key)}`
            : (players.find((p) => p.id === e.playerId)?.name ?? "Player");
        return (
          <ScoreBlock
            key={e.key}
            name={name}
            entry={e}
            onChange={(p) => patch(e.key, p)}
            onRemove={() => remove(e.key)}
          />
        );
      })}

      <Textarea
        aria-label="Notes"
        placeholder="Notes (optional)"
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={pending} className="flex-1">
          {submitLabel}
        </Button>
        {onDelete && (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function ScoreBlock({
  name,
  entry,
  onChange,
  onRemove,
}: {
  name: string;
  entry: Entry;
  onChange: (p: Partial<Entry>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={name}
      className="bg-card border-border flex flex-col gap-3 rounded-xl border p-3"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 font-medium">{name}</span>
        <button
          type="button"
          className="text-muted-foreground text-sm font-bold"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          remove
        </button>
      </div>

      <div>
        <p className="text-muted-foreground mb-1.5 text-xs">wins</p>
        {/* 0–9 as two rows of five, large thumb targets for courtside entry. */}
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
            <button
              key={g}
              type="button"
              aria-label={`${g} wins`}
              aria-pressed={Number(entry.wins) === g}
              className={cn(
                "border-border font-heading h-12 rounded-lg border text-lg font-bold tabular-nums",
                Number(entry.wins) === g
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
              )}
              onClick={() => onChange({ wins: String(g) })}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
