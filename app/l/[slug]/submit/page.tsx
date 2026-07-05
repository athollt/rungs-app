import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { leagueBySlug } from "@/lib/league";
import { leaguePageTitle } from "@/lib/page-title";
import { requireLeagueScorer } from "@/lib/league-access";
import { ladderUrlForSlug } from "@/lib/share";
import { SessionForm, type FormSlot } from "@/components/session-form";
import { PageShell } from "@/components/ui/page-shell";
import { submitSessionAction } from "./actions";

// Title leads with the brand, then the league (step 24): "Rungs - {displayName}".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const league = await leagueBySlug(slug);
  if (!league) return {};
  return { title: { absolute: leaguePageTitle(league.displayName) } };
}

export const dynamic = "force-dynamic";

export default async function SubmitPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { league } = await requireLeagueScorer(slug);

  const players = await prisma.player.findMany({
    where: { status: "ACTIVE", leagueId: league.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  async function onSubmit(slots: FormSlot[], notes: string) {
    "use server";
    return submitSessionAction(slug, { slots, notes });
  }

  return (
    <PageShell
      title="Submit a session"
      subtitle="Add each player and the games they won · courtside"
    >
      <SessionForm
        players={players}
        submitLabel="Log Results"
        onSubmit={onSubmit}
        ladderUrl={ladderUrlForSlug(slug)}
        ladderHref={`/l/${slug}`}
        slug={slug}
      />
    </PageShell>
  );
}
