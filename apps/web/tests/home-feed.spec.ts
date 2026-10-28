import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { friendId, homeExtras, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const shots = process.env.FEED_SHOTS;
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'><rect width='9' height='16' fill='%23555'/></svg>";
const hours = (value: number) =>
  new Date(Date.now() - value * 3_600_000).toISOString();
const post = (id: string, overrides: Record<string, unknown>) => ({
  workoutCheckinId: `70000000-0000-4000-8000-00000000000${id}`,
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: hours(1),
  submittedAt: hours(1),
  reviewStatus: "verified",
  reviewClosesAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 0,
  canReview: true,
  canVote: false,
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  reactions: [],
  myReactions: [],
  ...overrides,
});

// Today's posts sit on one local day however early the test runs.
const sinceMidnight =
  (Date.now() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) /
  3_600_000;
const feed = [
  post("1", { authorName: "Maya", submittedAt: hours(sinceMidnight * 0.75) }),
  post("2", {
    authorName: "Jordan",
    activityType: "cardio",
    durationMinutes: 30,
    submittedAt: hours(sinceMidnight * 0.25),
  }),
  post("3", { authorName: "Sam", submittedAt: hours(sinceMidnight + 12) }),
  // Last accountability week: still on Home.
  post("4", { authorName: "Riley", submittedAt: hours(8 * 24) }),
  // Two weeks back: the Wall keeps it, Home does not.
  post("5", { authorName: "Old", submittedAt: hours(13 * 24) }),
  post("6", {
    authorName: "Casey",
    submittedAt: hours(3),
    reviewStatus: "questioned",
    reviewClosesAt: null,
    decisionClosesAt: new Date(Date.now() + 30 * 3_600_000).toISOString(),
    acceptVotes: 1,
    eligibleVoters: 3,
    canReview: false,
    canVote: true,
  }),
  // Listed in Needs you without waiting on the viewer: their own, and one already voted.
  post("7", {
    authorName: "Akrum",
    mine: true,
    submittedAt: hours(5),
    reviewStatus: "questioned",
    reviewClosesAt: null,
    decisionClosesAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
    eligibleVoters: 1,
    canReview: false,
  }),
  post("8", {
    authorName: "Dana",
    submittedAt: hours(6),
    reviewStatus: "questioned",
    reviewClosesAt: null,
    decisionClosesAt: new Date(Date.now() + 10 * 3_600_000).toISOString(),
    myVote: "accept",
    acceptVotes: 1,
    eligibleVoters: 3,
    canReview: false,
    canVote: true,
  }),
];
const target = {
  membershipId: "30000000-0000-4000-8000-000000000001",
  recurringTarget: 3,
  lockedTarget: 3,
  nextWeekStartsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  memberCount: 2,
  timeZone: "UTC",
};

const noSideScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

test("Home shows day rows, Needs you, and posts full screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failVote = true;
  const votes: string[] = [];
  const { errors } = await signIn(page, ({ path, body }) => {
    if (path.endsWith("/weekly-target")) return target;
    if (path === "/v1/proof/feed")
      return feed.map((item) =>
        votes.length > 0 && item.authorName === "Casey"
          ? { ...item, myVote: votes[0], rejectVotes: 1 }
          : item,
      );
    if (path.endsWith("/vote")) {
      if (failVote) {
        failVote = false;
        return 500;
      }
      votes.push(String(body?.choice));
      return { status: "ok" };
    }
    return undefined;
  });

  // Rows: newest day first, newest post first, current and last week only.
  const rows = page.getByRole("list", { name: "Posts by day" });
  await expect(rows.getByRole("heading")).toHaveText([
    "Today2 posts",
    "Yesterday1 post",
    /^.+1 post$/,
  ]);
  expect(
    await page
      .getByRole("list", { name: "Today posts" })
      .getByRole("button")
      .evaluateAll((tiles) => tiles.map((tile) => tile.ariaLabel)),
  ).toEqual([
    "Jordan, Cardio · 30 min. Open post",
    "Maya, Strength · 45 min. Open post",
  ]);
  await expect(rows.getByRole("button", { name: /^Riley/ })).toBeVisible();
  await expect(rows.getByRole("button", { name: /^Old/ })).toHaveCount(0);
  // Questioned posts leave the rows for Needs you.
  await expect(rows.getByRole("button", { name: /^Casey/ })).toHaveCount(0);
  const tile = await rows
    .getByRole("button", { name: /^Jordan/ })
    .boundingBox();
  expect((tile?.height ?? 0) / (tile?.width ?? 1)).toBeCloseTo(16 / 9, 1);

  // Needs you: count, the questioned post with its tally, and collapse.
  const toggle = page.getByRole("button", { name: /^Needs you/ });
  await expect(toggle).toHaveAccessibleName("Needs you 1 waiting");
  // The count matches the Home tab: only Casey's vote waits on the viewer.
  await expect(page.getByRole("link", { name: /^Home/ })).toHaveAccessibleName(
    "Home 1 waiting on you",
  );
  await expect(page.locator(".needs-post")).toHaveCount(3);
  await expect(
    page.locator(".needs-post").filter({ hasText: "Your strength" }),
  ).toContainText("Withdraw report");
  await expect(
    page.locator(".needs-post").filter({ hasText: "Dana" }),
  ).toContainText("You voted accept.");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const casey = page.locator(".needs-post").filter({ hasText: "Casey" });
  await expect(casey).toContainText("Casey’s strength was questioned");
  await expect(
    casey.getByRole("img", { name: "1 accept, 0 reject, 2 still to vote" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["serious", "critical"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
  expect(await noSideScroll(page)).toBe(true);
  if (shots)
    await page.screenshot({ path: `${shots}/home-needs-expanded.png` });

  // Votes are optimistic: the result shows at once, a failure rolls it back.
  const undoDelay = await delayRoute(
    page,
    "http://127.0.0.1:8787/v1/proof/*/vote",
    1000,
  );
  const voteMs = await msUntilVisible(
    page,
    () => casey.getByRole("button", { name: "Reject workout" }).click(),
    page.getByText("Vote saved: reject."),
  );
  testInfo.annotations.push({ type: "vote ms", description: String(voteMs) });
  expect(voteMs).toBeLessThanOrEqual(100);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(toggle).toHaveAccessibleName("Needs you 1 waiting");
  await expect(
    casey.getByRole("button", { name: "Reject workout" }),
  ).toBeVisible();
  await expect(casey).toContainText("Accept 1 · Reject 0 of 3 voters");
  await undoDelay();
  await casey.getByRole("button", { name: "Reject workout" }).click();
  await expect(casey).toContainText("You voted reject.");
  await expect(
    page.getByRole("button", { name: /^Needs you/ }),
  ).toHaveAccessibleName("Needs you");
  expect(votes).toEqual(["reject"]);

  // Collapse hides the body and is remembered on this device.
  const collapseMs = await msUntilVisible(
    page,
    () => toggle.click(),
    page.locator(".needs-you-panel:not(.is-open)"),
  );
  testInfo.annotations.push({
    type: "collapse ms",
    description: String(collapseMs),
  });
  expect(collapseMs).toBeLessThanOrEqual(100);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(casey).toHaveCount(0);
  if (shots) {
    // Let the chevron's turn finish before the evidence shot.
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${shots}/home-needs-collapsed.png` });
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Needs you/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /^Needs you/ }).click();
  await expect(page.locator(".needs-post")).toHaveCount(3);

  // A tile opens the post full screen, with its actions, and closes back.
  const jordan = page.getByRole("button", { name: /^Jordan/ });
  const openMs = await msUntilVisible(
    page,
    () => jordan.click(),
    page.getByRole("dialog", { name: "Jordan’s post" }),
  );
  testInfo.annotations.push({ type: "open ms", description: String(openMs) });
  expect(openMs).toBeLessThanOrEqual(100);
  const viewer = page.getByRole("dialog", { name: "Jordan’s post" });
  await expect(
    viewer.getByRole("img", { name: "Jordan's workout activity" }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Question workout · 5h left" }),
  ).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Comment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close post" })).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include(".post-viewer").analyze())
      .violations,
  ).toEqual([]);
  if (shots) await page.screenshot({ path: `${shots}/post-full-screen.png` });
  // Focus stays in the open post, both ways round.
  for (const key of ["Tab", "Shift+Tab"])
    for (let step = 0; step < 25; step++) {
      await page.keyboard.press(key);
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest(".post-viewer")),
        ),
      ).toBe(true);
    }
  // A sheet opened from the post still takes focus.
  await viewer.getByRole("button", { name: "Add reaction" }).click();
  const picker = page.locator(".sheet");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest(".sheet")),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(jordan).toBeFocused();

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await noSideScroll(page)).toBe(true);
    // Scrolled to the end, the last row's captions clear the Log button.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const log = await page.locator(".home-log-button").boundingBox();
    const captions = page.locator(".day-row").last().locator(".day-tile-cap");
    for (const caption of await captions.all()) {
      const box = await caption.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        log?.y ?? 0,
      );
    }
  }
  if (shots) await page.screenshot({ path: `${shots}/home-360-bottom.png` });
  expect(errors.filter((text) => !text.includes("status of 500"))).toEqual([]);
});

test("Needs you hides when empty and the feed holds its space while loading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ({ path }) => {
    if (path.endsWith("/weekly-target")) return target;
    if (path === "/v1/proof/feed")
      return feed.filter((item) => item.reviewStatus !== "questioned");
    if (path === "/v1/home/extras") return homeExtras();
    return undefined;
  });
  await expect(page.getByRole("list", { name: "Posts by day" })).toBeVisible();
  // A cold start on a slow API: the placeholder shows at once and holds its space.
  await page.evaluate(() => localStorage.removeItem("no-excuses:cache:feed"));
  const undo = await delayRoute(
    page,
    "http://127.0.0.1:8787/v1/proof/feed",
    1000,
  );
  await page.reload();
  const placeholder = page.getByRole("status", { name: "Loading posts" });
  await expect(placeholder).toBeVisible();
  expect((await placeholder.boundingBox())?.height ?? 0).toBeGreaterThan(200);
  await expect(page.getByRole("list", { name: "Posts by day" })).toBeVisible();
  await undo();
  await expect(page.getByRole("button", { name: /^Needs you/ })).toHaveCount(0);
});

test("Home says so when nobody has posted", async ({ page }) => {
  await signIn(page, ({ path }) =>
    path.endsWith("/weekly-target") ? target : undefined,
  );
  await expect(page.getByText("No posts this week or last.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Needs you/ })).toHaveCount(0);
});
