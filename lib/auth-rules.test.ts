import { describe, it, expect } from "vitest";
import { authorizeRoute } from "@/lib/auth-rules";

describe("authorizeRoute", () => {
  it("redirects an unauthenticated visitor away from /submit to sign-in", () => {
    expect(authorizeRoute("/submit", null)).toBe("signin");
  });

  it("allows an unauthenticated visitor to view the public ladder at /", () => {
    expect(authorizeRoute("/", null)).toBe("allow");
  });

  it("allows an unauthenticated visitor to view the public session history at /sessions", () => {
    expect(authorizeRoute("/sessions", null)).toBe("allow");
  });

  it("allows an unauthenticated visitor to view a public session detail page", () => {
    expect(authorizeRoute("/sessions/42", null)).toBe("allow");
  });

  it("allows an unauthenticated visitor to view a public player trend page", () => {
    expect(authorizeRoute("/players/7", null)).toBe("allow");
  });

  it("redirects an unauthenticated visitor away from a session edit page to sign-in", () => {
    expect(authorizeRoute("/sessions/42/edit", null)).toBe("signin");
  });

  it("allows an authenticated scorer to access /submit", () => {
    expect(authorizeRoute("/submit", { role: "SCORER" })).toBe("allow");
  });

  it("allows a scorer into Players, Sessions and Settings admin screens", () => {
    expect(authorizeRoute("/admin/players", { role: "SCORER" })).toBe("allow");
    expect(authorizeRoute("/admin/sessions", { role: "SCORER" })).toBe("allow");
    expect(authorizeRoute("/admin/settings", { role: "SCORER" })).toBe("allow");
  });

  it("denies a scorer the admin Users screen", () => {
    expect(authorizeRoute("/admin/users", { role: "SCORER" })).toBe(
      "unauthorised",
    );
  });

  it("denies a scorer the admin Leagues (provisioning) screen", () => {
    expect(authorizeRoute("/admin/leagues", { role: "SCORER" })).toBe(
      "unauthorised",
    );
  });

  it("allows an admin into the Leagues provisioning screen", () => {
    expect(authorizeRoute("/admin/leagues", { role: "ADMIN" })).toBe("allow");
  });

  it("denies a scorer the access-request approval queue", () => {
    expect(authorizeRoute("/admin/access-requests", { role: "SCORER" })).toBe(
      "unauthorised",
    );
  });

  it("allows an admin into the access-request approval queue", () => {
    expect(authorizeRoute("/admin/access-requests", { role: "ADMIN" })).toBe(
      "allow",
    );
  });

  it("redirects an unauthenticated visitor away from an admin screen to sign-in", () => {
    expect(authorizeRoute("/admin/players", null)).toBe("signin");
    expect(authorizeRoute("/admin/users", null)).toBe("signin");
  });

  it("allows an admin into every admin screen", () => {
    expect(authorizeRoute("/admin/players", { role: "ADMIN" })).toBe("allow");
    expect(authorizeRoute("/admin/users", { role: "ADMIN" })).toBe("allow");
    expect(authorizeRoute("/admin/settings", { role: "ADMIN" })).toBe("allow");
  });

  it("allows the auth API routes through without a session", () => {
    expect(authorizeRoute("/api/auth/signin", null)).toBe("allow");
  });

  it("allows the sign-in page through without a session", () => {
    expect(authorizeRoute("/signin", null)).toBe("allow");
  });

  // The Timer (step 30, ADR-017) stores nothing and reads nothing, so there is
  // nothing to protect — and gating it would bounce an expired session to Google
  // OAuth on club wifi mid-swim.
  it("allows the timer through without a session", () => {
    expect(authorizeRoute("/timer", null)).toBe("allow");
  });

  // /l/{slug} routing (step 21, ADR-013): the proxy gates on route SHAPE only —
  // public league reads need no auth; scorer/admin league surfaces need a session
  // (the per-league grant check happens at the page with the resolved leagueId).
  describe("/l/{slug} league routes", () => {
    it("allows the public league ladder without a session", () => {
      expect(authorizeRoute("/l/bsc-doubles-squash", null)).toBe("allow");
    });

    it("allows public league history and player pages without a session", () => {
      expect(authorizeRoute("/l/bsc-doubles-squash/sessions", null)).toBe("allow");
      expect(authorizeRoute("/l/bsc-doubles-squash/sessions/42", null)).toBe("allow");
      expect(authorizeRoute("/l/bsc-doubles-squash/players/7", null)).toBe("allow");
    });

    it("redirects an unauthenticated visitor away from a league submit/edit page", () => {
      expect(authorizeRoute("/l/bsc-doubles-squash/submit", null)).toBe("signin");
      expect(authorizeRoute("/l/bsc-doubles-squash/sessions/42/edit", null)).toBe(
        "signin",
      );
    });

    it("redirects an unauthenticated visitor away from a league admin page", () => {
      expect(authorizeRoute("/l/bsc-doubles-squash/admin/players", null)).toBe(
        "signin",
      );
    });

    it("lets a signed-in scorer through the shape gate for a league surface", () => {
      // Shape gate only — the grant check is at the page. A session is enough here.
      expect(
        authorizeRoute("/l/bsc-doubles-squash/submit", { role: "SCORER" }),
      ).toBe("allow");
      expect(
        authorizeRoute("/l/bsc-doubles-squash/admin/players", { role: "SCORER" }),
      ).toBe("allow");
    });
  });
});
