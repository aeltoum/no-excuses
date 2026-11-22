import { expect, test } from "@playwright/test";
import { homeExtras, membershipId, openWeek, signIn } from "./member";

test("a Group pause stops the Week countdown and says why", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const since = new Date(Date.now() - 2 * 3_600_000);
  // At the pause, 1 day 4 hours 30 minutes were left.
  const endsAt = new Date(since.getTime() + (28 * 60 + 30) * 60_000);
  const { errors } = await signIn(page, ({ path }) => {
    if (path.endsWith("/weekly-target"))
      return {
        membershipId,
        recurringTarget: 3,
        lockedTarget: 3,
        nextWeekStartsAt: endsAt.toISOString(),
        memberCount: 2,
        timeZone: "UTC",
      };
    if (path === "/v1/home/extras")
      return homeExtras({
        safety: { conductAccepted: true, blocked: [] },
        groupPause: { since: since.toISOString(), reason: "Upload outage" },
      });
  });
  await openWeek(page);
  const title = page.getByRole("heading", {
    level: 1,
    name: "Week paused with 1:04:30:00 left",
  });
  await expect(title).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(title).toHaveText(/1:04:30:00/);
  await expect(title).toBeVisible();
  await expect(page.getByText(/Week paused: Upload outage\./)).toBeVisible();
  await page.screenshot({ path: "test-results/group-pause-week.png" });
  expect(errors).toEqual([]);
});
