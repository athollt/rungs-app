import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { leagueBySlug, type LeagueContext } from "@/lib/league";
import { prismaLeagueScorerStore } from "@/lib/league-scorer-store";
import { canScoreLeague } from "@/lib/auth-rules";

// Page-boundary access helpers for /l/{slug} routes (step 21, ADR-013). The
// proxy gates on route shape only; these resolve the real league and enforce the
// per-league grant where the league id is known.

// Resolve a slug to its league, or 404. Used by every league page (public reads
// included — an unknown slug is not a league).
export async function resolveLeagueOr404(slug: string): Promise<LeagueContext> {
  const league = await leagueBySlug(slug);
  if (!league) notFound();
  return league;
}

export type LeagueScorerContext = {
  league: LeagueContext;
  userId: string;
  role: "ADMIN" | "SCORER" | undefined;
};

export type ScorerContextResult =
  | { ok: true; league: LeagueContext; userId: string; role: "ADMIN" | "SCORER" | undefined }
  | { ok: false; error: string };

// Pure (non-throwing) resolver: resolve the league by slug, check auth, and
// check the scorer grant with an admin bypass (ADR-012). Returns the context or
// an error — never redirects or 404s. Server Actions that return { ok: false }
// call this directly; pages use requireLeagueScorer (the redirecting adapter).
export async function resolveScorerContext(
  slug: string,
): Promise<ScorerContextResult> {
  const league = await leagueBySlug(slug);
  if (!league) return { ok: false, error: "League not found." };

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthenticated" };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Unauthenticated" };

  const grants = await prismaLeagueScorerStore.leagueIdsFor(user.id);
  if (!canScoreLeague({ role: session.role, grants, leagueId: league.id })) {
    return { ok: false, error: "Forbidden" };
  }

  return { ok: true, league, userId: user.id, role: session.role };
}

// Resolve the league and require the signed-in staff member to be able to score
// it (ADR-012): admin bypasses, a scorer needs a LeagueScorer grant. Unknown
// slug → 404; logged out → /signin; logged in without grant → /unauthorised.
// A thin redirecting adapter over resolveScorerContext — page callers unchanged.
export async function requireLeagueScorer(
  slug: string,
): Promise<LeagueScorerContext> {
  const result = await resolveScorerContext(slug);
  if (!result.ok) {
    if (result.error === "League not found.") notFound();
    if (result.error === "Unauthenticated") redirect("/signin");
    redirect("/unauthorised");
  }
  return {
    league: result.league,
    userId: result.userId,
    role: result.role,
  };
}
