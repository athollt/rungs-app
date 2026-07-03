import { describe, it, expect } from "vitest";
import { intakeSession, type SessionIntakeStore } from "@/lib/session-intake";
import type { PlayerRecord } from "@/lib/players";

// A fake SessionIntakeStore that records every call so the tests can assert
// what was persisted and whether recalc ran — no Prisma, no DB. The recordings
// live on a shared object so the returned store reads them live (the methods
// mutate the same references).
function makeStore(over: Partial<SessionIntakeStore> & {
  existingPlayers?: Record<string, PlayerRecord>;
} = {}): SessionIntakeStore & {
  createdPlayers: string[];
  createdSession: unknown | null;
  replacedSession: unknown | null;
  recalcRan: boolean;
} {
  const existingPlayers = over.existingPlayers ?? {};
  const rec = {
    createdPlayers: [] as string[],
    createdSession: null as unknown | null,
    replacedSession: null as unknown | null,
    recalcRan: false,
  };
  const store: SessionIntakeStore = {
    findByNameInsensitive: async (name) =>
      existingPlayers[name.toLowerCase()] ?? null,
    create: async (name) => {
      rec.createdPlayers.push(name);
      const record: PlayerRecord = { id: `new-${name}`, name, status: "ACTIVE" };
      existingPlayers[name.toLowerCase()] = record;
      return record;
    },
    createSession: async (args) => {
      rec.createdSession = args;
      return { id: "session-1" };
    },
    replaceSession: async (args) => {
      rec.replacedSession = args;
    },
    loadSettings: async () => ({ StartingRating: 1000, KFactor: 160 }),
    loadPlayers: async () => [],
    loadSessions: async () => [],
    replaceRatingsLog: async () => {
      rec.recalcRan = true;
    },
    createLadderSnapshot: async () => {
      rec.recalcRan = true;
    },
    ...over,
  };
  // Expose the live recordings via getters so reassignments inside the methods
  // (e.g. rec.createdSession = args) are visible on the returned store.
  Object.defineProperties(store, {
    createdPlayers: { get: () => rec.createdPlayers },
    createdSession: { get: () => rec.createdSession },
    replacedSession: { get: () => rec.replacedSession },
    recalcRan: { get: () => rec.recalcRan },
  });
  return store as SessionIntakeStore & {
    createdPlayers: string[];
    createdSession: unknown | null;
    replacedSession: unknown | null;
    recalcRan: boolean;
  };
}

const NOW = new Date("2026-07-01T00:00:00Z");

describe("intakeSession — create mode", () => {
  it("creates a session + SessionPlayers for all-existing players and triggers recalc", async () => {
    const store = makeStore({
      existingPlayers: {
        alice: { id: "p-a", name: "Alice", status: "ACTIVE" },
        bob: { id: "p-b", name: "Bob", status: "ACTIVE" },
        carol: { id: "p-c", name: "Carol", status: "ACTIVE" },
        dave: { id: "p-d", name: "Dave", status: "ACTIVE" },
      },
    });

    const result = await intakeSession(
      {
        leagueId: "L1",
        submittedById: "u1",
        now: NOW,
        mode: "create",
        slots: [
          { playerId: "p-a", wins: 3 },
          { playerId: "p-b", wins: 3 },
          { playerId: "p-c", wins: 1 },
          { playerId: "p-d", wins: 1 },
        ],
      },
      store,
    );

    expect(result).toEqual({ ok: true, sessionId: "session-1" });
    expect(store.createdPlayers).toEqual([]);
    expect(store.createdSession).toMatchObject({
      leagueId: "L1",
      submittedById: "u1",
      timestamp: NOW,
      players: [
        { playerId: "p-a", wins: 3 },
        { playerId: "p-b", wins: 3 },
        { playerId: "p-c", wins: 1 },
        { playerId: "p-d", wins: 1 },
      ],
    });
    expect(store.replacedSession).toBeNull();
    expect(store.recalcRan).toBe(true);
  });

  it("creates a Player for a new name, then creates the session and recalcs", async () => {
    const store = makeStore({
      existingPlayers: {
        alice: { id: "p-a", name: "Alice", status: "ACTIVE" },
        bob: { id: "p-b", name: "Bob", status: "ACTIVE" },
        carol: { id: "p-c", name: "Carol", status: "ACTIVE" },
      },
    });

    const result = await intakeSession(
      {
        leagueId: "L1",
        submittedById: "u1",
        now: NOW,
        mode: "create",
        slots: [
          { playerId: "p-a", wins: 3 },
          { playerId: "p-b", wins: 3 },
          { playerId: "p-c", wins: 1 },
          { newName: "Dave", wins: 1 },
        ],
      },
      store,
    );

    expect(result.ok).toBe(true);
    expect(store.createdPlayers).toEqual(["Dave"]);
    expect(store.createdSession).toMatchObject({
      players: [
        { playerId: "p-a", wins: 3 },
        { playerId: "p-b", wins: 3 },
        { playerId: "p-c", wins: 1 },
        { playerId: "new-Dave", wins: 1 },
      ],
    });
    expect(store.recalcRan).toBe(true);
  });
});

