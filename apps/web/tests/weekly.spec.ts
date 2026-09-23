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
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
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
  let emptyHistory = false;
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
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
    if (path.endsWith("/finalized-weekly-history"))
      return respond([
        {
          membershipId,
          displayName: "Akrum",
          startsAt: "2026-09-01T00:00:00Z",
          endsAt: "2026-09-08T00:00:00Z",
          lockedTarget: 3,
          completedWorkoutCount: 2,
          outcome: "missed",
        },
      ]);
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
  await page.getByRole("link", { name: "Target" }).click();
  await page.getByLabel("Workouts per week").fill("4");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Action conflicts with current Group state.",
  );
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Weekly target set to 4. Current progress unavailable",
  );
  await page.getByLabel("Workouts per week").fill("5");
  await page.getByRole("button", { name: "Refresh progress" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Progress refreshed. Review current locked target above.",
  );
  await expect(page.getByLabel("Workouts per week")).toHaveValue("5");
  await expect(
    page.getByText("Weekly target set to 5", { exact: false }),
  ).toHaveCount(0);
  expect(targetKeys).toHaveLength(2);
  expect(targetKeys[0]).toBe(targetKeys[1]);
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("Missed · 2 / 3")).toBeVisible();
  await expect(
    page.getByText("Weekly target set to 4", { exact: false }),
  ).toHaveCount(0);
  emptyHistory = true;
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "History" }).click();
  await expect(
    page.getByText("No finalized weekly history yet.", { exact: false }),
  ).toBeVisible();
  for (const width of [195, 160]) {
    await page.setViewportSize({ width, height: width === 195 ? 422 : 284 });
    for (const route of ["Home", "Target", "History"]) {
      await page.getByRole("link", { name: route }).click();
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
      "Failed to load resource: the server responded with a status of 409 (Conflict)",
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
    ].sort(),
  );
});
