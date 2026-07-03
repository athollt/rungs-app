"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canMutateSession } from "@/lib/session-authz";
import { runRecalculation } from "@/lib/recalc";
import { prismaRecalcStore } from "@/lib/recalc-store";
import { intakeSession } from "@/lib/session-intake";
import { makePrismaSessionIntakeStore } from "@/lib/session-write-store";
import { resolveScorerContext } from "@/lib/league-access";
import { prismaLeagueScorerStore } from "@/lib/league-scorer-store";
import type { SubmitData } from "@/app/l/[slug]/submit/actions";

export type MutateResult = { ok: true } | { ok: false; error: string };

export async function updateSessionAction(
  slug: string,
  sessionId: string,
  data: SubmitData,
): Promise<MutateResult> {
  // Auth + league + scorer grant (ADR-012). resolveScorerContext returns an
  // error instead of redirecting, so the action can return { ok: false }.
  const ctx = await resolveScorerContext(slug);
  if (!ctx.ok) return ctx;

  // Load the target session and check ownership + league scope (ADR-010/012).
  // The edit page composes the same check at its boundary; this is the
  // defence-in-depth re-check for a forged action call.
  const target = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { submittedById: true, leagueId: true },
  });
  if (!target || target.leagueId !== ctx.league.id) {
    return { ok: false, error: "Session not found." };
  }
  const grants = await prismaLeagueScorerStore.leagueIdsFor(ctx.userId);
  if (
    !canMutateSession({
      userId: ctx.userId,
      role: ctx.role,
      submittedById: target.submittedById,
      grants,
      sessionLeagueId: target.leagueId,
    })
  ) {
    return { ok: false, error: "Forbidden" };
  }

  const result = await intakeSession(
    {
      leagueId: ctx.league.id,
      submittedById: ctx.userId,
      slots: data.slots,
      notes: data.notes,
      now: new Date(),
      mode: "update",
      sessionId,
    },
    makePrismaSessionIntakeStore(ctx.league.id),
  );
  if (!result.ok) return result;

  revalidatePath(`/l/${slug}`);
  revalidatePath(`/l/${slug}/sessions`);
  return { ok: true };
}

export async function deleteSessionAction(
  slug: string,
  sessionId: string,
): Promise<MutateResult> {
  const ctx = await resolveScorerContext(slug);
  if (!ctx.ok) return ctx;

  const target = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { submittedById: true, leagueId: true },
  });
  if (!target || target.leagueId !== ctx.league.id) {
    return { ok: false, error: "Session not found." };
  }
  const grants = await prismaLeagueScorerStore.leagueIdsFor(ctx.userId);
  if (
    !canMutateSession({
      userId: ctx.userId,
      role: ctx.role,
      submittedById: target.submittedById,
      grants,
      sessionLeagueId: target.leagueId,
    })
  ) {
    return { ok: false, error: "Forbidden" };
  }

  // Cascade removes SessionPlayer + RatingsLog (schema onDelete: Cascade).
  await prisma.session.delete({ where: { id: sessionId } });

  await runRecalculation(prismaRecalcStore, new Date(), ctx.league.id);
  revalidatePath(`/l/${slug}`);
  revalidatePath(`/l/${slug}/sessions`);
  return { ok: true };
}
