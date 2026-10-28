import { expect, type Page, test } from "@playwright/test";
import { friendId, openHome, openPost, progressItem, signIn } from "./member";

const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const post = (overrides: Record<string, unknown> = {}) => ({
  workoutCheckinId: "70000000-0000-4000-8000-000000000009",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date().toISOString(),
  submittedAt: new Date().toISOString(),
  reviewStatus: "accepted",
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
  ...overrides,
});
const friendsAt = (count: number) => [
  progressItem(),
  progressItem({
    membershipId: friendId,
    displayName: "Maya",
    completedWorkoutCount: count,
  }),
];

// Backgrounds the app (phone locked, another app opened) and brings it back.
async function leaveAndReturn(page: Page) {
  for (const state of ["hidden", "visible"])
    await page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => value,
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => value === "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
}

test("returning to the app shows friends' new progress and posts without a reload", async ({
  page,
}, info) => {
  let maya = 2;
  let feed: unknown[] = [];
  const { errors } = await signIn(
    page,
    ({ path }) =>
      path.endsWith("/current-week-progress")
        ? friendsAt(maya)
        : path === "/v1/proof/feed"
          ? feed
          : undefined,
    "/week",
  );
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends).toContainText("2 of 3 workouts");
  maya = 3;
  feed = [post()];
  await leaveAndReturn(page);
  await expect(friends).toContainText("3 of 3 workouts");
  await openHome(page);
  await expect(page.getByRole("button", { name: /^Maya,/ })).toBeVisible();
  // No loading state replaces what was already on screen.
  await expect(page.getByRole("status", { name: /Loading/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("resume.png") });
  expect(errors).toEqual([]);
});

test("an open Home picks up friends' activity on its own", async ({
  page,
}, info) => {
  await page.clock.install();
  let maya = 2;
  await signIn(
    page,
    ({ path }) =>
      path.endsWith("/current-week-progress") ? friendsAt(maya) : undefined,
    "/week",
  );
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends).toContainText("2 of 3 workouts");
  maya = 3;
  await page.clock.runFor(60_000);
  await expect(friends).toContainText("3 of 3 workouts");
  await page.screenshot({ path: info.outputPath("poll.png") });
});

test("a token that expired in the background refreshes Home without an access check", async ({
  page,
}, info) => {
  await page.clock.install();
  let maya = 2;
  // A real one-hour token, so the client knows when it expires.
  await signIn(
    page,
    ({ path }) =>
      path.endsWith("/current-week-progress") ? friendsAt(maya) : undefined,
    "/week",
    { expires_at: undefined },
  );
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends).toContainText("2 of 3 workouts");
  // Auth issues a fresh token on return; the API now rejects the old one.
  let expired = false;
  const rejected: string[] = [];
  await page.route("http://127.0.0.1:54321/auth/v1/token**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        access_token: "fresh-access",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "next-refresh",
        user: { id: "20000000-0000-4000-8000-000000000001" },
      },
    }),
  );
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
    if (
      expired &&
      route.request().headers().authorization === "Bearer live-access"
    ) {
      rejected.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 401, json: {} });
    }
    return route.fallback();
  });
  await page.evaluate(() => {
    const flag = window as Window & { sawCheck?: boolean };
    new MutationObserver(() => {
      if (document.body.textContent?.includes("Checking your access"))
        flag.sawCheck = true;
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward("02:00:00");
  expired = true;
  maya = 3;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(friends).toContainText("3 of 3 workouts");
  await page.clock.runFor(5_000);
  await expect(friends).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { sawCheck?: boolean }).sawCheck ?? false,
    ),
  ).toBe(false);
  expect(rejected).toEqual([]);
  await page.screenshot({ path: info.outputPath("expired.png") });
});

