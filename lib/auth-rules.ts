export type RouteDecision = "allow" | "signin" | "unauthorised";

export interface RouteAuth {
  role?: string;
  // Ids of the leagues this scorer is granted (LeagueScorer). Empty/absent for a
  // scorer with no grants; ignored for an admin (who bypasses). ADR-012.
  grants?: string[];
}

// Whether a staff member may score (log/edit sessions in) a given league.
// A global ADMIN bypasses; a SCORER needs a LeagueScorer grant for that league
// (ADR-012). Pure — the grant list is supplied by the caller.
export function canScoreLeague({
  role,
  grants,
  leagueId,
}: {
  role: string | undefined;
  grants: string[];
  leagueId: string;
}): boolean {
  if (role === "ADMIN") return true;
  return grants.includes(leagueId);
}

// A session detail page is /sessions/<id> — exactly one segment after
// /sessions/. /sessions/<id>/edit is a scorer route, so it is not public.
function isPublicSessionDetail(pathname: string): boolean {
  const match = pathname.match(/^\/sessions\/([^/]+)$/);
  return match !== null;
}

// Public per-league read routes (ADR-013): the ladder, history, a session detail
// and a player trend — all under /l/{slug}/, viewable without login. The scorer
// surfaces (.../submit, .../sessions/{id}/edit, .../admin/*) are deliberately
// excluded so they fall through to the auth gate.
function isPublicLeagueRoute(pathname: string): boolean {
  return (
    /^\/l\/[^/]+$/.test(pathname) || // /l/{slug}  (ladder)
    /^\/l\/[^/]+\/sessions$/.test(pathname) || // /l/{slug}/sessions
    /^\/l\/[^/]+\/sessions\/[^/]+$/.test(pathname) || // /l/{slug}/sessions/{id}
    /^\/l\/[^/]+\/players\/[^/]+$/.test(pathname) // /l/{slug}/players/{id}
  );
}

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/unauthorised" ||
    pathname === "/signin" ||
    // The Timer (step 30, ADR-017) is a client-only tool: no data read, none
    // written, so nothing to gate. It is surfaced in the hamburger for signed-in
    // staff, but the route itself must not bounce an expired session to OAuth.
    pathname === "/timer" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/sessions" ||
    isPublicSessionDetail(pathname) ||
    pathname.startsWith("/players/") ||
    isPublicLeagueRoute(pathname)
  );
}

// Global-admin screens a scorer may NOT reach: Users (login accounts + roles),
// Leagues (provisioning — create league, assign scorer), and the access-request
// approval queue (ADR-014). All top-level (not league-scoped). Per-league
// Players/Sessions/Settings live under /l/{slug}/admin and are gated per-league
// at the page (ADR-012), not here.
function isAdminOnly(pathname: string): boolean {
  return (
    pathname === "/admin/users" ||
    pathname.startsWith("/admin/users/") ||
    pathname === "/admin/leagues" ||
    pathname.startsWith("/admin/leagues/") ||
    pathname === "/admin/access-requests" ||
    pathname.startsWith("/admin/access-requests/")
  );
}

export function authorizeRoute(
  pathname: string,
  auth: RouteAuth | null,
  targetLeagueId?: string,
): RouteDecision {
  if (isPublicRoute(pathname)) return "allow";
  if (!auth) return "signin";
  if (isAdminOnly(pathname) && auth.role !== "ADMIN") {
    return "unauthorised";
  }
  // League gate (ADR-012): on a league-scoped scorer/admin route (the leagueId
  // is supplied by step 21's /l/{slug} wiring), a scorer needs a grant for that
  // league; an admin bypasses. With no targetLeagueId the route is not league-
  // scoped (today's global routes) and this gate is inert.
  if (targetLeagueId !== undefined) {
    if (!canScoreLeague({ role: auth.role, grants: auth.grants ?? [], leagueId: targetLeagueId })) {
      return "unauthorised";
    }
  }
  return "allow";
}
