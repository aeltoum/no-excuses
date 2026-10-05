import { expect, test } from "@playwright/test";

const userId = "20000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "member@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-09-12T00:00:00Z",
};

test("expired access token with valid refresh credential restores signed-in API access", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const session = {
    access_token: "expired-access",
    token_type: "bearer",
    expires_in: 15,
    expires_at: Math.floor(Date.now() / 1000) + 15,
    refresh_token: "valid-refresh",
    user,
  };
  let expired = false;
  const requests: string[] = [];
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/token")) {
      requests.push("refresh");
      return route.fulfill({
        status: 200,
        json: {
          access_token: "fresh-access",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "next-refresh",
          user,
        },
      });
    }
    if (path.endsWith("/user")) {
      const authorization = route.request().headers().authorization;
      requests.push(`user:${authorization}`);
      return authorization === "Bearer fresh-access" ||
        (!expired && authorization === "Bearer expired-access")
        ? route.fulfill({ status: 200, json: user })
        : route.fulfill({ status: 401, json: { message: "JWT expired" } });
    }
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const authorization = route.request().headers().authorization;
    requests.push(`api:${authorization}`);
    if (
      authorization !== "Bearer fresh-access" &&
      (expired || authorization !== "Bearer expired-access")
    )
      return route.fulfill({
        status: 401,
        json: {
          contractVersion: 1,
          error: { code: "unauthorized", message: "expired", retryable: false },
        },
      });
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: { groupId, membershipId } },
        },
      });
    return route.fulfill({
      status: 200,
      json: {
        contractVersion: 1,
        data: { groupName: "6AM Crew", members: [] },
      },
    });
  });

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  await page.clock.fastForward(16000);
  expired = true;
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  expect(requests).toContain("refresh");
  expect(requests).toContain("api:Bearer fresh-access");
  requests.length = 0;
  await page.reload();
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  await expect.poll(() => requests).toContain("api:Bearer fresh-access");
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("verdict.png"),
  });
});

test("retryable refresh outage on reopen shows unavailable without a stale API token", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.method()} ${request.url()}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.clock.install();
  const session = {
    access_token: "aging-access",
    token_type: "bearer",
    expires_in: 120,
    expires_at: Math.floor(Date.now() / 1000) + 120,
    refresh_token: "still-valid-refresh",
    user,
  };
  let expired = false;
  let refreshAttempts = 0;
  const apiTokens: string[] = [];
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/token")) {
      refreshAttempts += 1;
      return route.fulfill({
        status: 503,
        json: { code: "service_unavailable", message: "Unavailable" },
      });
    }
    if (path.endsWith("/user"))
      return expired
        ? route.fulfill({ status: 401, json: { message: "JWT expired" } })
        : route.fulfill({ status: 200, json: user });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    apiTokens.push(route.request().headers().authorization ?? "");
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: { groupId, membershipId } },
        },
      });
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: [] },
    });
  });

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  await page.clock.fastForward(121000);
  expired = true;
  apiTokens.length = 0;
  await page.reload();
  await page.clock.runFor(60000);
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  expect(refreshAttempts).toBeGreaterThan(0);
  expect(apiTokens).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(
    consoleErrors.every((message) =>
      message.includes("503 (Service Unavailable)"),
    ),
  ).toBe(true);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("verdict.png"),
  });
});
