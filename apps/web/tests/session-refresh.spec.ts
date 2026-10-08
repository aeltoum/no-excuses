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
  let liveUnavailable = false;
  let liveOffline = false;
  let rosterUnauthorized = false;
  let unauthorizedRosterRequests = 0;
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
      if (liveOffline) return route.abort("internetdisconnected");
      if (liveUnavailable)
        return route.fulfill({
          status: 429,
          json: { code: "over_request_rate_limit", message: "Try again later" },
        });
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
    if (rosterUnauthorized && path.endsWith("/members")) {
      unauthorizedRosterRequests += 1;
      return route.fulfill({
        status: 401,
        json: {
          contractVersion: 1,
          error: {
            code: "unauthorized",
            message: "Unavailable authorization",
            retryable: false,
          },
        },
      });
    }
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
  liveUnavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toHaveCount(0);
  liveUnavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  liveOffline = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toHaveCount(0);
  liveOffline = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  requests.length = 0;
  await page.clock.fastForward(7 * 24 * 60 * 60 * 1000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => requests).toContain("refresh");
  await expect.poll(() => requests).toContain("api:Bearer fresh-access");
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();

  rosterUnauthorized = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Access check failed" }),
  ).toBeVisible();
  expect(unauthorizedRosterRequests).toBe(2);
  rosterUnauthorized = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("verdict.png"),
  });
});

for (const outageStatus of [503, 429]) {
  test(`retryable refresh ${outageStatus} outage on reopen recovers without sign-in`, async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    const failedRequests: {
      method: string;
      url: string;
      error: string | undefined;
    }[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) =>
      failedRequests.push({
        method: request.method(),
        url: request.url(),
        error: request.failure()?.errorText,
      }),
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
    let recovered = false;
    let revoked = false;
    const apiTokens: string[] = [];
    await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/otp"))
        return route.fulfill({ status: 200, json: {} });
      if (path.endsWith("/verify"))
        return route.fulfill({ status: 200, json: session });
      if (path.endsWith("/token")) {
        refreshAttempts += 1;
        if (recovered)
          return route.fulfill({
            status: 200,
            json: {
              ...session,
              access_token: "recovered-access",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            },
          });
        return route.fulfill({
          status: outageStatus,
          json: { code: "service_unavailable", message: "Unavailable" },
        });
      }
      if (path.endsWith("/user") && revoked)
        return route.fulfill({
          status: 401,
          headers: {
            "x-supabase-api-version": "2024-01-01",
            "access-control-expose-headers": "x-supabase-api-version",
          },
          json: { code: "session_not_found", message: "Session revoked" },
        });
      if (path.endsWith("/user"))
        return expired && !recovered
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
    await page
      .getByRole("button", { name: "I already have an account" })
      .click();
    await page.getByLabel("Email address").fill("member@example.test");
    await page.getByRole("button", { name: "Send code" }).click();
    for (const [index, digit] of [..."123456"].entries())
      await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
    await page.clock.fastForward(121000);
    expired = true;
    apiTokens.length = 0;
    await page.goto("/sign-in");
    await page.clock.runFor(60000);
    await expect(
      page.getByRole("heading", { name: "Access unavailable" }),
    ).toBeVisible();
    expect(refreshAttempts).toBeGreaterThan(0);
    expect(apiTokens).toEqual([]);
    await expect(
      page.getByRole("link", { name: "Continue to sign in" }),
    ).toHaveCount(0);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("unavailable.png"),
    });
    recovered = true;
    // SDK caches failed refreshes for two 30-second refresh ticks. Move wall
    // time past that cooldown without firing background auto-refresh timers.
    await page.clock.setSystemTime(
      await page.evaluate(() => Date.now() + 61000),
    );
    await page.clock.resume();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("link", { name: "Group" })).toBeVisible();
    expect(apiTokens).toContain("Bearer recovered-access");
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("recovered.png"),
    });
    revoked = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("link", { name: "Continue to sign in" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Group", exact: true }),
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    // Reopening intentionally cancels an in-flight refresh from the old page.
    expect(
      failedRequests.every(
        (request) =>
          request.method === "POST" &&
          new URL(request.url).pathname === "/auth/v1/token" &&
          request.error === "net::ERR_ABORTED",
      ),
    ).toBe(true);
    await testInfo.attach("navigation-cancellations", {
      body: JSON.stringify(failedRequests),
      contentType: "application/json",
    });
    expect(
      consoleErrors.every(
        (message) =>
          message.includes("503 (Service Unavailable)") ||
          message.includes("429 (Too Many Requests)") ||
          message.includes("401 (Unauthorized)"),
      ),
    ).toBe(true);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("verdict.png"),
    });
  });
}

test("expired live user check refreshes valid session instead of requiring sign-in", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const session = {
    access_token: "expired-access",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
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
      return authorization === "Bearer fresh-access"
        ? route.fulfill({ status: 200, json: user })
        : route.fulfill({
            status: 401,
            headers: {
              "x-supabase-api-version": "2024-01-01",
              "access-control-expose-headers": "x-supabase-api-version",
            },
            json: { code: "bad_jwt", message: "JWT expired" },
          });
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

test("mutation401 revalidates without false sign-in message", async ({
  page,
}, info) => {
  const user = {
    id: "20000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-12T00:00:00Z",
  };
  const session = {
    access_token: "live-access",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1999999999,
    refresh_token: "refresh",
    user,
  };
  await page.route("http://127.0.0.1:54321/auth/v1/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    return r.fulfill({
      status: 200,
      json: p.endsWith("/verify") ? session : p.endsWith("/user") ? user : {},
    });
  });
  let writes = 0;
  await page.route("http://127.0.0.1:8787/v1/**", (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.endsWith("/display-name")) {
      if (r.request().method() === "PUT") {
        writes++;
        return r.fulfill({
          status: 401,
          json: {
            contractVersion: 1,
            error: {
              code: "unauthorized",
              message: "expired",
              retryable: false,
            },
          },
        });
      }
      return r.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { displayName: "Member" } },
      });
    }
    return r.fulfill({
      status: 200,
      json: {
        contractVersion: 1,
        data: p.endsWith("/current") ? { membership: null } : [],
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [i, d] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${i + 1}`).fill(d);
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByLabel("Name").fill("Newname");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("button", { name: "Save name" })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  expect(writes).toBe(1);
  await page.screenshot({
    path: info.outputPath("mutation-verdict.png"),
    fullPage: true,
  });
  expect(
    await page
      .getByText("Access ended. Sign in again.", { exact: true })
      .count(),
  ).toBe(0);
});
