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

async function mockApi(page: Page, member: boolean, denyInvite = true) {
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
    if (path === "/v1/consent")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { accepted: true } },
      });
    if (path === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: member ? { groupId, membershipId } : null },
        },
      });
    if (path === "/v1/group-invitations/preview") {
      if (new URL(request.url()).searchParams.get("token") === "expired")
        return route.fulfill({
          status: 403,
          json: {
            contractVersion: 1,
            error: { code: "denied", message: "unavailable", retryable: false },
          },
        });
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            groupName: "6AM Crew",
            memberCount: 5,
            weekEndsAt: "2026-09-28T05:00:00.000Z",
          },
        },
      });
    }
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
    if (path === `/v1/groups/${groupId}/members`)
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            groupName: "6AM Crew",
            members: [
              {
                membershipId,
                displayName: "Akrum Eltoum",
                weeklyTarget: 4,
                creator: true,
              },
              {
                membershipId: "30000000-0000-4000-8000-000000000002",
                displayName: "Jordan Park",
                weeklyTarget: 3,
                creator: false,
              },
            ],
          },
        },
      });
    if (path === `/v1/groups/${groupId}/pending-invitations`)
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: [
            {
              invitationId: "50000000-0000-4000-8000-000000000001",
              email: "pending@example.test",
              expiresAt: "2026-09-30T12:00:00.000Z",
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
    if (path === "/v1/group-invitations" && denyInvite)
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
    if (path === "/v1/group-invitations")
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            invitationId: "50000000-0000-4000-8000-000000000002",
            token: "NX-7Q4K-2M9P",
            expiresAt: "2026-09-30T12:00:00.000Z",
          },
        },
      });
    if (path.endsWith("/revoke"))
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            invitationId: "50000000-0000-4000-8000-000000000001",
            status: "revoked",
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
  await expect(page.getByRole("heading", { name: "You" })).toBeVisible();
  await expect(page.getByLabel("Your identity")).toContainText("Akrum");
  await expect(page.getByLabel("Your identity")).toContainText(
    "member@example.test",
  );
  await expect(
    page.getByRole("link", { name: /Crew.*6AM Crew/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Weekly target.*4 a week/ }),
  ).toHaveAttribute("href", "/target");
  await page
    .getByRole("button", { name: /Install on your home screen/ })
    .click();
  await expect(page.getByText(/In Safari, tap Share/)).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const name = page.getByLabel("Name");
  await expect(name).toHaveValue("Akrum");
  await name.fill("Akrum Eltoum");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toHaveText("Name saved.");
  await expect(name).toHaveValue("Akrum Eltoum");
});

