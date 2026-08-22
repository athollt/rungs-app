import { test, expect } from "@playwright/test";

// Timer (step 30, ADR-017). One smoke journey: it asserts wiring, not timing —
// every clock-sensitive rule is unit-tested against injected values in
// lib/timer.test.ts, so nothing here races a real stopwatch.

test("timer is public and runs a start / lap / stop / reset cycle", async ({
  page,
}) => {
  // Signed out on purpose: /timer must not bounce to the sign-in page.
  await page.goto("/timer");
  await expect(page).toHaveURL(/\/timer$/);

  const readout = page.getByRole("timer", { name: "Elapsed time" });
  await expect(readout).toHaveText("00:00.00");

  // Idle: only Start is available.
  await expect(page.getByRole("button", { name: "Lap" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset" })).toBeDisabled();

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(readout).not.toHaveText("00:00.00");

  await page.getByRole("button", { name: "Lap" }).click();
  await expect(page.getByRole("row")).toHaveCount(2); // header + lap 1

  // Stop records the final lap and ends the run in one action.
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("row")).toHaveCount(3); // header + laps 1 and 2
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Lap" })).toBeDisabled();

  // Reset needs a confirming second tap: one stray press must not destroy a set
  // before it has been screenshotted.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "Sure?" }).click();
  await expect(page.getByRole("row")).toHaveCount(0);
  await expect(readout).toHaveText("00:00.00");
});

test("timer restores an in-progress run across a reload", async ({ page }) => {
  await page.goto("/timer");
  await page.getByLabel("Session title").fill("Freestyle 50s");
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Lap" }).click();

  await page.reload();

  // The run is still going and its lap survived — localStorage crash recovery.
  await expect(page.getByLabel("Session title")).toHaveValue("Freestyle 50s");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
});
