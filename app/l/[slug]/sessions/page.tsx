import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { leagueBySlug } from "@/lib/league";
import { leaguePageTitle } from "@/lib/page-title";
import { resolveLeagueOr404 } from "@/lib/league-access";
import { formatSessionDate } from "@/lib/session-history";
import { ladderUrlForSlug } from "@/lib/share";
import { PageShell } from "@/components/ui/page-shell";
import { Card } from "@/components/ui/card";
import { ShareButton } from "@/components/share-button";

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

// Public, no auth (auth-rules allows /l/{slug}/sessions). Derived view, not cached.
export const dynamic = "force-dynamic";

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await resolveLeagueOr404(slug);
  const sessions = await prisma.session.findMany({
    where: { leagueId: league.id },
    orderBy: { timestamp: "desc" },
    select: {
      id: true,
      timestamp: true,
      playerCount: true,
      inferredGames: true,
      sessionPlayers: {
        orderBy: { wins: "desc" },
        select: { wins: true, player: { select: { name: true } } },
      },
    },
  });

  return (
    <PageShell title="Session history">
      {sessions.length === 0 ? (
        <p className="text-muted-foreground">No sessions recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {formatSessionDate(s.timestamp)}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {s.playerCount} players · {s.inferredGames} games
                  </span>
                </div>
                {/* Player names shown inline (step 16.1) so the roster is
                    visible without opening the session. */}
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {s.sessionPlayers.map((sp, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{sp.player.name}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {sp.wins} won
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center gap-2">
                  <Link
                    href={`/l/${slug}/sessions/${s.id}`}
                    className="text-primary inline-block text-sm hover:underline"
                  >
                    More details →
                  </Link>
                  <ShareButton
                    roster={s.sessionPlayers.map((sp) => ({
                      name: sp.player.name,
                      wins: sp.wins,
                    }))}
                    ladderUrl={ladderUrlForSlug(slug)}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
