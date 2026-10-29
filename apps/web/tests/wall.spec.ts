import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { closePost, homeExtras, openHome, openPost, openWeek } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const membershipId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const recentId = "70000000-0000-4000-8000-000000000001";
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
  workoutCheckinId: recentId,
  authorMembershipId: friendMembershipId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: "2026-10-12T15:00:00.000Z",
  submittedAt: "2026-10-12T15:05:00.000Z",
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

let answerReview = () => {};
const releaseReview = new Promise<void>((resolve) => {
  answerReview = resolve;
});

test("Home feed questions, votes on, and reports friends' proof", async ({
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
            ? {
                ...entry,
                reviewStatus: "questioned",
                reviewClosesAt: null,
                decisionClosesAt: new Date(
                  Date.now() + 48 * 3_600_000,
                ).toISOString(),
                eligibleVoters: 2,
                canReview: false,
              }
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
  // Posts count on submit: only the Group decision waits on the viewer.
  await expect(
    page.getByRole("button", { name: "Needs you 1 waiting" }),
  ).toBeVisible();
  const homeTab = page.getByRole("link", { name: /^Home/ });
  await expect(homeTab).toHaveAccessibleName("Home 1 waiting on you");
  // The week's status, friends and docking bar live on Week.
  await openWeek(page);
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends.getByRole("listitem")).toHaveText([
    "MAMaya2 of 3 workoutsNeeds your voteNudge",
  ]);
  await expect(
    page.locator(".own-progress").getByRole("img", { name: "1 of 3 workouts" }),
  ).toBeVisible();
  // The docking bar is covered in week.spec.ts.
  await openHome(page);
  await openPost(page, "Maya");
  await expect(
    page.getByRole("img", { name: "Maya at the workout" }),
  ).toBeVisible();
  // No single-peer review: no Verify button, review labels, stamp or lamps.
  await expect(
    page.getByRole("button", { name: /Verify workout/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Awaiting review|Review ·/)).toHaveCount(0);
  await expect(page.getByText("Needs your review")).toHaveCount(0);
  await expect(page.locator(".proof-stamp, .proof-decide .lamp")).toHaveCount(
    0,
  );
  await expect(page.getByRole("group", { name: "Review" })).toHaveCount(0);
  await expect(page.getByText("Verified ✓", { exact: true })).toBeVisible();
  const question = page.getByRole("button", {
    name: "Question workout · 5h left",
  });
  await expect(question).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["serious", "critical"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("wall-review.png"),
  });

  // Questioning shows at once, while a slow API is still answering.
  await expect(page.getByRole("group", { name: "Your vote" })).toHaveCount(1);
  const undoDelay = await delayRoute(
    page,
    "http://127.0.0.1:8787/v1/proof/*/review",
    1000,
  );
  const questionMs = await msUntilVisible(
    page,
    () => question.click(),
    page.getByText("Workout questioned. The Group votes for 48 hours."),
  );
  testInfo.annotations.push({
    type: "question feedback ms",
    description: String(questionMs),
  });
  expect(questionMs).toBeLessThanOrEqual(100);
  await expect(question).toHaveCount(0);
  await expect(page.getByText("Questioned", { exact: true })).toHaveCount(1);
  answerReview();
  await undoDelay();
  await expect(question).toHaveCount(0);
  // Maya's post leaves the day rows for Needs you, where the questioner votes too.
  await closePost(page);
  await expect(
    page
      .getByRole("list", { name: "Posts by day" })
      .getByRole("button", { name: /^Maya,/ }),
  ).toHaveCount(0);
  await expect(page.locator(".needs-post")).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Your vote" })).toHaveCount(2);

  await expect(page.getByText("Accept 1 · Reject 0 of 3 voters")).toBeVisible();
  // Jordan's post was already questioned; Maya's just got its own vote controls.
  const jordan = page.locator(".needs-post").filter({ hasText: "Jordan" });
  // A failed vote rolls back: the buttons and counts return with an error.
  const undoVoteDelay = await delayRoute(
    page,
    "http://127.0.0.1:8787/v1/proof/*/vote",
    1000,
  );
  const voteMs = await msUntilVisible(
    page,
    () => jordan.getByRole("button", { name: "Reject workout" }).click(),
    page.getByText("Vote saved: reject."),
  );
  testInfo.annotations.push({
    type: "vote feedback ms",
    description: String(voteMs),
  });
  expect(voteMs).toBeLessThanOrEqual(100);
  await undoVoteDelay();
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(page.getByText("Accept 1 · Reject 0 of 3 voters")).toBeVisible();
  await jordan.getByRole("button", { name: "Reject workout" }).click();
  await expect(page.getByRole("status")).toHaveText("Vote saved: reject.");
  await expect(
    jordan.getByRole("button", { name: "Reject workout" }),
  ).toHaveCount(0);

  // Photo reports are paused for now.
  await expect(page.getByRole("button", { name: "Report photos" })).toHaveCount(
    0,
  );
  expect(actions).toEqual(["review:question", "vote:reject"]);
  // Only the deliberately failed vote may log.
  expect(errors.filter((text) => !text.includes("status of 500"))).toEqual([]);
});
