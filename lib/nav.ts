export type Role = "ADMIN" | "SCORER";

// The league slug embedded in a /l/{slug}/... path, or null off a league route
// (e.g. /admin/users, /signin). Lets the shared chrome build league-relative nav.
export function slugFromPathname(pathname: string): string | null {
  const m = pathname.match(/^\/l\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

export interface NavLink {
  // A stable key for matching/icons, independent of the league slug ("ladder",
  // "sessions", "submit", "/admin/players", …).
  key: string;
  href: string;
  label: string;
}

// Per-league admin pages, in menu order. `Users` is NOT here — account/role
// management is a global admin surface (stays at top-level /admin/users).
const leagueAdminPages: { sub: string; label: string }[] = [
  { sub: "admin/players", label: "Players" },
  { sub: "admin/sessions", label: "Sessions" },
  { sub: "admin/settings", label: "Ratings" },
];

// The header hamburger links for a role, scoped to the current league `slug`.
// Scorers and admins both see the per-league pages; the global admin surfaces
// (Leagues provisioning, Users) are appended for an admin only. Mirrors
// `authorizeRoute`/`canScoreLeague`'s gates.
export function adminLinksFor(role: Role, slug: string): NavLink[] {
  const links: NavLink[] = leagueAdminPages.map((p) => ({
    key: `/${p.sub}`,
    href: `/l/${slug}/${p.sub}`,
    label: p.label,
  }));
  if (role === "ADMIN") {
    links.push(...globalAdminLinks());
  }
  return links;
}

// The global (not league-scoped) admin links: League provisioning + Users. Shown
// to an admin everywhere — including the landing page, before any league is
// selected (the hamburger off a league route shows exactly these).
export function globalAdminLinks(): NavLink[] {
  return [
    { key: "/admin/leagues", href: "/admin/leagues", label: "Leagues" },
    {
      key: "/admin/access-requests",
      href: "/admin/access-requests",
      label: "Access requests",
    },
    { key: "/admin/users", href: "/admin/users", label: "Users" },
  ];
}

// Tools are neither management nor league-scoped: they apply on every route and to
// every role. Kept out of adminLinksFor/globalAdminLinks so the hamburger's
// management semantics stay intact — the menu appends these separately (ADR-017).
export function toolLinks(): NavLink[] {
  return [{ key: "/timer", href: "/timer", label: "Timer" }];
}

// The primary (bottom-bar) nav for a role within league `slug`. Public links
// always show; Submit requires a session. Admin pages live in the hamburger.
export function navLinksFor(role: Role | undefined, slug: string): NavLink[] {
  const links: NavLink[] = [
    { key: "ladder", href: `/l/${slug}`, label: "Ladder" },
    { key: "sessions", href: `/l/${slug}/sessions`, label: "Sessions" },
  ];
  if (role) {
    links.push({ key: "submit", href: `/l/${slug}/submit`, label: "Submit" });
  }
  return links;
}
