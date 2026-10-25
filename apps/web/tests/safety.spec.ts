import { expect, test } from "@playwright/test";
import { friendId, membershipId, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const post = (overrides: Record<string, unknown>) => ({
  workoutCheckinId: "70000000-0000-4000-8000-000000000001",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
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
  eligibleVoters: 0,
  canReview: false,
  canVote: false,
  canDelete: false,
  activityPhotoUrl: null,
  presencePhotoUrl: null,
  reactions: [],
  myReactions: [],
  caption: "Leg day",
  messages: [
    {
      id: "71000000-0000-4000-8000-000000000001",
      name: "Jo",
      mine: false,
      body: "Let's go",
      at: new Date().toISOString(),
    },
  ],
  ...overrides,
});

test("messages need the conduct rules once, then send instantly; reports hide at once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { calls, errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed")
      return [
        post({}),
        post({
          workoutCheckinId: "70000000-0000-4000-8000-000000000002",
          authorMembershipId: membershipId,
          authorName: "Akrum",
          mine: true,
          caption: null,
          messages: [],
        }),
      ];
    if (path === "/v1/safety/conduct") return { version: 1 };
    if (path.endsWith("/message")) return { id: "x" };
    if (path.endsWith("/caption")) return { caption: "PR day" };
    if (path === "/v1/safety/report-message") return { reported: true };
  });
  const maya = page.getByRole("listitem").filter({ hasText: "Leg day" });
  await expect(maya.getByText("Let's go")).toBeVisible();
  await maya.getByRole("button", { name: "Message", exact: true }).click();
  const rules = page.getByRole("dialog", { name: "Crew conduct rules" });
  await rules.getByRole("button", { name: "I agree" }).click();
  await delayRoute(page, "**/v1/proof/*/message", 1000);
  await maya.getByRole("textbox", { name: "Message" }).fill("Monster");
  const sent = await msUntilVisible(
    page,
    () => maya.getByRole("button", { name: "Send" }).click(),
    maya.getByText("Monster"),
  );
  expect(sent).toBeLessThanOrEqual(100);

  // Own fresh post takes a caption without asking again.
  const mine = page.locator(".proof-post").nth(1);
  await mine.getByRole("button", { name: "Add caption" }).click();
  await expect(rules).toHaveCount(0);
  await mine.getByRole("button", { name: "New PR" }).click();
  await expect(mine.getByRole("textbox", { name: "Caption" })).toHaveValue(
    "New PR",
  );
  await expect(page.locator(".home-log-button")).toBeHidden();
  await mine.getByRole("textbox", { name: "Caption" }).fill("PR day");
  await mine.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("PR day")).toBeVisible();

  await maya.getByRole("button", { name: "Report message from Jo" }).click();
  await page
    .getByRole("dialog", { name: "Report this message?" })
    .getByRole("button", { name: "Report message" })
    .click();
  await expect(maya.getByText("Let's go")).toHaveCount(0);
  await expect
    .poll(() =>
      calls.filter((c) => c.path.startsWith("/v1/safety/")).map((c) => c.path),
    )
    .toEqual(["/v1/safety/conduct", "/v1/safety/report-message"]);
  expect(errors).toEqual([]);
});

test("a member can be reported or blocked from the Group roster", async ({
  page,
}) => {
  const { calls } = await signIn(
    page,
    ({ path }) =>
      path === "/v1/safety/block"
        ? { blocked: true }
        : path === "/v1/safety/report-member"
          ? { reported: true }
          : undefined,
    "/group",
  );
  await page.getByRole("button", { name: "More for Maya" }).click();
  const sheet = page.getByRole("dialog", { name: "Maya" });
  await sheet.getByRole("button", { name: "Block Maya" }).click();
  await expect(
    sheet.getByRole("button", { name: "Unblock Maya" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Report Maya…" }).click();
  await sheet.getByRole("button", { name: "Threats" }).click();
  await expect(
    page.getByText(/Reported. The operator will review it/),
  ).toBeVisible();
  expect(
    calls.filter((c) => c.path.startsWith("/v1/safety/")).map((c) => c.body),
  ).toEqual([
    { membershipId: friendId, on: true },
    { membershipId: friendId, category: "threats" },
  ]);
});