test("a reaction tapped while a background reload is in flight stays", async ({
  page,
}, info) => {
  let mine: string[] = [];
  const feed = () => [
    post({
      reactions: [{ emoji: "🔥", count: 2 + mine.length }],
      myReactions: [...mine],
    }),
  ];
  let reacted = false;
  await signIn(page, ({ path, body }) => {
    if (path.endsWith("/react")) {
      mine = body?.on ? ["🔥"] : [];
      reacted = true;
      return { emoji: "🔥", on: Boolean(body?.on) };
    }
    return path === "/v1/proof/feed" ? feed() : undefined;
  });
  await openPost(page, "Maya");
  const fire = page.getByRole("button", { name: /^🔥, \d/ }).first();
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  // The reload reads the server before the tap and answers after it lands.
  let answer = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("http://127.0.0.1:8787/v1/proof/feed", async (route) => {
    const before = feed();
    await held;
    await route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: before },
    });
  });
  const reload = page.waitForRequest("http://127.0.0.1:8787/v1/proof/feed");
  await leaveAndReturn(page);
  await reload;
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page.getByRole("button", { name: "React 🔥" }).click();
  await expect(fire).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => reacted).toBe(true);
  const landed = page.waitForResponse("http://127.0.0.1:8787/v1/proof/feed");
  answer();
  await landed;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  await expect(fire).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("reaction.png") });
});

test("a focus refresh restarts the minute instead of stretching it", async ({
  page,
}) => {
  await page.clock.install();
  const { calls } = await signIn(page, undefined, "/week");
  await expect(
    page.getByRole("list", { name: "Friends this week" }),
  ).toBeVisible();
  const polls = () =>
    calls.filter((call) => call.path.endsWith("/current-week-progress")).length;
  // Reloads run on a minute from app start. Focus five seconds before one is
  // due, then let time move only when the test says.
  const started = await page.evaluate(() => Date.now() - performance.now());
  await page.clock.pauseAt(started + 55_000);
  const focusReload = page.waitForResponse(/current-week-progress/);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await focusReload;
  await page.clock.runFor(1_000);
  const afterFocus = polls();
  // The next automatic reload comes a minute after the focus one, not later.
  await page.clock.runFor(59_500);
  await expect.poll(polls).toBeGreaterThan(afterFocus);
});

test("a reload dropped for an overlapping write runs again at once", async ({
  page,
}) => {
  let mine: string[] = [];
  let posts = 1;
  const feed = () => [
    post({
      reactions: [{ emoji: "🔥", count: 2 + mine.length }],
      myReactions: [...mine],
    }),
    ...(posts > 1
      ? [
          post({
            workoutCheckinId: "70000000-0000-4000-8000-000000000010",
            activityType: "cardio",
          }),
        ]
      : []),
  ];
  await signIn(page, ({ path, body }) => {
    if (path.endsWith("/react")) {
      mine = body?.on ? ["🔥"] : [];
      return { emoji: "🔥", on: Boolean(body?.on) };
    }
    return path === "/v1/proof/feed" ? feed() : undefined;
  });
  await openPost(page, "Maya");
  const fire = page.getByRole("button", { name: /^🔥, \d/ }).first();
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  let answer = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  let first = true;
  await page.route("http://127.0.0.1:8787/v1/proof/feed", async (route) => {
    if (!first) return route.fallback();
    first = false;
    const before = feed();
    await held;
    await route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: before },
    });
  });
  const reload = page.waitForRequest("http://127.0.0.1:8787/v1/proof/feed");
  await leaveAndReturn(page);
  await reload;
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page.getByRole("button", { name: "React 🔥" }).click();
  await expect(fire).toHaveAttribute("aria-pressed", "true");
  // Maya posts again meanwhile; the dropped reload must not hide it for a minute.
  posts = 2;
  answer();
  await expect(
    page
      .getByRole("list", { name: "Posts by day" })
      .getByRole("button", { name: /^Maya,/ }),
  ).toHaveCount(2);
  await expect(fire).toHaveAttribute("aria-pressed", "true");
});
