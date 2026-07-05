import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the I/O dependencies of league-access so resolveScorerContext /
// requireLeagueScorer can be exercised without a DB or the auth runtime. The
// pure grant decision (canScoreLeague) stays real — only its inputs are mocked.

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const leagueBySlugMock = vi.fn();
vi.mock("@/lib/league", () => ({
  leagueBySlug: (slug: string) => leagueBySlugMock(slug),
}));

const leagueIdsForMock = vi.fn();
vi.mock("@/lib/league-scorer-store", () => ({
  prismaLeagueScorerStore: {
    leagueIdsFor: (id: string) => leagueIdsForMock(id),
  },
}));

const userFindUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (args: unknown) => userFindUniqueMock(args) },
  },
}));

// next/navigation's redirect/notFound throw in real Next.js; make the mocks
// throw so requireLeagueScorer halts the same way (and we can assert the call).
const redirectMock = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));

import {
  resolveScorerContext,
  requireLeagueScorer,
} from "@/lib/league-access";

const LEAGUE = {
  id: "L1",
  slug: "bsc",
  name: "BSC",
  displayName: "BSC Doubles",
};

beforeEach(() => {
  authMock.mockReset();
  leagueBySlugMock.mockReset();
  leagueIdsForMock.mockReset();
  userFindUniqueMock.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
  leagueBySlugMock.mockResolvedValue(LEAGUE);
  userFindUniqueMock.mockResolvedValue({ id: "u1" });
});

describe("resolveScorerContext", () => {
  it("returns ok for a granted scorer", async () => {
    authMock.mockResolvedValue({ role: "SCORER", user: { email: "s@x" } });
    leagueIdsForMock.mockResolvedValue(["L1"]);

    const result = await resolveScorerContext("bsc");

    expect(result).toEqual({
      ok: true,
      league: LEAGUE,
      userId: "u1",
      role: "SCORER",
    });
  });

  it("returns an error for an ungranted non-admin user", async () => {
    authMock.mockResolvedValue({ role: "SCORER", user: { email: "s@x" } });
    leagueIdsForMock.mockResolvedValue([]); // no grant for L1

    const result = await resolveScorerContext("bsc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Forbidden");
  });

  it("returns ok for an admin without a grant (admin bypass)", async () => {
    authMock.mockResolvedValue({ role: "ADMIN", user: { email: "a@x" } });
    leagueIdsForMock.mockResolvedValue([]);

    const result = await resolveScorerContext("bsc");

    expect(result).toEqual({
      ok: true,
      league: LEAGUE,
      userId: "u1",
      role: "ADMIN",
    });
  });

  it("returns an error for an unknown slug", async () => {
    leagueBySlugMock.mockResolvedValue(null);

    const result = await resolveScorerContext("nope");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("League not found.");
  });

  it("returns an error when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const result = await resolveScorerContext("bsc");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Unauthenticated");
  });
});

describe("requireLeagueScorer (adapter)", () => {
  it("returns the context on success without redirecting", async () => {
    authMock.mockResolvedValue({ role: "SCORER", user: { email: "s@x" } });
    leagueIdsForMock.mockResolvedValue(["L1"]);

    const result = await requireLeagueScorer("bsc");

    expect(result).toEqual({
      league: LEAGUE,
      userId: "u1",
      role: "SCORER",
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown slug", async () => {
    leagueBySlugMock.mockResolvedValue(null);

    await expect(requireLeagueScorer("nope")).rejects.toThrow("notFound");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("redirects to /signin when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireLeagueScorer("bsc")).rejects.toThrow(
      "redirect:/signin",
    );
    expect(redirectMock).toHaveBeenCalledWith("/signin");
  });

  it("redirects to /unauthorised when the grant is missing", async () => {
    authMock.mockResolvedValue({ role: "SCORER", user: { email: "s@x" } });
    leagueIdsForMock.mockResolvedValue([]);

    await expect(requireLeagueScorer("bsc")).rejects.toThrow(
      "redirect:/unauthorised",
    );
    expect(redirectMock).toHaveBeenCalledWith("/unauthorised");
  });
});
