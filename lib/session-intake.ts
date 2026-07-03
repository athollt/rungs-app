import { resolvePlayerName, type PlayerRecord } from "@/lib/players";
import { validateSession } from "@/lib/session-validation";
import { runRecalculation, type RecalcStore } from "@/lib/recalc";

// One intake slot: either an existing player id, or a "new" name typed
// on-the-fly (resolved to an existing player case-insensitively, else created).
export interface IntakeSlot {
  playerId?: string;
  newName?: string;
  wins: number;
}

// Persistence port for writing a session's rows. createSession inserts a new
// Session + its SessionPlayers; replaceSession deletes the old SessionPlayers
// and inserts the new set (the edit path). Both are league-scoped (ADR-011).
// replaceSession does not reassign ownership — the original submitter is
// preserved (matching the prior edit action; an editor is not the submitter).
export interface SessionWriteStore {
  createSession(args: {
    leagueId: string;
    submittedById: string;
    players: { playerId: string; wins: number }[];
    notes?: string;
    timestamp: Date;
  }): Promise<{ id: string }>;
  replaceSession(args: {
    sessionId: string;
    leagueId: string;
    players: { playerId: string; wins: number }[];
    notes?: string;
  }): Promise<void>;
}

// The combined port intakeSession needs: player name resolution, session
// writes, and the recalc store (so it can trigger a full per-league recalc,
// ADR-001/011). Extends RecalcStore so it can be handed straight to
// runRecalculation, and carries the two PlayerStore methods resolvePlayerName
// uses.
export interface SessionIntakeStore extends RecalcStore, SessionWriteStore {
  findByNameInsensitive(name: string): Promise<PlayerRecord | null>;
  create(name: string): Promise<PlayerRecord>;
}

export interface SessionIntakeInput {
  leagueId: string;
  submittedById: string;
  slots: IntakeSlot[];
  notes?: string;
  now: Date;
  mode: "create" | "update";
  // Required when mode === "update".
  sessionId?: string;
}

export type IntakeResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

// Unify the submit and edit intake paths behind one pure function (step 27).
// Resolves on-the-fly names via resolvePlayerName (reusing existing players
// case-insensitively — the duplicate-Player fix), validates, persists (create
// or replace), and triggers a full per-league recalc. deleteSession stays
// separate: it neither resolves nor validates.
export async function intakeSession(
  input: SessionIntakeInput,
  store: SessionIntakeStore,
): Promise<IntakeResult> {
  const resolved: { playerId: string; wins: number }[] = [];
  for (const slot of input.slots) {
    if (slot.newName && slot.newName.trim() !== "") {
      const r = await resolvePlayerName(slot.newName, store);
      if (!r.ok) return { ok: false, error: r.error };
      resolved.push({ playerId: r.playerId, wins: slot.wins });
    } else if (slot.playerId) {
      resolved.push({ playerId: slot.playerId, wins: slot.wins });
    }
  }

  const validation = validateSession({ players: resolved });
  if (!validation.ok) return { ok: false, error: validation.error };
  const v = validation.session;

  if (input.mode === "create") {
    const session = await store.createSession({
      leagueId: input.leagueId,
      submittedById: input.submittedById,
      players: v.players,
      notes: input.notes,
      timestamp: input.now,
    });
    await runRecalculation(store, input.now, input.leagueId);
    return { ok: true, sessionId: session.id };
  }

  if (!input.sessionId) {
    return { ok: false, error: "Session id is required for update." };
  }
  await store.replaceSession({
    sessionId: input.sessionId,
    leagueId: input.leagueId,
    players: v.players,
    notes: input.notes,
  });
  await runRecalculation(store, input.now, input.leagueId);
  return { ok: true, sessionId: input.sessionId };
}
