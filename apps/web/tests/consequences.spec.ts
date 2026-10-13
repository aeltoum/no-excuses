import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const membershipId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
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
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
const offerId = "80000000-0000-4000-8000-000000000001";
const attemptId = "80000000-0000-4000-8000-000000000002";
const claimId = "80000000-0000-4000-8000-000000000003";
const cards = [
  [
    "90000000-0000-4000-8000-000000000001",
    "50 burpees",
    "Complete 50 burpees, any sets.",
  ],
  [
    "90000000-0000-4000-8000-000000000002",
    "100 push-ups",
    "Complete 100 push-ups, any sets.",
  ],
  [
    "90000000-0000-4000-8000-000000000003",
    "5 km run",
    "Run 5 km in one session on the same day.",
  ],
].map(([cardId, title, instructions]) => ({
  cardId,
  title,
  instructions,
  unlockedByFriend: false,
}));

test("owed Consequence card is picked, completed, and friends' claims approved", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const actions: string[] = [];
  let state: Record<string, unknown> = {
    owed: 1,
    offer: { offerId, canRedraw: true, cards },
    attempt: null,
    reviews: [
      {
        claimId,
        memberName: "Maya",
        title: "100 push-ups",
        instructions: "Complete 100 push-ups, any sets.",
        myResponse: null,
      },
    ],
    groupOwed: { [membershipId]: 1, [friendMembershipId]: 2 },
  };
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
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 3,
          completedWorkoutCount: 2,
          activityTypes: ["strength", "class"],
        },
      ]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path === "/v1/proof/feed") return ok([]);
    if (path === "/v1/consequences") return ok(state);
    const action = /^\/v1\/consequences\/(\w+)$/.exec(path)?.[1];
    if (action) {
      const body = request.postDataJSON();
      actions.push(`${action}:${body.target}:${body.choice}`);
      if (action === "select")
        state = {
          ...state,
          offer: null,
          attempt: {
            attemptId,
            status: "active",
            title: "5 km run",
            instructions: "Run 5 km in one session on the same day.",
            expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
            approvals: 0,
            approvalsNeeded: 2,
          },
        };
      if (action === "claim")
        state = {
          ...state,
          attempt: {
            ...(state.attempt as object),
            status: "review",
          },
        };
      if (action === "respond")
        state = {
          ...state,
          reviews: [
            {
              ...(state.reviews as object[])[0],
              myResponse: body.choice,
            },
          ],
        };
      return ok(state);
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

  await expect(page.getByText("You owe 1 Consequence card")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Friends this week" }).getByRole("listitem"),
  ).toHaveText(["Maya2/3 · owes 2"]);
  await page.getByRole("button", { name: "Pick your card" }).click();
  const dialog = page.getByRole("dialog", { name: "Pick your card" });
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await expect(
    dialog.getByRole("button", { name: "Lock it in" }),
  ).toBeDisabled();
  expect(
    (
      await new AxeBuilder({ page }).include("[role=dialog]").analyze()
    ).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("card-offer.png"),
  });
  await dialog.getByRole("radio", { name: /5 km run/ }).check();
  await dialog.getByRole("button", { name: "Lock it in" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "5 km run" })).toBeVisible();
  await expect(page.getByText(/Due in 4[78] hours/)).toBeVisible();

  page.once("dialog", (confirm) => void confirm.accept());
  await page.getByRole("button", { name: "I did it" }).click();
  await expect(
    page.getByText("Waiting for friends: 0 of 2 approvals."),
  ).toBeVisible();

  const review = page
    .getByRole("list", { name: "Consequence cards to approve" })
    .getByRole("listitem");
  await expect(review).toContainText("Maya finished 100 push-ups");
  await review.getByRole("button", { name: "Approve" }).click();
  await expect(review.getByRole("button", { name: "Approve" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("card-home.png"),
  });
  expect(actions).toEqual([
    `select:${offerId}:${cards[2]?.cardId}`,
    `claim:${attemptId}:`,
    `respond:${claimId}:approve`,
  ]);
  expect(errors).toEqual([]);
});