describe("intakeSession — update mode", () => {
  it("reuses an existing player when a new name matches (duplicate-Player regression), replaces SessionPlayers, recalcs", async () => {
    // The bug: edit typed "John" as a new name and a John already existed ->
    // a second Player row. intakeSession must reuse the existing one.
    const store = makeStore({
      existingPlayers: {
        alice: { id: "p-a", name: "Alice", status: "ACTIVE" },
        bob: { id: "p-b", name: "Bob", status: "ACTIVE" },
        john: { id: "p-john", name: "John", status: "ACTIVE" },
      },
    });

    const result = await intakeSession(
      {
        leagueId: "L1",
        submittedById: "u1",
        now: NOW,
        mode: "update",
        sessionId: "sess-x",
        slots: [
          { playerId: "p-a", wins: 3 },
          { playerId: "p-b", wins: 3 },
          { newName: "john", wins: 1 }, // matches existing "John" case-insensitively
          { newName: "Carol", wins: 1 }, // genuinely new
        ],
      },
      store,
    );

    expect(result.ok).toBe(true);
    // "john" was reused, not created; only "Carol" was created.
    expect(store.createdPlayers).toEqual(["Carol"]);
    expect(store.replacedSession).toMatchObject({
      sessionId: "sess-x",
      leagueId: "L1",
      players: [
        { playerId: "p-a", wins: 3 },
        { playerId: "p-b", wins: 3 },
        { playerId: "p-john", wins: 1 }, // reused existing
        { playerId: "new-Carol", wins: 1 },
      ],
    });
    expect(store.createdSession).toBeNull();
    expect(store.recalcRan).toBe(true);
  });

  it("deletes old SessionPlayers and inserts new ones when all players are replaced", async () => {
    const store = makeStore({
      existingPlayers: {
        alice: { id: "p-a", name: "Alice", status: "ACTIVE" },
        bob: { id: "p-b", name: "Bob", status: "ACTIVE" },
        carol: { id: "p-c", name: "Carol", status: "ACTIVE" },
        dave: { id: "p-d", name: "Dave", status: "ACTIVE" },
      },
    });

    const result = await intakeSession(
      {
        leagueId: "L1",
        submittedById: "u1",
        now: NOW,
        mode: "update",
        sessionId: "sess-x",
        slots: [
          { playerId: "p-c", wins: 5 },
          { playerId: "p-d", wins: 3 },
          { playerId: "p-a", wins: 3 },
          { playerId: "p-b", wins: 1 },
        ],
      },
      store,
    );

    expect(result.ok).toBe(true);
    // replaceSession is the single call that deletes old + inserts new (the
    // Prisma adapter does that in one transaction); asserting it received the
    // full new player set is the contract.
    expect(store.replacedSession).toMatchObject({
      sessionId: "sess-x",
      players: [
        { playerId: "p-c", wins: 5 },
        { playerId: "p-d", wins: 3 },
        { playerId: "p-a", wins: 3 },
        { playerId: "p-b", wins: 1 },
      ],
    });
    expect(store.recalcRan).toBe(true);
  });
});

describe("intakeSession — validation", () => {
  it("returns a validation error without persisting or recalcing for an invalid session", async () => {
    const store = makeStore({
      existingPlayers: {
        alice: { id: "p-a", name: "Alice", status: "ACTIVE" },
        bob: { id: "p-b", name: "Bob", status: "ACTIVE" },
        carol: { id: "p-c", name: "Carol", status: "ACTIVE" },
        dave: { id: "p-d", name: "Dave", status: "ACTIVE" },
      },
    });

    // All wins zero -> total wins 0 -> invalid (and no new players to create).
    const result = await intakeSession(
      {
        leagueId: "L1",
        submittedById: "u1",
        now: NOW,
        mode: "create",
        slots: [
          { playerId: "p-a", wins: 0 },
          { playerId: "p-b", wins: 0 },
          { playerId: "p-c", wins: 0 },
          { playerId: "p-d", wins: 0 },
        ],
      },
      store,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/greater than zero/i);
    }
    expect(store.createdSession).toBeNull();
    expect(store.replacedSession).toBeNull();
    expect(store.recalcRan).toBe(false);
  });
});
