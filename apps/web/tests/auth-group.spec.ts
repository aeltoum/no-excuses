import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const userId = "20000000-0000-4000-8000-000000000001";
const membershipId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const session = {
  access_token: "live-access",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 1999999999,
  refresh_token: "refresh",
  user: {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "member@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-12T00:00:00Z",
  },
};

const findings = new WeakMap<
  object,
  { console: string[]; page: string[]; network: string[] }
>();
test.beforeEach(async ({ page }) => {
  const found = {
    console: [] as string[],
    page: [] as string[],
    network: [] as string[],
  };
  findings.set(page, found);
  page.on("console", (message) => {
    if (message.type() === "error") found.console.push(message.text());
  });
  page.on("pageerror", (error) => found.page.push(error.message));
  page.on("requestfailed", (request) =>
    found.network.push(`${request.method()} ${request.url()}`),
  );
});
test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("verdict.png"),
  });
  expect(findings.get(page)).toEqual({ console: [], page: [], network: [] });
});

async function mockSignedOut(page: Page) {
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    if (path.endsWith("/logout"))
      return route.fulfill({ status: 204, body: "" });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
}

async function fillCode(page: Page, code: string) {
  for (const [index, digit] of [...code].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
}

async function mockApi(page: Page, member: boolean) {
  let displayName: string | null = "Akrum";
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer live-access");
    const path = new URL(request.url()).pathname;
    if (path === "/v1/account/display-name") {
      if (request.method() === "PUT") {
        displayName = request.postDataJSON().displayName;
      }
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { displayName } },
      });
    }
    if (path === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: member ? { groupId, membershipId } : null },
        },
      });
    if (path === `/v1/groups/${groupId}/current-week-progress`)
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        json: {
          contractVersion: 1,
          data: [
            {
              membershipId,
              displayName: "Akrum",
              lockedTarget: 3,
              completedWorkoutCount: 0,
              activityTypes: [],
            },
          ],
        },
      });
    if (path === "/v1/account") {
      expect(request.postDataJSON()).toEqual({
        confirmation: true,
        otpCode: "123456",
      });
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { accountId: userId } },
      });
    }
    if (path === "/v1/group-invitations")
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
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: { membershipId } },
    });
  });
}

test("Account Name row loads and confirms a saved edit", async ({ page }) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByRole("link", { name: "Account" }).click();
  const name = page.getByLabel("Name");
  await expect(name).toHaveValue("Akrum");
  await name.fill("Akrum Eltoum");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toHaveText("Name saved.");
  await expect(name).toHaveValue("Akrum Eltoum");
});

test("invitation token enrolls before email code request", async ({ page }) => {
  await mockSignedOut(page);
  let enrollment: unknown;
  await page.route("http://127.0.0.1:8787/v1/enrollment", async (route) => {
    enrollment = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      json: {
        contractVersion: 1,
        data: { message: "If invitation is eligible, request a sign-in code." },
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I was invited" }).click();
  await page.getByLabel("Email address").fill("Invited@Example.Test");
  await page.getByLabel("Invitation code").fill("invitation-secret");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(
    page.getByText("If this account is eligible, a code was sent."),
  ).toBeVisible();
  expect(enrollment).toEqual({
    email: "invited@example.test",
    token: "invitation-secret",
  });
});

test("two doors expose only their fields and preserve enrollment order", async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.goto("/sign-in");
  await expect(
    page.getByText(
      "First time here? Use I was invited — the other door can’t create an account.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "I already have an account" }).click();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
  await page.reload();

  await page.getByRole("button", { name: "I was invited" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Invitation code")).toBeVisible();
});

test("six code boxes support paste, focus movement, actions, and rejection", async ({
  page,
}) => {
  await mockSignedOut(page);
  await page.route("http://127.0.0.1:54321/auth/v1/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/verify"))
      return route.fulfill({ status: 400, json: { message: "expired" } });
    return route.fallback();
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();

  const digits = page.getByLabel(/^Code digit /);
  await expect(digits).toHaveCount(6);
  await expect(digits.first()).toHaveAttribute("autocomplete", "one-time-code");
  await expect(digits.first()).toBeFocused();
  await expect(
    page.getByText(
      "We sent a 6-digit code to member@example.test. It expires in 1 hour.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send a new code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use another email" }),
  ).toBeVisible();

  await digits.first().evaluate((input) => {
    const data = new DataTransfer();
    data.setData("text", "123456");
    input.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
    );
  });
  for (const [index, digit] of [..."123456"].entries())
    await expect(digits.nth(index)).toHaveValue(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That code didn't match. Check the latest email, or send a new code.",
  );
  for (const digit of await digits.all())
    await expect(digit).toHaveClass("invalid");
  findings.get(page)?.console.splice(0);
});

test("generic email OTP then live API authorization restores Group entry", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, false);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If this account is eligible, a code was sent.",
  );
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/group");
  await expect(page.getByRole("heading", { name: "Your Group" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your Group" })).toBeVisible();
});

test("ineligible OTP request has same observable result", async ({ page }) => {
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) =>
    route.fulfill({ status: 400, json: { message: "unknown" } }),
  );
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If this account is eligible, a code was sent.",
  );
  findings.get(page)?.console.splice(0);
});

