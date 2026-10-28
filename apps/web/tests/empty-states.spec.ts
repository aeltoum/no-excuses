import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { friendId, membershipId, signIn } from "./member";
import { delayRoute } from "./timing";

const shots = process.env.EMPTY_SHOTS;
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'><rect width='9' height='16' fill='%23555'/></svg>";
const midnight = new Date(new Date().setHours(0, 0, 0, 0));
// Noon `daysAgo` days back; today's post sits halfway through today so far.
const at = (daysAgo: number) => {
  if (daysAgo === 0)
    return new Date((midnight.getTime() + Date.now()) / 2).toISOString();
  const day = new Date(midnight);
  day.setDate(day.getDate() - daysAgo);
  day.setHours(12);
  return day.toISOString();
};
const weekday = (daysAgo: number) => {
  const day = new Date(midnight);
  day.setDate(day.getDate() - daysAgo);
  return day.toLocaleDateString("en-US", { weekday: "short" });
};
const post = (
  n: number,
  daysAgo: number,
  extra: Record<string, unknown> = {},
) => ({
  workoutCheckinId: `71000000-0000-4000-8000-0000000000${10 + n}`,
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: at(daysAgo),
  submittedAt: at(daysAgo),
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
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  reactions: [],
  myReactions: [],
  seen: true,
  ...extra,
});
// The current week ends a few days out, so the window covers 7+ days back.
const ends = new Date(midnight);
ends.setDate(ends.getDate() + 3);
const target = (memberCount = 2) => ({
  membershipId,
  recurringTarget: 3,
  lockedTarget: 3,
  nextWeekStartsAt: ends.toISOString(),
  memberCount,
  timeZone: "UTC",
});

async function open(
  page: Page,
  feed: unknown[],
  memberCount = 2,
  progress?: unknown[],
) {
  await page.setViewportSize({ width: 390, height: 844 });
  return signIn(page, ({ path }) => {
    if (path.endsWith("/weekly-target")) return target(memberCount);
    if (path === "/v1/proof/feed") return feed;
    if (progress && path.endsWith("/current-week-progress")) return progress;
    return undefined;
  });
}
const caught = (page: Page) =>
  page.getByRole("status").filter({ hasText: "You’re caught up" });

async function noSideScroll(page: Page) {
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}
const noButtonsIn = async (page: Page, text: string) =>
  expect(
    page.locator(".feed-empty", { hasText: text }).getByRole("button"),
  ).toHaveCount(0);

test("no posts in the window shows faded outlines and a muted line, no button", async ({
  page,
}) => {
  // A post from three weeks ago is outside the window.
  const { errors } = await open(page, [post(1, 21)]);
  await expect(
    page.getByRole("heading", { name: "No posts this week or last." }),
  ).toBeVisible();
  await expect(
    page.getByText("Workouts your crew logs show up here, newest day first."),
  ).toBeVisible();
  await expect(page.locator(".feed-ghosts > span")).toHaveCount(3);
  await noButtonsIn(page, "No posts this week or last.");
  await expect(caught(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Needs you/ })).toHaveCount(0);
  await noSideScroll(page);
  await axe(page);
  if (shots) await page.screenshot({ path: `${shots}/none.png` });
  expect(errors).toEqual([]);
});

test("the caught-up divider waits for every in-scope post to be seen", async ({
  page,
}) => {
  // A questioned unseen post and an out-of-window unseen post don't count.
  const { errors } = await open(page, [
    post(1, 0, { seen: false }),
    post(2, 1),
    post(3, 2, { reviewStatus: "questioned", seen: false, canVote: true }),
    post(4, 21, { seen: false }),
  ]);
  const tile = page.getByRole("button", {
    name: /^Maya, .*, new\. Open post$/,
  });
  await expect(tile).toHaveCount(1);
  await expect(caught(page)).toHaveCount(0);
  // The tile is on screen; after the 1s dwell it's seen and the divider appears live.
  await expect(caught(page)).toBeVisible({ timeout: 5000 });
  await expect(tile).toHaveCount(0);
  // Above the day rows, no button.
  const divider = await caught(page).boundingBox();
  const rows = await page
    .getByRole("list", { name: "Posts by day" })
    .boundingBox();
  expect((divider?.y ?? 0) < (rows?.y ?? 0)).toBe(true);
  await expect(caught(page).getByRole("button")).toHaveCount(0);
  await noSideScroll(page);
  await axe(page);
  if (shots) await page.screenshot({ path: `${shots}/caught-up.png` });
  expect(errors).toEqual([]);
});

test("consecutive empty days collapse into one muted row, only between post days", async ({
  page,
}) => {
  // Posts today, 3 days ago, 4 days ago and 8 days ago; nothing yesterday or 2 days ago.
  const { errors } = await open(page, [
    post(1, 0),
    post(2, 3),
    post(3, 4),
    post(4, 8),
  ]);
  const rows = page
    .getByRole("list", { name: "Posts by day" })
    .locator(":scope > li");
  await expect(rows).toHaveCount(6);
  const gaps = page.locator(".day-gap");
  await expect(gaps).toHaveCount(2);
  await expect(gaps.nth(0)).toHaveText(`${weekday(2)}, ${weekday(1)}No posts`);
  await expect(gaps.nth(1)).toHaveText(`${weekday(7)} – ${weekday(5)}No posts`);
  // Order: Today, gap, day, day, gap, day. No gap before the first or after today.
  await expect(rows.nth(0)).toHaveClass(/day-row/);
  await expect(rows.nth(1)).toHaveClass(/day-gap/);
  await expect(rows.nth(2)).toHaveClass(/day-row/);
  await expect(rows.nth(3)).toHaveClass(/day-row/);
  await expect(rows.nth(4)).toHaveClass(/day-gap/);
  await expect(rows.nth(5)).toHaveClass(/day-row/);
  await expect(gaps.getByRole("button")).toHaveCount(0);
  await noSideScroll(page);
  await axe(page);
  if (shots)
    await page.screenshot({ path: `${shots}/gaps.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("a member alone in their Group sees only the solo line beside the waiting block", async ({
  page,
}) => {
  const { errors } = await open(page, [], 1, []);
  await expect(
    page.getByRole("heading", { name: "Waiting for a second member" }),
  ).toBeVisible();
  await expect(page.getByText("Your crew’s posts land here.")).toBeVisible();
  await expect(page.getByText("No posts this week or last.")).toHaveCount(0);
  await expect(page.locator(".feed-ghosts")).toHaveCount(0);
  await noButtonsIn(page, "Your crew’s posts land here.");
  await noSideScroll(page);
  await axe(page);
  if (shots) await page.screenshot({ path: `${shots}/solo.png` });
  expect(errors).toEqual([]);
});

test("a lone member with a progress row gets the solo line in the feed", async ({
  page,
}) => {
  await open(page, [], 1);
  await expect(page.getByText("Your crew’s posts land here.")).toBeVisible();
  await expect(page.getByText("No posts this week or last.")).toHaveCount(0);
  await expect(page.locator(".feed-ghosts")).toHaveCount(0);
});

test("the loading placeholder still shows at once and holds its space", async ({
  page,
}) => {
  await open(page, []);
  await expect(page.getByText("No posts this week or last.")).toBeVisible();
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
  // The empty state replaces it only once the feed answers.
  await expect(page.getByText("No posts this week or last.")).toHaveCount(0);
  await expect(page.getByText("No posts this week or last.")).toBeVisible();
  await expect(placeholder).toHaveCount(0);
  await undo();
});