test("Account crew load failure is honest and retryable", async ({ page }) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  let failRoster = true;
  await page.route(/\/v1\/groups\/[^/]+\/members$/, (route) => {
    if (!failRoster) return route.fallback();
    return route.fulfill({
      status: 503,
      json: {
        contractVersion: 1,
        error: { code: "unavailable", message: "unavailable", retryable: true },
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.goto("/account");
  await expect(page.getByText("Couldn’t load your crew.")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
  failRoster = false;
  findings.get(page)?.console.splice(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("link", { name: /Crew.*6AM Crew/ }),
  ).toBeVisible();
  findings.get(page)?.console.splice(0);
  findings.get(page)?.page.splice(0);
  findings.get(page)?.network.splice(0);
});

test("failed Account name load never shows the previous signed-in name", async ({
  page,
}) => {
  let secondAccount = false;
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.route(/\/auth\/v1\/(verify|user)$/, (route) => {
    const nextSession = {
      ...session,
      user: {
        ...session.user,
        email: secondAccount ? "second@example.test" : "first@example.test",
      },
    };
    return route.fulfill({
      status: 200,
      json: route.request().url().endsWith("/user")
        ? nextSession.user
        : nextSession,
    });
  });
  await page.route(/\/v1\/account\/display-name$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (secondAccount)
      return route.fulfill({
        status: 503,
        json: {
          contractVersion: 1,
          error: {
            code: "unavailable",
            message: "unavailable",
            retryable: true,
          },
        },
      });
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: { displayName: "Account A" } },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("first@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.goto("/account");
  await expect(page.getByLabel("Your identity")).toContainText("Account A");
  await page.getByRole("button", { name: "Sign out" }).click();
  secondAccount = true;
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("second@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.goto("/account");
  await expect(page.getByRole("alert")).toHaveText("Couldn’t load your name.");
  await expect(page.getByLabel("Your identity")).toContainText(
    "second@example.test",
  );
  await expect(page.getByLabel("Your identity")).not.toContainText("Account A");
  findings.get(page)?.console.splice(0);
  findings.get(page)?.page.splice(0);
  findings.get(page)?.network.splice(0);
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

test("no-Group onboarding saves About you then starts a crew", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, false);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();

  await expect(page.getByText("Step 1 of 3 · About you")).toBeVisible();
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await page.getByLabel("What should your crew call you?").fill("Akrum");
  await page.getByLabel("I’m 18 or older").check();
  await page.getByLabel("I’m joining this private pilot").check();
  await page.getByLabel("I agree to the terms and how my data is used").check();
  await continueButton.click();
  await expect(page.getByText("Step 2 of 3 · Your crew")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  await page.getByLabel("Crew name").fill("6AM Crew");
  await Promise.all([
    page.getByRole("button", { name: "Saving…" }).waitFor(),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  await expect(page.getByText("Step 3 of 3 · Your target")).toBeVisible();
  await expect(
    page.getByText(
      "We suggest at least 2. You can change it for any future week.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Decrease weekly target" }).click();
  await expect(page.getByText("1 workouts")).toBeVisible();
  await page.getByRole("button", { name: "Start 6AM Crew" }).click();
  await expect(page.getByRole("status")).toHaveText("Group created.");
});

test("join onboarding previews eligible crew and rejects unavailable code", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, false);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByLabel("I’m 18 or older").check();
  await page.getByLabel("I’m joining this private pilot").check();
  await page.getByLabel("I agree to the terms and how my data is used").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I have a code" }).click();
  await page.getByLabel("Invitation code").fill("expired");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("That code has expired. Ask your friend for a new one."),
  ).toBeVisible();
  findings.get(page)?.console.splice(0);
  await page.getByLabel("Invitation code").fill("eligible");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 3 of 3 · Your target")).toBeVisible();
  await expect(page.getByText("6AM Crew", { exact: true })).toBeVisible();
  await expect(page.getByText(/5 members\. This week ends/)).toBeVisible();
  await expect(page.getByText("This week (starting today)")).toBeVisible();
  await expect(page.getByText("Every week after")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join 6AM Crew" }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Invite a friend" }).click();
  await expect(page.getByRole("alert")).toHaveText("Action denied.");
  await expect(page.getByText("private detail")).toHaveCount(0);
  findings.get(page)?.console.splice(0);
});

test("Group roster, invitation card, and creator Manage use row actions without IDs", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, true, false);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      mutations.push(new URL(request.url()).pathname);
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByRole("link", { name: "Group" }).click();

  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  await expect(page.getByText("2 members")).toBeVisible();
  await expect(page.getByText("Akrum Eltoum")).toBeVisible();
  await expect(page.getByText("4 a week")).toBeVisible();
  await expect(page.getByLabel("Invitation ID")).toHaveCount(0);
  await expect(page.getByLabel("Membership ID")).toHaveCount(0);

  await page.getByLabel("Friend email").fill("friend@example.test");
  await page.getByRole("button", { name: "Invite a friend" }).click();
  await expect(page.getByText("NX-7Q4K-2M9P")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
  await expect(
    page.getByText("Send it privately. It works once and expires in 7 days."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);
  await expect(page.getByText("pending@example.test")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Leave 6AM Crew" }),
  ).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(
    page.getByText("Member removed.", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(
    page.getByText("Invitation revoked.", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Leave 6AM Crew" }).click();
  await expect(
    page.getByText("You left 6AM Crew.", { exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual(
    expect.arrayContaining([
      `/v1/groups/${groupId}/members/30000000-0000-4000-8000-000000000002/remove`,
      "/v1/group-invitations/50000000-0000-4000-8000-000000000001/revoke",
      "/v1/group-memberships/leave",
    ]),
  );
});

test("failed Group load retries into ten-member scroll above tab bar", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  let attempts = 0;
  await page.route(
    `http://127.0.0.1:8787/v1/groups/${groupId}/members`,
    (route) => {
      attempts += 1;
      if (attempts === 1)
        return route.fulfill({
          status: 500,
          json: {
            contractVersion: 1,
            error: {
              code: "domain_failure",
              message: "hidden",
              retryable: true,
            },
          },
        });
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: {
            groupName: "10AM Crew",
            members: Array.from({ length: 10 }, (_, index) => ({
              membershipId:
                index === 0
                  ? membershipId
                  : `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
              displayName: `Member ${index + 1}`,
              weeklyTarget: index + 1,
              creator: index === 0,
            })),
          },
        },
      });
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByText("Couldn’t load your crew.")).toBeVisible();
  findings.get(page)?.console.splice(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("10 members")).toBeVisible();
  await page.getByText("Member 10").scrollIntoViewIfNeeded();
  await expect(page.getByText("Member 10")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Member destinations" }),
  ).toBeVisible();
});

test("exact Account deletion confirmation cuts off browser session", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.getByRole("button", { name: "Delete account…" }).click();
  const deletionSheet = page.getByRole("dialog", { name: "Delete account" });
  await expect(
    deletionSheet.getByRole("button", { name: "Close" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(deletionSheet).toBeVisible();
  const scrim = page.getByLabel("Close dialog");
  await expect(scrim).toBeDisabled();
  await scrim.dispatchEvent("click");
  await expect(deletionSheet).toBeVisible();
  await expect(deletionSheet.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByText("You leave 6AM Crew right away.")).toBeVisible();
  await page.getByRole("button", { name: "Email me a code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Deletion code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText(
      "Code ready. Final confirmation will verify identity before deletion.",
    ),
  ).toBeVisible();
  await page.getByLabel("Confirmation").fill("delete");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert")).toHaveText("Type DELETE exactly.");
  await expect(page.getByLabel("Confirmation")).toHaveValue("delete");
  await page.getByLabel("Confirmation").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
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

test("Account deletion failure keeps account and exact retry guidance", async ({
  page,
}) => {
  await mockSignedOut(page);
  await mockApi(page, true);
  await page.route(/\/v1\/account$/, (route) => {
    return route.fulfill({
      status: 503,
      json: {
        contractVersion: 1,
        error: { code: "unavailable", message: "unavailable", retryable: true },
      },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await fillCode(page, "123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "You" })).toBeVisible();
  findings.get(page)?.console.splice(0);
  findings.get(page)?.page.splice(0);
  findings.get(page)?.network.splice(0);
  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.getByRole("button", { name: "Email me a code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Deletion code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Confirmation").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Deletion didn't go through. Your account is unchanged — try again.",
  );
  await expect(
    page.getByRole("dialog", { name: "Delete account" }),
  ).toBeVisible();
  findings.get(page)?.console.splice(0);
  findings.get(page)?.network.splice(0);
  await page.getByRole("button", { name: "Keep my account" }).click();
  await expect(page.getByRole("heading", { name: "You" })).toBeVisible();
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
  await page.getByRole("button", { name: "Delete account…" }).click();
  await page.getByRole("button", { name: "Email me a code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Deletion code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Confirmation").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();
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
    const path = new URL(request.url()).pathname;
    if (path === "/v1/group-memberships/current")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { membership: null } },
      });
    if (path === "/v1/account/display-name")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { displayName: "Akrum" } },
      });
    if (path === "/v1/consent")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: { accepted: true } },
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
  await page.getByLabel("I’m 18 or older").check();
  await page.getByLabel("I’m joining this private pilot").check();
  await page.getByLabel("I agree to the terms and how my data is used").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Crew name").fill("Morning crew");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Increase weekly target" }).click();
  await page.getByRole("button", { name: "Start Morning crew" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Action conflicts with current Group state.",
  );
  await expect(page.getByText("3 workouts")).toBeVisible();
  findings.get(page)?.console.splice(0);
  await page.getByRole("button", { name: "Start Morning crew" }).click();
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
