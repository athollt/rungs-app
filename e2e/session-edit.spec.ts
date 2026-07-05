import { test } from "@playwright/test";
import { signIn, submitNewSession, setPlayerWins, addNewPlayer, expect } from "./helpers";
import { TEST_ADMIN, TEST_SCORER } from "./fixtures";
import type { Page } from "@playwright/test";

// Submit a session of four on-the-fly [e2e] players as the signed-in user.
async function submitSession(page: Page, token: string) {
  await page.goto("/l/bsc-doubles-squash/submit");
  const names = [0, 1, 2, 3].map((i) => `[e2e] ${token} P${i}`);
  await submitNewSession(page, names, [3, 3, 1, 1]);
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
}

// Find the newest session's edit URL from the admin sessions list.
async function newestEditHref(page: Page): Promise<string> {
  await page.goto("/l/bsc-doubles-squash/admin/sessions");
  const firstEdit = page.getByRole("link", { name: "Edit" }).first();
  await expect(firstEdit).toBeVisible();
  return (await firstEdit.getAttribute("href")) ?? "";
}

test("a scorer can edit their own session", async ({ page }) => {
  const token = `own-edit-${Date.now()}`;
  // Scorer submits a session (owned by the scorer).
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await submitSession(page, token);

  // There is no public session list yet (step 10), so discover the edit URL via
  // the admin list, then act as the scorer — whose ownership check passes.
  await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
  const href = await newestEditHref(page);

  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();
  // Edit two players' wins, keeping the total even (3+3+1+1 → 5+3+3+1 = 12).
  await setPlayerWins(page, `[e2e] ${token} P0`, 5);
  await setPlayerWins(page, `[e2e] ${token} P2`, 3);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});

test("a scorer is redirected from another user's session edit page", async ({
  page,
}) => {
  // Admin submits a session (owned by admin).
  await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await submitSession(page, `admin-owned-${Date.now()}`);
  const href = await newestEditHref(page);

  // Now sign in as the scorer and try to open the admin's session edit page.
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto(href);
  await expect(page).toHaveURL(/\/unauthorised/);
});

test("an admin can edit any session and save", async ({ page }) => {
  const token = `admin-edit-${Date.now()}`;
  await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await submitSession(page, token);
  const href = await newestEditHref(page);

  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();
  // Change two players' wins, keeping the total even, and save.
  await setPlayerWins(page, `[e2e] ${token} P0`, 5);
  await setPlayerWins(page, `[e2e] ${token} P2`, 3);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});

// Regression (step 27): the edit action now resolves on-the-fly names through
// intakeSession/resolvePlayerName (unified with submit) instead of calling
// prisma.player.create directly. Verify the edit path creates a new on-the-fly
// player exactly once (no duplicate row). The "reuses existing player on a
// name match" regression is covered by the lib/session-intake unit test
// (behaviour 3) — the form's client-side roster guard prevents typing an
// existing roster name as "+ New", so that scenario is not reachable via UI.
test("editing a session creates an on-the-fly player exactly once", async ({
  page,
}) => {
  const token = `dup-fix-${Date.now()}`;
  await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await submitSession(page, token);

  const href = await newestEditHref(page);
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Edit session" })).toBeVisible();

  // Replace P0 with a genuinely new on-the-fly player, keeping the total even.
  const grid = page.getByRole("group", { name: "Choose players" });
  await grid.getByRole("button", { name: `[e2e] ${token} P0` }).click();
  const newPlayer = `[e2e] ${token} P4`;
  await addNewPlayer(page, newPlayer);
  await setPlayerWins(page, newPlayer, 3);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);

  // The new player must appear exactly once on the admin players list.
  await page.goto("/l/bsc-doubles-squash/admin/players");
  await expect(page.getByRole("group", { name: newPlayer })).toHaveCount(1);
});

test("an admin can delete a session", async ({ page }) => {
  await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
  await submitSession(page, `admin-del-${Date.now()}`);
  const href = await newestEditHref(page);

  await page.goto(href);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});
