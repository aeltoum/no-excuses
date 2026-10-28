import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  friendId,
  homeExtras,
  membershipId,
  openHome,
  openWeek,
  signIn,
} from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const ballot = {
  id: "80000000-0000-4000-8000-000000000001",
  name: "Maya",
  week: "current",
  category: "travel_access",
  note: "Work trip, no gym",
  closesAt: new Date(Date.now() + 30 * 3_600_000).toISOString(),
  myResponse: null,
};

test("ask for a week off and vote on a friend's request, both instantly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failVote = true;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/home/extras")
      return homeExtras({
        exceptions: {
          mine: [],
          toDecide: [ballot],
          excused: [friendId],
          pending: [],
        },
      });
    if (path === "/v1/exceptions/request")
      return homeExtras({
        exceptions: {
          mine: [
            {
              id: body?.id,
              week: body?.week,
              category: body?.category,
              note: body?.note,
              status: "pending",
              closesAt: ballot.closesAt,
            },
          ],
          toDecide: [ballot],
          excused: [friendId],
          pending: [membershipId],
        },
      });
    if (path.endsWith("/respond")) {
      if (failVote) {
        failVote = false;
        return 500;
      }
      return homeExtras({
        exceptions: {
          mine: [],
          toDecide: [{ ...ballot, myResponse: body?.response }],
          excused: [friendId],
          pending: [],
        },
      });
    }
  });
  // Excused friends show it on Week and cannot be nudged.
  await openWeek(page);
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends).toContainText("Excused this week");
  await expect(friends.getByRole("button", { name: /Nudge/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Home 1/ })).toBeVisible();
  await openHome(page);

  await delayRoute(page, "**/v1/exceptions/**", 1000);
  // A failed vote rolls back; the retry sticks.
  const choices = page.getByRole("group", {
    name: "Your vote on Maya’s request",
  });
  await choices.getByRole("button", { name: "Approve" }).click();
  await expect(
    choices.getByRole("button", { name: "Approve" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(
    choices.getByRole("button", { name: "Approve" }),
  ).toHaveAttribute("aria-pressed", "false");
  const voted = await msUntilVisible(
    page,
    () => choices.getByRole("button", { name: "Approve" }).click(),
    page.getByText(/you chose approve/),
  );
  expect(voted).toBeLessThanOrEqual(100);

  // Week off lives under Week options in Week's header.
  await openWeek(page);
  await page.getByRole("button", { name: "Week options" }).click();
  const opened = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Week off" }).click(),
    page.getByRole("button", { name: "Travel or no access" }),
  );
  expect(opened).toBeLessThanOrEqual(100);
  const sheet = page.getByRole("dialog", { name: "Ask for a week off" });
  expect(
    (
      await new AxeBuilder({ page }).include(".sheet").analyze()
    ).violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await sheet.getByRole("button", { name: "Next week" }).click();
  await sheet.getByRole("button", { name: "Travel or no access" }).click();
  await sheet.getByLabel("Note for your Group (optional)").fill("Away");
  const requested = await msUntilVisible(
    page,
    () => sheet.getByRole("button", { name: "Send request" }).click(),
    page.getByText(/Exception for next week pending/),
  );
  expect(requested).toBeLessThanOrEqual(100);
  await expect
    .poll(() => calls.find((c) => c.path === "/v1/exceptions/request")?.body)
    .toMatchObject({ week: "next", category: "travel_access", note: "Away" });
  expect(errors).toEqual([]);
});

test("History shows an excused week as Excused", async ({ page }) => {
  await signIn(
    page,
    ({ path }) =>
      path.endsWith("/finalized-weekly-history")
        ? [
            {
              membershipId,
              displayName: "Akrum",
              startsAt: "2026-10-05T00:00:00.000Z",
              endsAt: "2026-10-12T00:00:00.000Z",
              lockedTarget: 3,
              completedWorkoutCount: 1,
              outcome: "excepted",
              targetStreak: 2,
            },
          ]
        : undefined,
    "/history",
  );
  await expect(
    page.getByRole("button", { name: /Oct 5 – 11: 1\/3, Excused/ }),
  ).toBeVisible();
});
