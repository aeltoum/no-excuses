import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  reactions: {},
  myReaction: null,
  ...overrides,
});

test("Home reacts to friends' proof and nudges members behind target", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const calls: string[] = [];
  let failNextReaction = true;
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
          completedWorkoutCount: 3,
          activityTypes: [],
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 3,
          completedWorkoutCount: 1,
          activityTypes: ["strength"],
        },
        {
          membershipId: "30000000-0000-4000-8000-000000000003",
          displayName: "Jordan",
          lockedTarget: 2,
          completedWorkoutCount: 2,
          activityTypes: ["cardio"],
        },
      ]);
    if (path === "/v1/proof/feed")
      return ok([
        item({
          reviewStatus: "verified",
          canReview: false,
          reactions: { fire: 2 },
        }),
        item({
          workoutCheckinId: questionedId,
          authorMembershipId: membershipId,
          authorName: "Akrum",
          mine: true,
          reviewStatus: "verified",
          canReview: false,
          reactions: { strong: 1 },
        }),
      ]);
    if (path === "/v1/consequences")
      return ok({
        owed: 0,
        offer: null,
        attempt: null,
        reviews: [],
        groupOwed: {},
      });
    if (path === "/v1/nudges" && request.method() === "GET") return ok([]);
    if (path === "/v1/nudges") {
      calls.push(`nudge:${request.postDataJSON().membershipId}`);
      return ok({ membershipId: request.postDataJSON().membershipId });
    }
    if (path.endsWith("/react")) {
      if (failNextReaction) {
        failNextReaction = false;
        return route.fulfill({ status: 500, json: {} });
      }
      calls.push(`react:${request.postDataJSON().reaction}`);
      return ok({ reaction: request.postDataJSON().reaction });
    }
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

  // Own proof shows counts only; friends' proof offers the three reactions.
  const reactions = page.getByRole("group", { name: "Reactions" });
  await expect(reactions).toHaveCount(2);
  await expect(reactions.nth(1).getByRole("button")).toHaveCount(0);
  await expect(reactions.nth(1)).toContainText("1");
  const fire = reactions.first().getByRole("button", { name: "Fire, 2" });
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  // A failed reaction rolls back.
  await fire.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  await fire.click();
  const pressed = reactions.first().getByRole("button", { name: "Fire, 3" });
  await expect(pressed).toHaveAttribute("aria-pressed", "true");
  // Switching moves the viewer's single reaction.
  await reactions.first().getByRole("button", { name: "Strong" }).click();
  await expect(
    reactions.first().getByRole("button", { name: "Strong, 1" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    reactions.first().getByRole("button", { name: "Fire, 2" }),
  ).toHaveAttribute("aria-pressed", "false");

  // Only members behind target can be nudged, once.
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(
    friends.getByRole("button", { name: "Nudge Jordan" }),
  ).toHaveCount(0);
  await friends.getByRole("button", { name: "Nudge Maya" }).click();
  await expect(page.getByRole("status")).toHaveText("Nudge sent.");
  await expect(
    friends.getByRole("button", { name: "Nudged Maya today" }),
  ).toBeDisabled();
  expect(calls).toEqual([
    "react:fire",
    "react:strong",
    `nudge:${friendMembershipId}`,
  ]);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["serious", "critical"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("reactions-nudges.png"),
  });
  expect(errors.filter((text) => !text.includes("status of 500"))).toEqual([]);
});
