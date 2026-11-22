import { expect, test } from "@playwright/test";
import { homeExtras, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const state = {
  cases: [
    {
      id: "90000000-0000-4000-8000-000000000001",
      kind: "message_report",
      category: "harassment",
      createdAt: "2026-10-19T10:00:00.000Z",
      group: "6AM Crew",
      groupId: "40000000-0000-4000-8000-000000000001",
      reporter: "Akrum",
      subject: "Maya",
      subjectStatus: "active",
      message: "rude words",
      photoUrls: [],
    },
  ],
  holds: [],
  suspended: [],
  groups: [
    {
      groupId: "40000000-0000-4000-8000-000000000001",
      name: "6AM Crew",
      members: [
        { membershipId: "30000000-0000-4000-8000-000000000002", name: "Maya" },
      ],
    },
  ],
};

test("operators work cases and open pauses from the console", async ({
  page,
}) => {
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/home/extras")
      return homeExtras({
        safety: { conductAccepted: true, blocked: [], operator: true },
      });
    if (path === "/v1/operator") return state;
    if (path === "/v1/operator/resolve")
      return {
        ...state,
        cases: [],
        suspended: [{ accountId: "a", name: "Maya" }],
      };
    if (path === "/v1/operator/hold")
      return {
        ...state,
        cases: [],
        holds: [
          {
            id: "91000000-0000-4000-8000-000000000001",
            kind: "technical",
            group: "6AM Crew",
            member: "Maya",
            reason: body?.reason,
            startsAt: "2026-10-19T11:00:00.000Z",
          },
        ],
      };
  });
  await page.getByRole("link", { name: /^Account/ }).click();
  await page.getByRole("link", { name: /Operator console/ }).click();
  await expect(page.getByText("rude words")).toBeVisible();
  await delayRoute(page, "**/v1/operator/resolve", 1000);
  await page.getByRole("button", { name: "Suspend access" }).click();
  const pending = await msUntilVisible(
    page,
    () =>
      page
        .getByRole("dialog", { name: "Suspend access?" })
        .getByRole("button", { name: "Suspend access" })
        .click(),
    page.getByRole("button", { name: "Working…" }),
  );
  expect(pending).toBeLessThanOrEqual(100);
  await expect(page.getByRole("button", { name: "Reinstate" })).toBeVisible();
  const pauses = page.getByRole("region", { name: "Pauses" });
  await pauses
    .getByRole("combobox", { name: /^Group/ })
    .selectOption({ label: "6AM Crew" });
  await pauses
    .getByRole("combobox", { name: /^Who/ })
    .selectOption({ label: "Maya (Technical pause)" });
  await page.getByLabel("Reason").fill("Camera bug");
  await page.getByRole("button", { name: "Open pause" }).click();
  await expect(page.getByText(/Technical · Maya · Camera bug/)).toBeVisible();
  expect(calls.find((c) => c.path === "/v1/operator/hold")?.body).toEqual({
    open: true,
    groupId: "40000000-0000-4000-8000-000000000001",
    membershipId: "30000000-0000-4000-8000-000000000002",
    reason: "Camera bug",
  });
  expect(errors).toEqual([]);
});

test("the console refuses members who are not operators", async ({ page }) => {
  await signIn(page, ({ path }) => (path === "/v1/operator" ? 403 : undefined));
  await page.evaluate(() => {
    window.history.pushState(null, "", "/operator");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByText("This console is for the app’s operator only."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Operator console/ }),
  ).toHaveCount(0);
});

