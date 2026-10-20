import { expect, test } from "@playwright/test";
import { friendId, homeExtras, membershipId, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const endsAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
const maya = {
  memberWeekId: "60000000-0000-4000-8000-000000000009",
  membershipId: friendId,
  name: "Maya",
  mine: false,
  met: true,
  completed: 3,
  target: 3,
  activityTypes: ["strength", "cardio", "sport"],
  endsAt,
  reactions: [{ emoji: "🔥", count: 1 }],
  myReaction: null,
};
const mine = {
  ...maya,
  memberWeekId: "60000000-0000-4000-8000-000000000010",
  membershipId,
  name: "Akrum",
  mine: true,
  met: false,
  completed: 1,
  target: 3,
  activityTypes: ["cardio"],
  reactions: [],
};

test("the day after a week, any emoji reacts to a result, instantly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/home/extras") return homeExtras({ recap: [maya, mine] });
    if (path.endsWith("/react")) {
      if (fail) {
        fail = false;
        return 500;
      }
      return homeExtras({
        recap: [
          {
            ...maya,
            myReaction: body?.emoji,
            reactions: [{ emoji: body?.emoji, count: 2 }],
          },
          mine,
        ],
      });
    }
  });
  const recap = page.getByRole("region", { name: "Last week" });
  await expect(recap).toContainText("Met 3/3");
  await expect(recap).toContainText("Missed 1/3");
  await expect(recap).toContainText(/Clears in \d+h/);

  // A failed reaction rolls back.
  const chips = recap.getByRole("group", { name: "React to Maya’s week" });
  await chips.getByRole("button", { name: "🔥, 1" }).click();
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(chips.getByRole("button", { name: "🔥, 1" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Any emoji, not a preset: the picker opens and the pick shows at once.
  await delayRoute(page, "**/v1/recap/**", 1000);
  await chips
    .getByRole("button", { name: "React to Maya’s week with any emoji" })
    .click();
  const sheet = page.getByRole("dialog", { name: "React to Maya" });
  const shown = await msUntilVisible(
    page,
    () => sheet.getByRole("button", { name: "React 🐐" }).click(),
    chips.getByRole("button", { name: "🐐, 1" }),
  );
  expect(shown).toBeLessThanOrEqual(100);
  await expect
    .poll(() => calls.filter((c) => c.path.endsWith("/react")).at(-1)?.body)
    .toEqual({ emoji: "🐐" });
  expect(errors).toEqual([]);
});

test("a recap past its day stays hidden", async ({ page }) => {
  await signIn(page, ({ path }) =>
    path === "/v1/home/extras"
      ? homeExtras({
          recap: [
            {
              ...maya,
              endsAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
            },
          ],
        })
      : undefined,
  );
  await expect(page.getByText(/this week/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Last week" })).toHaveCount(0);
});

test("Home is phone-fixed: no sideways scroll, no text selection, key under the bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page, ({ path }) =>
    path === "/v1/home/extras"
      ? homeExtras({ recap: [maya, mine], unreadNotifications: 2 })
      : path === "/v1/notifications"
        ? {
            items: [
              {
                id: 1,
                title:
                  "Akrum Phone finished 150 air squats with a very long title",
                body: "Approve it if you trust it happened.",
                at: new Date().toISOString(),
                unread: true,
                kind: "workout",
              },
            ],
            prefs: { socialPush: true, digest: true, digestHour: 19 },
          }
        : undefined,
  );
  await expect(page.getByRole("region", { name: "Last week" })).toBeVisible();
  const overflow = () =>
    page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("body *")]
        .filter((node) => node.getBoundingClientRect().right > width + 1)
        .map((node) => node.className || node.tagName);
      return {
        scroll: document.documentElement.scrollWidth - width,
        wide: wide.slice(0, 5),
      };
    });
  expect(await overflow()).toEqual({ scroll: 0, wide: [] });
  expect(
    await page.evaluate(() => getComputedStyle(document.body).userSelect),
  ).toBe("none");

  const bar = await page.locator(".own-progress .barbell-big").boundingBox();
  const key = await page
    .getByRole("list", { name: "Activity colours" })
    .boundingBox();
  const count = await page.getByText(/of 3 this week/).boundingBox();
  expect(bar && key && count).toBeTruthy();
  if (bar && key && count) {
    expect(key.y).toBeGreaterThan(bar.y + bar.height - 1);
    expect(key.y).toBeLessThan(count.y);
  }

  await page.getByRole("button", { name: /Notifications/ }).click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toContainText("very long title");
  const box = await sheet.boundingBox();
  const close = await sheet
    .getByRole("button", { name: /Close/ })
    .boundingBox();
  expect(box && close).toBeTruthy();
  if (box && close) {
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(close.x + close.width).toBeLessThanOrEqual(360);
  }
  expect(await overflow()).toEqual({ scroll: 0, wide: [] });
});
