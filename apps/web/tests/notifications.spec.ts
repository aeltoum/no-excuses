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
    if (path === "/v1/notifications/clear") return { cleared: true };
  });
  const bell = page.getByRole("button", { name: "Notifications, 1 new" });
  await expect(bell).toBeVisible();
  // New activity loads the list ahead of the tap, so it opens already filled.
  await expect
    .poll(() => calls.some((c) => c.path === "/v1/notifications"))
    .toBe(true);
  await delayRoute(page, "**/v1/notifications", 1000);
  const shown = await msUntilVisible(
    page,
    () => bell.click(),
    page.getByText("Maya nudged you"),
  );
  expect(shown).toBeLessThanOrEqual(100);
  await expect(page.getByText("5m")).toBeVisible();
  await expect
    .poll(() => calls.some((c) => c.path === "/v1/notifications/seen"))
    .toBe(true);
  // Clear all empties the list at once.
  await delayRoute(page, "**/v1/notifications/clear", 1000);
  const cleared = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Clear all" }).click(),
    page.getByText("Nothing yet. Activity from your Group shows here."),
  );
  expect(cleared).toBeLessThanOrEqual(100);
  await expect
    .poll(() => calls.some((c) => c.path === "/v1/notifications/clear"))
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

test("opening a notification goes to its subject; seeing a subject clears it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = {
    ...center,
    items: [
      {
        id: 5,
        title: "Week Met",
        body: "Target hit. Keep it going.",
        at: new Date(Date.now() - 60_000).toISOString(),
        unread: true,
        kind: "result",
        ref: "60000000-0000-4000-8000-000000000010",
      },
      {
        id: 4,
        title: "Less than 24 hours left",
        body: "You have 1 of 3 workouts.",
        at: new Date(Date.now() - 120_000).toISOString(),
        unread: true,
        kind: "reminder",
        ref: "60000000-0000-4000-8000-000000000010",
      },
    ],
  };
  const { calls, errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/home/extras")
      return homeExtras({ unreadNotifications: 2 });
    if (path === "/v1/notifications") return list;
    if (path.startsWith("/v1/notifications/")) return { done: true };
  });
  // Home is the reminder's subject, so being here clears it.
  await expect
    .poll(
      () =>
        calls.find((c) => c.path === "/v1/notifications/dismiss")?.body?.ids,
    )
    .toEqual([4]);
  await page.getByRole("button", { name: /Notifications/ }).click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet.getByText("Less than 24 hours left")).toHaveCount(0);
  await expect(sheet.getByText("1 notification")).toBeVisible();
  // Tapping the result opens History and clears it.
  await sheet.getByRole("button", { name: /Week Met/ }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect
    .poll(() =>
      calls
        .filter((c) => c.path === "/v1/notifications/dismiss")
        .map((c) => c.body?.ids),
    )
    .toContainEqual([5]);
  expect(errors).toEqual([]);
});
