import { expect, test } from "@playwright/test";
import { closePost, friendId, openPost, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const post = (overrides: Record<string, unknown>) => ({
  workoutCheckinId: "70000000-0000-4000-8000-000000000011",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  submittedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  reviewStatus: "verified",
  reviewClosesAt: null,
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 3,
  canReview: false,
  canVote: false,
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  reactions: [],
  myReactions: [],
  ...overrides,
});

test("closed Group decisions show their verdict on the Wall", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed")
      return [
        post({
          decisionOutcome: "upheld",
          acceptVotes: 1,
          rejectVotes: 1,
          myVote: "accept",
        }),
        post({
          workoutCheckinId: "70000000-0000-4000-8000-000000000012",
          authorName: "Jordan",
          reviewStatus: "rejected",
          decisionOutcome: "rejected",
          rejectVotes: 2,
        }),
      ];
  });
  await expect(
    page.getByRole("button", { name: /^Maya, .*Upheld by the Group/ }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("tiles.png") });
  const upheld = (await openPost(page, "Maya")).getByRole("region", {
    name: "Group decision",
  });
  await expect(upheld).toContainText("Upheld · still counts ✓");
  await expect(upheld).toContainText(
    "Voting time ran out; no majority to reject.",
  );
  await page.screenshot({ path: testInfo.outputPath("upheld.png") });
  await closePost(page);
  // A Rejected post stays in its day with its photos, stamped as not counting.
  const tile = page
    .getByRole("list", { name: "Posts by day" })
    .getByRole("button", { name: /^Jordan, .*rejected, doesn’t count/ });
  await expect(tile).toContainText("Doesn’t count");
  const opened = await openPost(page, "Jordan");
  await expect(opened.locator(".proof-discounted")).toHaveText("Doesn’t count");
  await expect(opened.locator(".proof-main").first()).toBeVisible();
  const rejected = opened.getByRole("region", { name: "Group decision" });
  await expect(rejected).toContainText("Rejected · doesn’t count");
  await expect(rejected).toContainText("It earns Jordan a Consequence card.");
  await page.screenshot({ path: testInfo.outputPath("rejected.png") });
  await closePost(page);
  expect(errors).toEqual([]);
});

test("a deciding vote shows the verdict at once", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const questioned = post({
    reviewStatus: "questioned",
    decisionClosesAt: new Date(Date.now() + 30 * 3_600_000).toISOString(),
    acceptVotes: 0,
    rejectVotes: 1,
    canVote: true,
  });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed") return [questioned];
    if (path.endsWith("/vote")) return { reviewStatus: "rejected" };
  });
  await delayRoute(page, "**/v1/proof/**", 1000);
  const reject = page.getByRole("button", { name: "Reject workout" }).first();
  await expect(reject).toBeVisible();
  const elapsed = await msUntilVisible(
    page,
    () => reject.click(),
    page.getByRole("button", { name: /rejected, doesn’t count/ }),
  );
  expect(elapsed).toBeLessThanOrEqual(100);
  await page.screenshot({ path: testInfo.outputPath("deciding-vote.png") });
  expect(errors).toEqual([]);
});
