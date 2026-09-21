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
  let count = 0;
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
      count === 1 &&
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
        { membershipId, lockedTarget: 3, completedWorkoutCount: count },
      ]);
    if (path.endsWith("/finalized-weekly-history") && emptyHistory)
      return respond([]);
    if (path.endsWith("/finalized-weekly-history"))
      return respond([
        {
          membershipId,
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
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  await expect(page.getByText("0 / 3").first()).toBeVisible();
  await page.getByLabel("Duration in minutes").fill("45");
  await page
    .getByLabel("I completed this workout. This is my self-report.")
    .check();
  await page.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  await page.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Workout saved. Current count unavailable",
  );
  expect(keys).toHaveLength(2);
  await page.getByRole("button", { name: "Refresh count" }).click();
  await expect(page.getByText("1 / 3").first()).toBeVisible();
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
      if (route === "Home") {
        const intensityFit = await page
          .getByLabel("Perceived intensity")
          .evaluate((select) => {
            if (!(select instanceof HTMLSelectElement))
              throw new Error("Intensity select missing");
            const style = getComputedStyle(select);
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas unavailable");
            context.font = style.font;
            const selectedText = select.selectedOptions[0]?.text ?? "";
            const textWidth = context.measureText(selectedText).width;
            const space =
              select.clientWidth -
              Number.parseFloat(style.paddingLeft) -
              Number.parseFloat(style.paddingRight) -
              24;
            return { textWidth, space };
          });
        expect(
          intensityFit.space,
          `Intensity text fits at ${width}px`,
        ).toBeGreaterThanOrEqual(intensityFit.textWidth);
      }
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
