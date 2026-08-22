import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { leagueBySlug } from "@/lib/league";
import { leaguePageTitle } from "@/lib/page-title";
import { resolveLeagueOr404 } from "@/lib/league-access";
import { formatSessionDate } from "@/lib/session-history";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageShell } from "@/components/ui/page-shell";

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

// Public, no auth (auth-rules allows /sessions/<id>). Derived view, not cached.
export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const league = await resolveLeagueOr404(slug);

  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      leagueId: true,
      timestamp: true,
      notes: true,
      totalPlayerWins: true,
      inferredGames: true,
      submittedBy: { select: { name: true } },
      sessionPlayers: {
        // Total order, as on the history list: wins alone leaves tied players
        // in whatever order Postgres happens to return.
        orderBy: [{ wins: "desc" }, { player: { name: "asc" } }],
        select: { playerId: true, wins: true, player: { select: { name: true } } },
      },
      // The rating impact this session had on each player — the value the
      // expandable list row can't show (step 13.5 follow-up).
      ratingsLogs: {
        select: { playerId: true, ratingChange: true, ratingAfter: true },
      },
    },
  });

  // Unknown session, or one from another league (scoped read).
  if (!session || session.leagueId !== league.id) notFound();

  const impactByPlayer = new Map(
    session.ratingsLogs.map((r) => [r.playerId, r]),
  );

  return (
    <PageShell
      back={{ href: `/l/${slug}/sessions`, label: "Session history" }}
      title={formatSessionDate(session.timestamp)}
      subtitle={`Submitted by ${session.submittedBy.name}`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Wins</TableHead>
            <TableHead className="text-right">Change</TableHead>
            <TableHead className="text-right">Score after</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {session.sessionPlayers.map((sp) => {
            const impact = impactByPlayer.get(sp.playerId);
            const change = impact ? Math.round(impact.ratingChange) : null;
            return (
              <TableRow key={sp.playerId}>
                <TableCell>{sp.player.name}</TableCell>
                <TableCell className="text-right tabular-nums">{sp.wins}</TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    change == null
                      ? "text-muted-foreground"
                      : change > 0
                        ? "text-[var(--up)]"
                        : change < 0
                          ? "text-[var(--down)]"
                          : "text-muted-foreground"
                  }`}
                >
                  {change == null ? "—" : `${change > 0 ? "+" : ""}${change}`}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {impact ? Math.round(impact.ratingAfter) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-muted-foreground mt-4 text-sm">
        {session.totalPlayerWins} total wins · {session.inferredGames} games played
      </p>

      {session.notes && (
        <div className="mt-6">
          <h2 className="text-muted-foreground mb-1 text-sm font-medium">Notes</h2>
          <p className="whitespace-pre-wrap">{session.notes}</p>
        </div>
      )}
    </PageShell>
  );
}
