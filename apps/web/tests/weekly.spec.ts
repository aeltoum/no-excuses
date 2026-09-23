import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const membershipId = "30000000-0000-4000-8000-000000000001";
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
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

test("one-member Group pauses workouts until a second member joins", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  let workoutPostCount = 0;
  let soloTargetSaveCount = 0;
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("requestfailed", (request) => failures.push(request.url()));
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
    expect(request.headers().authorization).toBe("Bearer live-access");
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/current"))
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: { groupId, membershipId } },
        },
      });
    if (path.endsWith("/current-week-progress"))
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: [] },
      });
    if (path.endsWith("/weekly-target") && request.method() === "GET")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            membershipId,
            recurringTarget: 3,
            lockedTarget: null,
            nextWeekStartsAt: null,
            memberCount: 1,
            timeZone: "America/Chicago",
          },
        },
      });
    if (path.endsWith("/weekly-target") && request.method() === "PUT") {
      soloTargetSaveCount++;
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            membershipId,
            weeklyTarget: request.postDataJSON().weeklyTarget,
          },
        },
      });
    }
    if (path.endsWith("/finalized-weekly-history"))
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: [] },
      });
    if (path.endsWith("/workout-check-ins")) {
      workoutPostCount++;
      return route.fulfill({
        status: 403,
        json: {
          contractVersion: 1,
          error: {
            code: "denied",
            message: "private detail",
            retryable: false,
          },
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();

  await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  const logWorkout = page.getByRole("button", { name: "Log workout" });
  let actionDenied = false;
  if ((await logWorkout.count()) > 0) {
    await logWorkout.click();
    actionDenied = await page.getByText("Action denied.").isVisible();
  }
  await expect(
    page.getByText(
      "Accountability and workouts begin once a second member joins your Group.",
    ),
  ).toBeVisible();
  expect(actionDenied).toBe(false);
  await expect(logWorkout).toHaveCount(0);
  await expect(page.getByText("Action denied.")).toHaveCount(0);
  expect(workoutPostCount).toBe(0);
  await page.getByRole("link", { name: "Target" }).click();
  await expect(
    page.getByText(
      "Your week starts when a friend joins. This becomes your first target.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Increase weekly target" }).click();
  await page.getByRole("button", { name: "Save for next week" }).click();
  await expect(
    page.getByText("Saved. This becomes your first target.", { exact: true }),
  ).toBeVisible();
  expect(soloTargetSaveCount).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("one-member-group.png"),
  });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  expect(failures).toEqual([]);
});

