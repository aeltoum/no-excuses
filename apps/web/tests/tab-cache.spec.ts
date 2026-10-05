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

test("member tabs retain data while background refresh resolves", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  let targetGets = 0;
  let rosterGets = 0;
  let releaseChange: () => void = () => {};
  const changeGate = new Promise<void>((resolve) => {
    releaseChange = resolve;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(request.url()));
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
    const path = new URL(route.request().url()).pathname;
    expect(route.request().headers().authorization).toBe("Bearer live-access");
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({ membership: { groupId, membershipId } });
    if (path.endsWith("/current-week-progress")) return ok([]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path.endsWith("/weekly-target")) {
      targetGets++;
      if (targetGets >= 7)
        return route.fulfill({
          status: 503,
          json: {
            contractVersion: 1,
            error: { code: "failure", message: "Unavailable", retryable: true },
          },
        });
      if (targetGets >= 5) await changeGate;
      return ok({
        membershipId,
        recurringTarget: targetGets >= 5 ? 4 : 3,
        lockedTarget: null,
        nextWeekStartsAt: null,
        memberCount: 1,
        timeZone: "America/Chicago",
      });
    }
    if (path.endsWith("/members")) {
      rosterGets++;
      return ok({
        groupName: "6AM Crew",
        members: [
          {
            membershipId,
            displayName: "Akrum",
            weeklyTarget: 3,
            creator: true,
          },
        ],
      });
    }
    if (path.endsWith("/pending-invitations")) return ok([]);
    if (path.endsWith("/display-name")) return ok({ displayName: "Akrum" });
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
  await page.getByRole("link", { name: "Target" }).click();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Target" }).click();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Loading weekly progress" }),
  ).toHaveCount(0);
  await expect.poll(() => targetGets).toBeGreaterThanOrEqual(4);
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Target" }).click();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Target" }).focus();
  releaseChange();
  await expect(page.getByText("4", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Target" })).toBeFocused();
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Target" }).click();
  await expect(
    page.getByText("Showing saved data", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue("Akrum");
  await name.fill("Unsaved draft");
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Loading your crew" }),
  ).toHaveCount(0);
  expect(rosterGets).toBeGreaterThanOrEqual(2);
  await page.getByRole("link", { name: "Account" }).click();
  await expect(name).toHaveValue("Unsaved draft");
  await page.screenshot({
    path: testInfo.outputPath("cached-group.png"),
    fullPage: true,
  });
  expect(
    errors.filter((error) => !error.includes("503 (Service Unavailable)")),
  ).toEqual([]);
});

test("private tab cache ends at sign-out and new account sign-in", async ({
  page,
}, testInfo) => {
  const secondMembershipId = "30000000-0000-4000-8000-000000000009";
  const secondGroupId = "40000000-0000-4000-8000-000000000009";
  const secondSession = {
    ...session,
    access_token: "second-access",
    refresh_token: "second-refresh",
    user: {
      ...session.user,
      id: "20000000-0000-4000-8000-000000000009",
      email: "second@example.test",
    },
  };
  let currentSession = session;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: currentSession });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: currentSession.user });
    if (path.endsWith("/logout"))
      return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
    const second =
      route.request().headers().authorization === "Bearer second-access";
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({
        membership: {
          groupId: second ? secondGroupId : groupId,
          membershipId: second ? secondMembershipId : membershipId,
        },
      });
    if (
      path.endsWith("/current-week-progress") ||
      path.endsWith("/finalized-weekly-history")
    )
      return ok([]);
    if (path.endsWith("/weekly-target"))
      return ok({
        membershipId: second ? secondMembershipId : membershipId,
        recurringTarget: second ? 7 : 3,
        lockedTarget: null,
        nextWeekStartsAt: null,
        memberCount: 1,
        timeZone: "America/Chicago",
      });
    if (path.endsWith("/members"))
      return ok({
        groupName: second ? "New Crew" : "Old Crew",
        members: [
          {
            membershipId: second ? secondMembershipId : membershipId,
            displayName: second ? "Second" : "First",
            weeklyTarget: second ? 7 : 3,
            creator: true,
          },
        ],
      });
    if (path.endsWith("/pending-invitations")) return ok([]);
    if (path.endsWith("/display-name"))
      return ok({ displayName: second ? "Second" : "First" });
    return route.fulfill({ status: 404, json: {} });
  });
  const signIn = async (email: string) => {
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    const returning = page.getByRole("button", {
      name: "I already have an account",
    });
    if (await returning.isVisible()) await returning.click();
    const anotherEmail = page.getByRole("button", {
      name: "Use another email",
    });
    if (await anotherEmail.count()) await anotherEmail.click();
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    for (const [index, digit] of [..."123456"].entries())
      await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  };
  await page.goto("/sign-in");
  await signIn("member@example.test");
  await page.getByRole("link", { name: "Target" }).click();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  currentSession = secondSession;
  await signIn("second@example.test");
  await page.getByRole("link", { name: "Target" }).click();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
  await expect(page.getByText("3", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "New Crew" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Old Crew" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("second-account-group.png"),
    fullPage: true,
  });
});
