import { test } from "@playwright/test";
import { signIn, addNewPlayer, setPlayerWins, expect } from "./helpers";
import { TEST_SCORER } from "./fixtures";

// Drive the single-grid form (step 16.2 rev): add four on-the-fly new players and
// set each one's wins (but do not submit). `wins` total must be even and > 0.
async function fillFourNewPlayers(
  page: import("@playwright/test").Page,
  token: string,
  wins: [number, number, number, number],
) {
  for (let i = 0; i < 4; i++) {
    const name = `[e2e] ${token} P${i}`;
    await addNewPlayer(page, name);
    await setPlayerWins(page, name, wins[i]);
  }
}

test("a scorer submits a valid session and lands on the ladder", async ({
  page,
}) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  await fillFourNewPlayers(page, `ok-${Date.now()}`, [3, 3, 1, 1]);
  await page.getByRole("button", { name: /log results/i }).click();

  // Success screen, then "View ladder" lands on the ladder (home).
  await expect(page.getByText(/session logged/i)).toBeVisible();
  await page.getByRole("button", { name: /view ladder/i }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});

test("a session with an odd total of wins is rejected", async ({ page }) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  await fillFourNewPlayers(page, `odd-${Date.now()}`, [3, 3, 1, 2]);
  await page.getByRole("button", { name: /log results/i }).click();

  await expect(page.getByText(/total wins must be even/i)).toBeVisible();
  await expect(page).toHaveURL(/\/submit/);
});

test("adding a new player via the + New chip names its score block", async ({
  page,
}) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  const name = `[e2e] chip-${Date.now()}`;
  await addNewPlayer(page, name);
  // A named score block now exists for the typed name.
  await expect(page.getByRole("group", { name })).toBeVisible();
});

test("the + New chip rejects a name already on the list", async ({ page }) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  const name = `[e2e] dup-${Date.now()}`;
  await addNewPlayer(page, name);

  // Typing the same name again shows an inline error and adds no second block.
  const grid = page.getByRole("group", { name: "Choose players" });
  await grid.getByRole("button", { name: "+ New" }).click();
  await grid.getByRole("textbox", { name: "New player name" }).fill(name);
  await grid.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByText(/already on the list/i)).toBeVisible();
});

test("an unauthenticated user cannot reach /submit", async ({ page }) => {
  await page.goto("/l/bsc-doubles-squash/submit");
  await expect(page).toHaveURL(/\/signin/);
});

// Step 16.4: on a touch device with the Web Share API, a successful submit shows
// the success screen and the Share button calls navigator.share. Playwright
// Chromium has no real Web Share API and reports a fine pointer, so stub both
// (Web Share + a coarse pointer) and capture the shared text. The native sheet
// itself isn't driveable — we assert up to the navigator.share call.
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

test("a touch device shows the success screen and shares the result", async ({
  page,
}) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await stubTouchShare(page);
  await page.goto("/l/bsc-doubles-squash/submit");

  const token = `share-${Date.now()}`;
  await fillFourNewPlayers(page, token, [3, 3, 1, 1]);
  await page.getByRole("button", { name: /log results/i }).click();

  // Success screen, not a redirect.
  await expect(page.getByText(/session logged/i)).toBeVisible();
  await expect(page).toHaveURL(/\/submit/);

  await page.getByRole("button", { name: /share to whatsapp/i }).click();
  const shared = await page.evaluate(
    () => (window as unknown as { __shared: string[] }).__shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]).toContain(`[e2e] ${token} P0 3`);
  expect(shared[0]).toContain("Ladder:");

  // "View ladder" leaves the success screen for the ladder.
  await page.getByRole("button", { name: /view ladder/i }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});

// On desktop (default Chromium: fine pointer), the success screen shows but the
// Share button is hidden — the share sheet there can't reach the WhatsApp group.
test("desktop shows the success screen without a Share button", async ({
  page,
}) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  await fillFourNewPlayers(page, `desk-${Date.now()}`, [3, 3, 1, 1]);
  await page.getByRole("button", { name: /log results/i }).click();

  await expect(page.getByText(/session logged/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /share to whatsapp/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /view ladder/i }).click();
  await expect(page).toHaveURL(/\/l\/bsc-doubles-squash$/);
});

// Step 28: in-progress entries are autosaved to localStorage and restored after a
// page reload, so a courtside scorer doesn't lose data if the app closes. The
// draft is cleared on a successful submit.
test("draft entries survive a reload and are cleared after submit", async ({
  page,
}) => {
  await signIn(page, TEST_SCORER.email, TEST_SCORER.password);
  await page.goto("/l/bsc-doubles-squash/submit");

  const token = `draft-${Date.now()}`;
  const name = `[e2e] ${token} P0`;
  await addNewPlayer(page, name);
  await setPlayerWins(page, name, 3);
  // Type some notes so both entries + notes are in the draft.
  await page.getByLabel("Notes").fill("Half-time scores");

  // Reload — the form should restore the player + wins + notes from localStorage.
  await page.reload();
  const block = page.getByRole("group", { name });
  await expect(block).toBeVisible();
  await expect(
    block.getByRole("button", { name: "3 wins", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Notes")).toHaveValue("Half-time scores");

  // Add the remaining players to make a valid session, then submit.
  for (let i = 1; i < 4; i++) {
    const n = `[e2e] ${token} P${i}`;
    await addNewPlayer(page, n);
    await setPlayerWins(page, n, i === 1 ? 3 : 1);
  }
  await page.getByRole("button", { name: /log results/i }).click();
  await expect(page.getByText(/session logged/i)).toBeVisible();

  // The draft is cleared on submit — a fresh reload shows an empty form.
  await page.goto("/l/bsc-doubles-squash/submit");
  await expect(page.getByRole("group", { name })).toHaveCount(0);
  await expect(page.getByLabel("Notes")).toHaveValue("");
});