test("weekly loop: self-report, target, finalized result", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("requestfailed", (request) => failures.push(request.url()));
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  let count = 2;
  let progressFailed = false;
  let targetProgressFailed = false;
  const keys: string[] = [];
  const targetKeys: string[] = [];
  let targetLoadFailures = 0;
  let historyLoadFailures = 0;
  let emptyHistory = false;
  const historyData = Array.from({ length: 13 }, (_, index) => {
    const startsAt = new Date(
      Date.parse("2026-09-14T05:00:00.000Z") - index * 7 * 24 * 60 * 60 * 1000,
    );
    const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const ownMet = index % 2 === 0;
    return [
      {
        membershipId,
        displayName: "Akrum",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        lockedTarget: 4,
        completedWorkoutCount: ownMet ? 4 : 2,
        outcome: ownMet ? "attained" : "missed",
      },
      {
        membershipId: friendMembershipId,
        displayName: "Maya",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        lockedTarget: 3,
        completedWorkoutCount: index % 3 === 0 ? 2 : 3,
        outcome: index % 3 === 0 ? "missed" : "attained",
      },
    ];
  })
    .flat()
    .reverse();
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer live-access");
    const path = new URL(request.url()).pathname;
    const respond = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return respond({ membership: { groupId, membershipId } });
    if (
      path.endsWith("/current-week-progress") &&
      count === 3 &&
      !progressFailed
    ) {
      progressFailed = true;
      return route.fulfill({
        status: 500,
        json: {
          contractVersion: 1,
          error: {
            code: "domain_failure",
            message: "private detail",
            retryable: true,
          },
        },
      });
    }
    if (
      path.endsWith("/current-week-progress") &&
      targetKeys.length === 2 &&
      !targetProgressFailed
    ) {
      targetProgressFailed = true;
      return route.fulfill({
        status: 500,
        json: {
          contractVersion: 1,
          error: {
            code: "domain_failure",
            message: "private detail",
            retryable: true,
          },
        },
      });
    }
    if (path.endsWith("/current-week-progress"))
      return respond([
        {
          membershipId,
          displayName: "Akrum",
          lockedTarget: 4,
          completedWorkoutCount: count,
          activityTypes:
            count === 2
              ? ["strength", "cardio"]
              : ["strength", "cardio", "strength"],
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 2,
          completedWorkoutCount: 1,
          activityTypes: ["cardio"],
        },
      ]);
    if (path.endsWith("/finalized-weekly-history") && emptyHistory)
      return respond([]);
    if (path.endsWith("/finalized-weekly-history") && historyLoadFailures > 0) {
      historyLoadFailures--;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill({
        status: 500,
        json: {
          contractVersion: 1,
          error: {
            code: "domain_failure",
            message: "private detail",
            retryable: true,
          },
        },
      });
    }
    if (path.endsWith("/finalized-weekly-history")) return respond(historyData);
    if (path.endsWith("/workout-check-ins")) {
      const body = request.postDataJSON();
      keys.push(request.headers()["idempotency-key"]);
      if (keys.length === 1)
        return route.fulfill({
          status: 500,
          json: {
            contractVersion: 1,
            error: {
              code: "domain_failure",
              message: "private detail",
              retryable: true,
            },
          },
        });
      count++;
      return respond({
        workoutCheckinId: body.workoutCheckinId,
        currentWeekCount: count,
      });
    }
    if (path.endsWith("/weekly-target") && request.method() === "GET") {
      if (targetLoadFailures > 0) {
        targetLoadFailures--;
        return route.fulfill({
          status: 500,
          json: {
            contractVersion: 1,
            error: {
              code: "domain_failure",
              message: "private detail",
              retryable: true,
            },
          },
        });
      }
      return respond({
        membershipId,
        recurringTarget: 4,
        lockedTarget: 4,
        nextWeekStartsAt: "2026-09-28T05:00:00.000Z",
        memberCount: 2,
        timeZone: "America/Chicago",
      });
    }
    if (path.endsWith("/weekly-target")) {
      targetKeys.push(request.headers()["idempotency-key"]);
      if (targetKeys.length === 1)
        return route.fulfill({
          status: 409,
          json: {
            contractVersion: 1,
            error: {
              code: "idempotency_conflict",
              message: "private detail",
              retryable: false,
            },
          },
        });
      return respond({
        membershipId,
        weeklyTarget: request.postDataJSON().weeklyTarget,
      });
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
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  await expect(page.getByText("Maya")).toBeVisible();
  const legend = page.getByRole("list", { name: "Activity colours" });
  await expect(legend.getByRole("listitem")).toHaveText([
    "Strength",
    "Cardio",
    "Class",
    "Sport",
    "Mixed",
  ]);
  await expect(
    page
      .getByRole("img", { name: "1 of 2 workouts" })
      .locator('rect[fill="var(--activity-cardio)"]'),
  ).toHaveCount(2);
  await expect(
    page.getByText(`Member ${friendMembershipId.slice(0, 8)}`),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "2 of 4 workouts" }),
  ).toBeVisible();
  await expect(page.getByText("Every rep counts.")).toHaveCount(0);
  const opener = page.getByRole("button", { name: "Log workout" });
  await opener.click();
  let dialog = page.getByRole("dialog", { name: "Log a workout" });
  await expect(
    dialog.getByRole("heading", { name: "Log a workout" }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", {
      name: /^(Strength|Cardio|Class|Sport|Mixed)$/,
    }),
  ).toHaveCount(5);
  await expect(
    dialog.getByText("Pick an activity and a time to log it."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Log workout" }),
  ).toBeDisabled();
  expect(
    (
      await new AxeBuilder({ page }).include("[role=dialog]").analyze()
    ).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByLabel("I did this workout. It's my own self-report."),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  dialog = page.getByRole("dialog", { name: "Log a workout" });
  await page
    .getByRole("button", { name: "Close dialog" })
    .click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  dialog = page.getByRole("dialog", { name: "Log a workout" });
  await dialog.getByRole("button", { name: "Other" }).click();
  await expect(dialog.getByLabel("Duration in minutes")).toHaveAttribute(
    "inputmode",
    "numeric",
  );
  await expect(dialog.getByLabel("Duration in minutes")).toHaveAttribute(
    "min",
    "1",
  );
  await dialog.getByRole("button", { name: "Strength" }).click();
  await expect(dialog.getByText("This one makes 3 of 4.")).toBeVisible();
  await dialog.getByRole("button", { name: "45 min" }).click();
  await page.getByLabel("I did this workout. It's my own self-report.").check();
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Couldn't log it — the connection dropped. Your choices are kept; try again.",
  );
  await expect(
    dialog.getByRole("button", { name: "Strength" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "Workout logged. 3 of 4 this week.",
  );
  expect(keys).toHaveLength(2);
  await expect(
    page.getByText("3 of 4 this week", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "3 of 4 workouts" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: "3 of 4 workouts" })
      .locator('rect[fill="var(--activity-strength)"]'),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "Refresh count" }).click();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const targetLink = page.getByRole("link", {
    name: "3 of 4 workouts. Change weekly target.",
  });
  await expect(targetLink).toBeVisible();
  targetLoadFailures = 2;
  await targetLink.click();
  await expect(
    page.getByRole("button", { name: "Retry loading" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(
    page.getByText(
      "This week is locked at 4. Changes start next week, Mon Sep 28.",
    ),
  ).toBeVisible();
  const decreaseTarget = page.getByRole("button", {
    name: "Decrease weekly target",
  });
  const increaseTarget = page.getByRole("button", {
    name: "Increase weekly target",
  });
  await decreaseTarget.click();
  await decreaseTarget.click();
  await decreaseTarget.click();
  await expect(decreaseTarget).toBeDisabled();
  for (let target = 1; target < 7; target++) await increaseTarget.click();
  await expect(page.getByText("workouts a week")).toBeVisible();
  await expect(
    page.getByText(/unusually high target or a sharp jump/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "We suggest at least 2. There’s no reward for a higher number.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save for next week" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Action conflicts with current Group state.",
  );
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Save for next week" }).click();
  await expect(
    page.getByText("Saved. From Sep 28 your target is 7.", { exact: true }),
  ).toBeVisible();
  await increaseTarget.click();
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(
    page.getByText("Progress refreshed. Review current locked target above.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved. From Sep 28 your target is 8.", { exact: false }),
  ).toHaveCount(0);
  expect(targetKeys).toHaveLength(2);
  expect(targetKeys[0]).toBe(targetKeys[1]);
  historyLoadFailures = 2;
  await page.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByRole("status", { name: "Loading history" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn't load your history.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  const rack = page.getByRole("list", { name: "Finalized weeks" });
  await expect(rack.getByRole("button")).toHaveCount(12);
  const latestPlate = rack.getByRole("button", {
    name: "Sep 14 – 20: 4/4, Met",
  });
  await expect(latestPlate).toBeVisible();
  await expect(rack.getByText("Jun 22 – 28")).toHaveCount(0);
  await latestPlate.click();
  const historySheet = page.getByRole("dialog", { name: "Sep 14 – 20" });
  await expect(historySheet.getByRole("heading")).toBeFocused();
  await expect(historySheet.getByText("You met it: 4 of 4.")).toBeVisible();
  await expect(historySheet.getByText("Akrum")).toBeVisible();
  await expect(historySheet.getByText("4/4 · Met")).toBeVisible();
  await expect(historySheet.getByText("Maya")).toBeVisible();
  await expect(historySheet.getByText("2/3 · Missed")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(historySheet).toHaveCount(0);
  await expect(latestPlate).toBeFocused();
  await page.getByRole("button", { name: "Show older weeks" }).click();
  await expect(rack.getByRole("button")).toHaveCount(13);
  await expect(
    page.getByRole("button", { name: "Show older weeks" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Saved. From Sep 28", { exact: false }),
  ).toHaveCount(0);
  emptyHistory = true;
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByText(
      "Your first week lands here when it closes on Sunday at midnight.",
    ),
  ).toBeVisible();
  for (const width of [195, 160]) {
    await page.setViewportSize({ width, height: width === 195 ? 422 : 284 });
    for (const route of ["Home", "Target", "History"]) {
      await page.getByRole("link", { name: route, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const geometry = await page.evaluate(() => {
        const bounds = (element: Element) => element.getBoundingClientRect();
        const mainElement = document.querySelector("main");
        const navElement = document.querySelector("nav");
        if (!mainElement || !navElement)
          throw new Error("Shell layout missing");
        const main = bounds(mainElement);
        const nav = bounds(navElement);
        return {
          navOverMain: nav.top < main.bottom - 1,
          clipped: [
            ...document.querySelectorAll(
              "main, main form, main input, main button, main .result, nav",
            ),
          ]
            .map((element) => ({
              name: element.tagName.toLowerCase(),
              left: bounds(element).left,
              right: bounds(element).right,
            }))
            .filter(
              ({ left, right }) => left < -1 || right > window.innerWidth + 1,
            ),
        };
      });
      expect(geometry, `${route} at ${width}px CSS viewport`).toEqual({
        navOverMain: false,
        clipped: [],
      });
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`zoom-${width}-${route.toLowerCase()}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("weekly-verdict.png"),
  });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  expect(failures.sort()).toEqual(
    [
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    ].sort(),
  );
});
