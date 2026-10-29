import { expect, test } from "@playwright/test";
import {
  friendId,
  membershipId,
  openPost,
  openWeek,
  progressItem,
  signIn,
} from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const post = (overrides: Record<string, unknown>) => ({
  workoutCheckinId: "70000000-0000-4000-8000-000000000001",
  authorMembershipId: membershipId,
  authorName: "Akrum",
  mine: true,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date().toISOString(),
  submittedAt: new Date().toISOString(),
  reviewStatus: "verified",
  reviewClosesAt: null,
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 2,
  canReview: false,
  canVote: false,
  canDelete: true,
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  reactions: [],
  myReactions: [],
  ...overrides,
});

test("deleting your own post drops it from this week's count; can't-tell votes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let count = 2;
  const { calls, errors } = await signIn(page, ({ path, method, body }) => {
    if (path.endsWith("/current-week-progress"))
      return [
        progressItem({
          completedWorkoutCount: count,
          activityTypes: Array(count).fill("strength"),
        }),
        progressItem({ membershipId: friendId, displayName: "Maya" }),
      ];
    if (path === "/v1/proof/feed")
      return count === 2
        ? [
            post({}),
            post({
              workoutCheckinId: "70000000-0000-4000-8000-000000000002",
              authorMembershipId: friendId,
              authorName: "Maya",
              mine: false,
              canDelete: false,
              reviewStatus: "questioned",
              canVote: true,
            }),
          ]
        : [];
    if (path.endsWith("/delete") && method === "POST") {
      count = 1;
      return {
        workoutCheckinId: "70000000-0000-4000-8000-000000000001",
        currentWeekCount: 1,
      };
    }
    if (path.endsWith("/vote")) return { status: "questioned", body };
  });
  await expect(page.getByRole("button", { name: "Log workout" })).toBeVisible();

  // Only the vote's own status changes; "Can't tell" hides the ballot.
  await page.getByRole("button", { name: "Can’t assess" }).click();
  await expect(page.getByRole("group", { name: "Your vote" })).toHaveCount(0);
  expect(calls.find((c) => c.path.endsWith("/vote"))?.body).toEqual({
    choice: "cannot_assess",
  });

  await delayRoute(page, "**/v1/proof/*/delete", 1000);
  await openPost(page, "You");
  await page.getByRole("button", { name: "Post options" }).first().click();
  await page.getByRole("menuitem", { name: "Delete post" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this post?" });
  // Destructive: the acting control alone waits, and shows it at once.
  const pending = await msUntilVisible(
    page,
    () => dialog.getByRole("button", { name: "Delete post" }).click(),
    page.getByText("Deleting…"),
  );
  expect(pending).toBeLessThanOrEqual(100);
  await expect(page.getByText(/Post deleted/)).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete post" })).toHaveCount(
    0,
  );
  await openWeek(page);
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Account removes every shared proof photo after confirming", async ({
  page,
}) => {
  const { calls } = await signIn(
    page,
    ({ path }) =>
      path === "/v1/proof/remove-all" ? { removed: 3 } : undefined,
    "/account",
  );
  await page.getByRole("button", { name: "Remove my proof photos" }).click();
  await page.getByRole("button", { name: "Delete photos" }).click();
  await expect(page.getByText("3 posts’ photos removed.")).toBeVisible();
  expect(calls.some((c) => c.path === "/v1/proof/remove-all")).toBe(true);
});

test("after its week, a verified post's photos come down and the count stays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls, errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed")
      return [
        post({
          canDelete: false,
          // Last week: still on Home, past its own delete window.
          submittedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
        }),
      ];
    if (path.endsWith("/remove-photos"))
      return { workoutCheckinId: "70000000-0000-4000-8000-000000000001" };
  });
  await expect(page.getByRole("button", { name: "Log workout" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete post" })).toHaveCount(
    0,
  );
  await delayRoute(page, "**/v1/proof/*/remove-photos", 1000);
  await openPost(page, "You");
  await page.getByRole("button", { name: "Post options" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Delete post" })).toHaveCount(
    0,
  );
  await page.getByRole("menuitem", { name: "Remove photos" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove these photos?" });
  await expect(dialog).toContainText("your week doesn’t change");
  const pending = await msUntilVisible(
    page,
    () => dialog.getByRole("button", { name: "Remove photos" }).click(),
    page.getByText("Removing…"),
  );
  expect(pending).toBeLessThanOrEqual(100);
  await expect(
    page.getByText(/Photos removed. The workout still counts./),
  ).toBeVisible();
  await openWeek(page);
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toBeVisible();
  expect(calls.filter((c) => c.path.endsWith("/remove-photos"))).toHaveLength(
    1,
  );
  expect(errors).toEqual([]);
});
