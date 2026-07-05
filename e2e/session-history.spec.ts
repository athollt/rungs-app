import { test } from "@playwright/test";
import { signIn, submitNewSession, expect } from "./helpers";
import { TEST_SCORER } from "./fixtures";

// /sessions is public — reachable without authentication (behaviour 1).
test("the session history page is public", async ({ page }) => {
  await page.goto("/l/bsc-doubles-squash/sessions");
  await expect(
    page.getByRole("heading", { name: "Session history" }),
  ).toBeVisible();
});

// A non-existent session id returns 404 (behaviour 5).
test("an unknown session id returns 404", async ({ page }) => {
  const res = await page.goto("/l/bsc-doubles-squash/sessions/does-not-exist");
  expect(res?.status()).toBe(404);
});

// A submitted session appears in the list and on its own detail page
// (behaviours 2, 3, 4).
test("a submitted session is listed and has a detail page", async ({
  page,
}) => {
  const token = `hist-${Date.now()}`;
  const names = [0, 1, 2, 3].map((i) => `[e2e] ${token} P${i}`);
  const wins = [3, 2, 2, 1];

  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");
  await submitNewSession(page, names, wins);
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);

  // The session shows on the public list with player count and games.
  await page.goto("/l/bsc-doubles-squash/sessions");
  const item = page.getByRole("listitem").filter({ hasText: "4 players" });
  await expect(item.first()).toBeVisible();

  // Player names are visible inline without expanding anything (step 16.1).
  await expect(item.first().getByText(names[0])).toBeVisible();
  await item.first().getByRole("link", { name: /more details/i }).click();

  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  await expect(page.getByText(/submitted by/i)).toBeVisible();
  for (const name of names) {
    await expect(page.getByRole("cell", { name })).toBeVisible();
  }
});

// Step 28: a touch device shows a Share button on each history card and tapping
// it calls navigator.share with the roster + ladder link. Chromium has no Web
// Share API and reports a fine pointer, so stub both (same as submit.spec.ts).
async function stubTouchShare(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __shared: string[] }).__shared = [];
    // @ts-expect-error - defining the API Chromium doesn't provide
    navigator.share = (data: { text: string }) => {
      (window as unknown as { __shared: string[] }).__shared.push(data.text);
      return Promise.resolve();
    };
    const realMatchMedia = window.matchMedia.bind(window);
    // @ts-expect-error - narrow override to report a touch-primary device
    window.matchMedia = (q: string) =>
      q.includes("coarse")
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })
        : realMatchMedia(q);
  });
}

test("a touch device shows a Share button on a history card and shares", async ({
  page,
}) => {
  const token = `sh-${Date.now()}`;
  const names = [0, 1, 2, 3].map((i) => `[e2e] ${token} P${i}`);
  const wins = [3, 3, 1, 1];

  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");
  await submitNewSession(page, names, wins);

  await stubTouchShare(page);
  await page.goto("/l/bsc-doubles-squash/sessions");

  // The most recent session card (first in the list) has a Share button.
  const card = page.getByRole("listitem").filter({ hasText: names[0] }).first();
  await expect(card.getByRole("button", { name: /^share$/i })).toBeVisible();
  await card.getByRole("button", { name: /^share$/i }).click();

  const shared = await page.evaluate(
    () => (window as unknown as { __shared: string[] }).__shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]).toContain(`Scores: ${names[0]} 3`);
  expect(shared[0]).toContain("Ladder:");
});

