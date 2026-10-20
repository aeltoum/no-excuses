import { expect, test } from "@playwright/test";
import { homeExtras, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const center = {
  items: [
    {
      id: 2,
      title: "Maya nudged you",
      body: "You are behind this week. No excuses.",
      at: new Date(Date.now() - 5 * 60_000).toISOString(),
      unread: true,
      kind: "social",
    },
    {
      id: 1,
      title: "Week Met",
      body: "Target hit. Keep it going.",
      at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      unread: false,
      kind: "result",
    },
  ],
  prefs: { socialPush: true, digest: true, digestHour: 19 },
};

test("the bell lists notifications at once and marks them seen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls, errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/home/extras")
      return homeExtras({ unreadNotifications: 1 });
    if (path === "/v1/notifications") return center;
    if (path === "/v1/notifications/seen") return { seen: true };
  });
  const bell = page.getByRole("button", { name: "Notifications, 1 new" });
  await expect(bell).toBeVisible();
  await delayRoute(page, "**/v1/notifications", 1000);
  const shown = await msUntilVisible(
    page,
    () => bell.click(),
    page
      .getByRole("dialog", { name: "Notifications" })
      .locator(".skeleton")
      .first(),
  );
  expect(shown).toBeLessThanOrEqual(100);
  await expect(page.getByText("Maya nudged you")).toBeVisible();
  await expect(page.getByText("5m")).toBeVisible();
  await expect
    .poll(() => calls.some((c) => c.path === "/v1/notifications/seen"))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Notifications" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Account mutes social pushes and moves the digest, instantly", async ({
  page,
}) => {
  let fail = true;
  const { calls } = await signIn(
    page,
    ({ path, body }) => {
      if (path === "/v1/notifications") return center;
      if (path === "/v1/notifications/prefs") {
        if (fail) {
          fail = false;
          return 500;
        }
        return { ...center.prefs, ...body };
      }
    },
    "/account",
  );
  await page.getByRole("button", { name: "Notification settings" }).click();
  const social = page.getByLabel(/Push reactions, nudges, and cheers/);
  // The mocked failure can roll back before uncheck() would re-read the box.
  await social.click();
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(social).toBeChecked();
  await social.uncheck();
  await expect(social).not.toBeChecked();
  await page.getByLabel("Digest time").selectOption("7");
  await expect
    .poll(() =>
      calls
        .filter((c) => c.path === "/v1/notifications/prefs")
        .map((c) => c.body),
    )
    .toEqual([{ socialPush: false }, { socialPush: false }, { digestHour: 7 }]);
});
