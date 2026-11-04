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
  // The switch keeps its pill shape rather than the global input box.
  await expect(social).toBeVisible();
  const box = await social.boundingBox();
  expect([box?.width, box?.height]).toEqual([50, 30]);
  await page.screenshot({ path: test.info().outputPath("switches.png") });
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
  // The bell's count drops with it, without opening the list.
  await expect(
    page.getByRole("button", { name: "Notifications, 1 new" }),
  ).toBeVisible();
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

const postId = "70000000-0000-4000-8000-000000000099";
const feedPost = {
  workoutCheckinId: postId,
  authorMembershipId: "30000000-0000-4000-8000-000000000002",
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date(Date.now() - 60_000).toISOString(),
  submittedAt: new Date(Date.now() - 60_000).toISOString(),
  reviewStatus: "verified",
  reviewClosesAt: null,
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 0,
  canReview: false,
  canVote: false,
  activityPhotoUrl:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'/>",
  presencePhotoUrl:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'/>",
  reactions: [],
  myReactions: [],
  seen: true,
};

test("tapping a post notification opens that post full screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const list = {
    ...center,
    items: [
      {
        id: 7,
        title: "Maya wrote on your workout",
        body: "Nice one",
        at: new Date(Date.now() - 60_000).toISOString(),
        unread: true,
        kind: "social",
        ref: "msg",
        post: postId,
      },
    ],
  };
  const { calls, errors } = await signIn(
    page,
    ({ path }) => {
      if (path === "/v1/home/extras")
        return homeExtras({ unreadNotifications: 1 });
      if (path === "/v1/notifications") return list;
      if (path === "/v1/proof/feed") return [feedPost];
      if (path.startsWith("/v1/notifications/")) return { done: true };
    },
    // Off Home, so the post is not already on screen (which clears it).
    "/history",
  );
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page
    .getByRole("dialog", { name: "Notifications" })
    .getByRole("button", { name: /Maya wrote on your workout/ })
    .click();
  await expect(page.getByRole("dialog", { name: /post$/ })).toBeVisible();
  await expect
    .poll(() =>
      calls
        .filter((c) => c.path === "/v1/notifications/dismiss")
        .map((c) => c.body?.ids),
    )
    .toContainEqual([7]);
  expect(errors).toEqual([]);
});

test("a device alert's link opens its post", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/notifications") return center;
    if (path === "/v1/proof/feed") return [feedPost];
  });
  await page.goto(`/home?post=${postId}`);
  await expect(page.getByRole("dialog", { name: /post$/ })).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  expect(errors).toEqual([]);
});
