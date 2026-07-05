import { prisma } from "@/lib/prisma";
import { validateSession } from "@/lib/session-validation";
import type {
  SessionIntakeStore,
  SessionWriteStore,
} from "@/lib/session-intake";
import { makePrismaPlayerStore } from "@/lib/player-store";
import { prismaRecalcStore } from "@/lib/recalc-store";

// Prisma-backed SessionWriteStore (step 27). createSession inserts a Session +
// its SessionPlayers (the prior submit action's logic); replaceSession deletes
// the old SessionPlayers and inserts the new set (the prior edit action's
// logic). Both are league-scoped (ADR-011). The totals (totalPlayerWins,
// inferredGames, playerCount) are derived here from the validated players so
// the pure intakeSession stays free of Prisma-shaped data.
export const prismaSessionWriteStore: SessionWriteStore = {
  async createSession({ leagueId, submittedById, players, notes, timestamp }) {
    const v = validateSession({ players });
    if (!v.ok) throw new Error("Invalid session passed to createSession");
    const session = await prisma.session.create({
      data: {
        timestamp,
        submittedById,
        leagueId,
        notes,
        totalPlayerWins: v.session.totalPlayerWins,
        inferredGames: v.session.inferredGames,
        playerCount: v.session.playerCount,
        sessionPlayers: {
          create: v.session.players.map((p) => ({
            playerId: p.playerId,
            wins: p.wins,
          })),
        },
      },
      select: { id: true },
    });
    return { id: session.id };
  },

  async replaceSession({ sessionId, leagueId, players, notes }) {
    void leagueId; // scoped by the session id; kept for the port contract.
    const v = validateSession({ players });
    if (!v.ok) throw new Error("Invalid session passed to replaceSession");
    await prisma.$transaction([
      prisma.sessionPlayer.deleteMany({ where: { sessionId } }),
      prisma.session.update({
        where: { id: sessionId },
        data: {
          notes,
          totalPlayerWins: v.session.totalPlayerWins,
          inferredGames: v.session.inferredGames,
          playerCount: v.session.playerCount,
          sessionPlayers: {
            create: v.session.players.map((p) => ({
              playerId: p.playerId,
              wins: p.wins,
            })),
          },
        },
      }),
    ]);
  },
};

// Build the combined SessionIntakeStore for one League from the existing Prisma
// adapters: the per-League PlayerStore (name resolution), the session write
// store, and the shared recalc store. intakeSession consumes this single port.
export function makePrismaSessionIntakeStore(
  leagueId: string,
): SessionIntakeStore {
  const playerStore = makePrismaPlayerStore(leagueId);
  return {
    findByNameInsensitive: playerStore.findByNameInsensitive,
    create: playerStore.create,
    ...prismaSessionWriteStore,
    ...prismaRecalcStore,
  };
}