const maya = {
  membershipId: "30000000-0000-4000-8000-000000000002",
  name: "Maya",
  targetStreak: 0,
  pausedStreak: 3,
  owed: [
    {
      id: "92000000-0000-4000-8000-000000000001",
      source: "missed_target",
      createdAt: "2026-11-16T05:00:00.000Z",
      weekStartsAt: "2026-11-09T05:00:00.000Z",
      card: {
        title: "25 squats",
        status: "active",
        expiresAt: "2026-11-18T05:00:00.000Z",
      },
      offered: false,
    },
  ],
  weeks: [
    {
      memberWeekId: "93000000-0000-4000-8000-000000000002",
      startsAt: "2026-11-16T05:00:00.000Z",
      endsAt: "2026-11-23T05:00:00.000Z",
      status: "active",
      target: 3,
      verified: 1,
      added: 0,
    },
    {
      memberWeekId: "93000000-0000-4000-8000-000000000001",
      startsAt: "2026-11-09T05:00:00.000Z",
      endsAt: "2026-11-16T05:00:00.000Z",
      status: "missed",
      target: 3,
      verified: 2,
      added: 0,
    },
  ],
};

test("operators waive cards, excuse weeks, and add lost workouts", async ({
  page,
}) => {
  const memberPath = `/v1/operator/member/${maya.membershipId}`;
  const { calls, errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/home/extras")
      return homeExtras({
        safety: { conductAccepted: true, blocked: [], operator: true },
      });
    if (path === "/v1/operator") return state;
    if (path === memberPath) return maya;
    if (path === "/v1/operator/waive") return { ...maya, owed: [] };
    if (path === "/v1/operator/workout")
      return {
        ...maya,
        owed: [],
        targetStreak: 4,
        pausedStreak: null,
        weeks: [
          maya.weeks[0],
          { ...maya.weeks[1], status: "attained", verified: 3, added: 1 },
        ],
      };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: /^Account/ }).click();
  await page.getByRole("link", { name: /Operator console/ }).click();
  const support = page.getByRole("region", { name: "Member support" });
  await support
    .getByRole("combobox", { name: "Group" })
    .selectOption({ label: "6AM Crew" });
  await delayRoute(page, `**${memberPath}`, 1000);
  const pickMember = support.getByRole("combobox", { name: "Member" });
  await pickMember.focus();
  const placeholder = await msUntilVisible(
    page,
    () => page.keyboard.press("ArrowDown"),
    support.getByRole("status", { name: "Loading member" }),
  );
  expect(placeholder).toBeLessThanOrEqual(100);
  await expect(support.getByText("Missed week of Nov 9")).toBeVisible();
  await expect(support.getByText("25 squats (due)")).toBeVisible();

  await delayRoute(page, "**/v1/operator/waive", 1000);
  await support.getByRole("button", { name: "Waive", exact: true }).click();
  const waiving = await msUntilVisible(
    page,
    () =>
      page
        .getByRole("dialog", { name: "Waive this card?" })
        .getByRole("button", { name: "Waive card" })
        .click(),
    support.getByRole("button", { name: "Waiving…" }),
  );
  expect(waiving).toBeLessThanOrEqual(100);
  await expect(support.getByText("Nothing owed.")).toBeVisible();
  expect(calls.find((c) => c.path === "/v1/operator/waive")?.body).toEqual({
    membershipId: maya.membershipId,
    obligationId: "92000000-0000-4000-8000-000000000001",
  });

  await expect(
    support.getByRole("button", { name: "Excuse week" }),
  ).toHaveCount(1);
  await support.getByRole("button", { name: "Add workout" }).nth(1).click();
  const form = support.getByRole("form", { name: /Add workout for Nov 9/ });
  await form.getByLabel("When").fill("2026-11-12T18:30");
  await form.getByLabel("Minutes").fill("50");
  await form.getByLabel("Type").selectOption("cardio");
  await form.getByRole("button", { name: "Add workout" }).click();
  await expect(
    support.getByText(/Met · 3\/3 done \(1 added by you\)/),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
  const logged = calls.find((c) => c.path === "/v1/operator/workout")?.body as
    | Record<string, unknown>
    | undefined;
  expect(logged).toMatchObject({
    memberWeekId: "93000000-0000-4000-8000-000000000001",
    activityType: "cardio",
    durationMinutes: 50,
    intensity: "moderate",
  });
  await page.screenshot({
    path: "test-results/operator-member-support.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
