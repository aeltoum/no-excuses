import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { homeExtras } from "./member";

const membershipId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const pendingId = "70000000-0000-4000-8000-000000000001";
const questionedId = "70000000-0000-4000-8000-000000000002";
const session = {
  access_token: "live-access",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1999999999,
  refresh_token: "refresh",
  user: {
    id: "20000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-12T00:00:00Z",
  },
};
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
const item = (overrides: Record<string, unknown>) => ({
  workoutCheckinId: pendingId,
  authorMembershipId: friendMembershipId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: "2026-10-12T15:00:00.000Z",
  submittedAt: "2026-10-12T15:05:00.000Z",
  reviewStatus: "pending",
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

let answerReview = () => {};
const releaseReview = new Promise<void>((resolve) => {
  answerReview = resolve;
});

test("Home feed reviews, votes on, and reports friends' proof", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const actions: string[] = [];
  let failNextVote = true;
  let feed = [
    item({}),
    item({
      workoutCheckinId: questionedId,
      authorName: "Jordan",
      reviewStatus: "questioned",
      reviewClosesAt: null,
      decisionClosesAt: new Date(Date.now() + 30 * 3_600_000).toISOString(),
      acceptVotes: 1,
      rejectVotes: 0,
      eligibleVoters: 3,
      canReview: false,
      canVote: true,
    }),
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(request.headers().authorization).toBe("Bearer live-access");
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({ membership: { groupId, membershipId } });
    if (path.endsWith("/current-week-progress"))
      return ok([
        {
          membershipId,
          displayName: "Akrum",
          lockedTarget: 3,
          completedWorkoutCount: 1,
          activityTypes: ["cardio"],
          targetStreak: 1,
          workoutStreak: 3,
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 3,
          completedWorkoutCount: 2,
          activityTypes: ["strength", "class"],
          targetStreak: 1,
          workoutStreak: 3,
        },
      ]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path.endsWith("/weekly-target"))
      return ok({
        membershipId,
        recurringTarget: 3,
        lockedTarget: 3,
        nextWeekStartsAt: null,
        memberCount: 2,
        timeZone: "America/Chicago",
      });
    if (path === "/v1/proof/feed") return ok(feed);
    if (path === "/v1/nudges") return ok([]);
    if (path === "/v1/consequences")
      return ok({
        owed: 0,
        offer: null,
        attempt: null,
        reviews: [],
        groupOwed: {},
      });
    const action = /^\/v1\/proof\/([^/]+)\/(\w+)$/.exec(path);
    if (action) {
      const choice = request.postDataJSON().choice;
      // Like a cold API: the reply lags well behind the tap.
      if (action[2] === "review") await releaseReview;
      if (action[2] === "vote" && failNextVote) {
        failNextVote = false;
        return route.fulfill({ status: 500, json: {} });
      }
      actions.push(`${action[2]}:${choice}`);
      if (action[2] === "review")
        feed = feed.map((entry) =>
          entry.workoutCheckinId === action[1]
            ? { ...entry, reviewStatus: "verified", canReview: false }
            : entry,
        );
      if (action[2] === "vote")
        feed = feed.map((entry) =>
          entry.workoutCheckinId === action[1]
            ? { ...entry, myVote: choice, rejectVotes: 1 }
            : entry,
        );
      if (action[2] === "report")
        feed = feed.filter((entry) => entry.workoutCheckinId !== action[1]);
      return ok({ workoutCheckinId: action[1], status: "ok" });
    }
    if (path === "/v1/home/extras")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: homeExtras() },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  await expect(
    page.getByRole("heading", { name: "Needs your review" }),
  ).toBeVisible();
  const homeTab = page.getByRole("link", { name: /^Home/ });
  await expect(homeTab).toHaveAccessibleName("Home 2 waiting on you");
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends.getByRole("listitem")).toHaveText([
    "Maya2/3 · review🔥 1 wk1-week streak · 3 workouts since last missNudge",
  ]);
  await expect(
    page.getByRole("img", { name: "1 of 3 workouts" }),
  ).toBeVisible();
  const dock = page.locator(".week-dock");
  await expect(dock).not.toHaveClass(/\bon\b/);
  await page
    .getByRole("img", { name: "Maya at the workout" })
    .scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 900);
  await expect(dock).toHaveClass(/\bon\b/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(dock).not.toHaveClass(/\bon\b/);
  await expect(
    page.getByRole("img", { name: "Maya at the workout" }),
  ).toBeVisible();
  await expect(page.getByText("Review · 5h left")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["serious", "critical"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("wall-review.png"),
  });

  // Both posts carry a light box: the pending review first, then the vote.
  await expect(page.getByRole("group", { name: "Review" })).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Your vote" })).toHaveCount(1);
  await page.getByRole("button", { name: "Good lift" }).first().click();
  // The choice disappears on tap, before the API answers.
  await expect(page.getByRole("group", { name: "Review" })).toHaveCount(0);
  // Outcome shows at once, while the API is still answering.
  await expect(page.getByRole("status")).toHaveText("Good lift. Verified.");
  await expect(page.getByText("Verified ✓", { exact: true })).toBeVisible();
  answerReview();
  // A made choice takes its buttons with it.
  await expect(page.getByRole("group", { name: "Review" })).toHaveCount(0);

  await expect(page.getByText("Accept 1 · Reject 0 of 3 voters")).toBeVisible();
  // A failed vote rolls back: the buttons and counts return with an error.
  await page.getByRole("button", { name: "No lift" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(page.getByText("Accept 1 · Reject 0 of 3 voters")).toBeVisible();
  await page.getByRole("button", { name: "No lift" }).click();
  await expect(page.getByRole("status")).toHaveText("No lift. Vote saved.");
  await expect(page.getByRole("button", { name: "No lift" })).toHaveCount(0);

  await page.getByRole("button", { name: "Report photos" }).first().click();
  await page
    .getByRole("dialog", { name: "Report these photos?" })
    .getByRole("button", { name: "Report photos" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Reported. The photos are hidden.",
  );
  expect(actions).toEqual(["review:verify", "vote:reject", "report:"]);
  // The reported post leaves the feed, so nothing is left waiting on the member.
  await expect(homeTab).toHaveAccessibleName("Home");
  // Only the deliberately failed vote may log.
  expect(errors.filter((text) => !text.includes("status of 500"))).toEqual([]);
});