test("invalid code retains email and denied Group action hides private detail", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "12345");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByLabel("Code digit 6")).toBeFocused();
  await expect(
    page.getByText(
      "We sent a 6-digit code to member@example.test. It expires in 1 hour.",
    ),
  ).toBeVisible();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Our week" })).toBeVisible();
  await page.goto("/group");
  await page.getByLabel("Friend email").fill("friend@example.test");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByRole("alert")).toHaveText("Action denied.");
  await expect(page.getByText("private detail")).toHaveCount(0);
  findings.get(page)?.console.splice(0);
});

test("exact Account deletion confirmation cuts off browser session", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("0 of 3 this week")).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Review Account deletion" }).click();
  await expect(
    page.getByText("current Group access ends immediately"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send fresh verification code" })
    .click();
  await page.getByLabel("Fresh six-digit code").fill("123456");
  await page.getByRole("button", { name: "Reverify identity" }).click();
  await expect(
    page.getByText(
      "Code ready. Final confirmation will verify identity before deletion.",
    ),
  ).toBeVisible();
  await page.getByLabel("Type DELETE MY ACCOUNT").fill("delete");
  await page.getByRole("button", { name: "Confirm Account deletion" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Type DELETE MY ACCOUNT exactly.",
  );
  await expect(page.getByLabel("Type DELETE MY ACCOUNT")).toHaveValue("delete");
  await page.getByLabel("Type DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT");
  await page.getByRole("button", { name: "Confirm Account deletion" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Account deletion completed. Access ended immediately.",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  const cutoffFindings = findings.get(page);
  expect(
    cutoffFindings?.network.every(
      (item) =>
        item.includes("/group-memberships/current") ||
        item.includes("/auth/v1/logout"),
    ),
  ).toBe(true);
  cutoffFindings?.network.splice(0);
});

test("pending Auth deletion still ends browser access", async ({ page }) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.route("http://127.0.0.1:8787/v1/account", (route) =>
    route.fulfill({
      status: 202,
      json: {
        contractVersion: 1,
        data: { accountId: userId, authDeletion: "pending" },
      },
    }),
  );
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("0 of 3 this week")).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Review Account deletion" }).click();
  await page
    .getByRole("button", { name: "Send fresh verification code" })
    .click();
  await page.getByLabel("Fresh six-digit code").fill("123456");
  await page.getByRole("button", { name: "Reverify identity" }).click();
  await page.getByLabel("Type DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT");
  await page.getByRole("button", { name: "Confirm Account deletion" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Account deletion accepted. Access ended; Auth removal pending.",
  );
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  const cutoffFindings = findings.get(page);
  expect(
    cutoffFindings?.network.every(
      (item) =>
        item.includes("/group-memberships/current") ||
        item.includes("/auth/v1/logout"),
    ),
  ).toBe(true);
  cutoffFindings?.network.splice(0);
});

test("Group conflict retains draft and retries same idempotency key", async ({
  page,
}) => {
  await mockSignedOut(page);
  const keys: string[] = [];
  let creates = 0;
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { membership: null } },
      });
    keys.push(request.headers()["idempotency-key"] ?? "");
    creates += 1;
    return creates === 1
      ? route.fulfill({
          status: 409,
          json: {
            contractVersion: 1,
            error: {
              code: "idempotency_conflict",
              message: "private",
              retryable: true,
            },
          },
        })
      : route.fulfill({
          status: 200,
          json: { contractVersion: 1, data: { membershipId } },
        });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Your Group" })).toBeVisible();
  await page.getByLabel("Group name").fill("Morning crew");
  await page.getByLabel("Weekly target").first().fill("3");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Action conflicts with current Group state.",
  );
  await expect(page.getByLabel("Group name")).toHaveValue("Morning crew");
  findings.get(page)?.console.splice(0);
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("status")).toHaveText("Group created.");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("compact enlarged-text Group entry has no serious axe or overflow", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/sign-in");
  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  const findings = await new AxeBuilder({ page }).analyze();
  expect(
    findings.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});
