"use server";

import { revalidatePath } from "next/cache";
import { intakeSession } from "@/lib/session-intake";
import { makePrismaSessionIntakeStore } from "@/lib/session-write-store";
import { resolveScorerContext } from "@/lib/league-access";

export interface SubmitSlot {
  playerId?: string;
  newName?: string;
  wins: number;
}

export interface SubmitData {
  slots: SubmitSlot[];
  notes?: string;
}

export type SubmitResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

export async function submitSessionAction(
  slug: string,
  data: SubmitData,
): Promise<SubmitResult> {
  // Server-side gate (defence in depth beyond the page): resolves the league
  // and enforces the scorer grant (ADR-012). resolveScorerContext returns an
  // error instead of redirecting, so the action can return { ok: false }.
  const ctx = await resolveScorerContext(slug);
  if (!ctx.ok) return ctx;

  const result = await intakeSession(
    {
      leagueId: ctx.league.id,
      submittedById: ctx.userId,
      slots: data.slots,
      notes: data.notes,
      now: new Date(),
      mode: "create",
    },
    makePrismaSessionIntakeStore(ctx.league.id),
  );
  if (!result.ok) return result;

  revalidatePath(`/l/${slug}`);
  revalidatePath(`/l/${slug}/sessions`);
  return result;
}
