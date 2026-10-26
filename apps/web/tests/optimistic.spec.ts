import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { delayRoute, msUntilVisible } from "./timing";

const membershipId = "30000000-0000-4000-8000-000000000001";
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
const groupId = "40000000-0000-4000-8000-000000000001";
const invitationId = "60000000-0000-4000-8000-000000000001";
const hiddenProofId = "70000000-0000-4000-8000-000000000009";
const attemptId = "80000000-0000-4000-8000-000000000002";
const claimId = "80000000-0000-4000-8000-000000000003";
const pauseRequestId = "80000000-0000-4000-8000-000000000004";
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
// 1x1 PNG; the app re-encodes it to JPEG before upload.
const proofPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const failure = (status: number) => ({
  status,
  json: {
    contractVersion: 1,
    error: { code: "domain_failure", message: "private", retryable: true },
  },
});
const budget = 100;

// One in-memory server; tests flip `fail` entries to make one action fail.
async function mockServer(page: Page, options: { member?: boolean } = {}) {
  const server = {
    member: options.member ?? true,
    count: 2,
    uploads: 0,
    checkIns: [] as string[],
    creates: 0,
    checkInMode: "ok" as "ok" | "fail" | "denied" | "lost",
    fail: new Set<string>(),
    invitations: [
      {
        invitationId,
        email: "friend@example.test",
        expiresAt: "2026-10-23T00:00:00.000Z",
      },
    ],
    hidden: true,
    consequences: {
      owed: 1,
      offer: null,
      attempt: {
        attemptId,
        status: "active" as "active" | "safety_paused",
        title: "50 burpees",
        instructions: "Complete 50 burpees, any sets.",
        expiresAt: new Date(Date.now() + 40 * 3_600_000).toISOString(),
        approvals: 0,
        approvalsNeeded: 2,
        pauseRequest: null as null | Record<string, number>,
      } as Record<string, unknown> | null,
      reviews: [
        {
          claimId,
          memberName: "Maya",
          title: "100 push-ups",
          instructions: "Complete 100 push-ups, any sets.",
          myResponse: null as string | null,
        },
      ],
      pauseReviews: [
        {
          pauseRequestId,
          memberName: "Jordan",
          title: "5 km run",
          myVote: null as string | null,
        },
      ],
      logBlocked: false,
      groupOwed: {},
    },
  };
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) =>
    route.fulfill({ status: 200, json: { Key: "proof-photos/x" } }),
  );
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    const failing = (name: string) => server.fail.has(name);
    if (path.endsWith("/current"))
      return ok({
        membership: server.member ? { groupId, membershipId } : null,
      });
    if (path === "/v1/push") return ok({ publicKey: null });
    if (path === "/v1/account/display-name") {
      if (method === "PUT") {
        if (failing("name")) return route.fulfill(failure(500));
        return ok({ displayName: request.postDataJSON().displayName });
      }
      return ok({ displayName: "Akrum" });
    }
    if (path === "/v1/consent") {
      if (failing("consent")) return route.fulfill(failure(500));
      return ok({ accepted: true });
    }
    if (path.endsWith("/current-week-progress"))
      return ok([
        {
          membershipId,
          displayName: "Akrum",
          lockedTarget: 4,
          completedWorkoutCount: server.count,
          activityTypes: Array(server.count).fill("cardio"),
          targetStreak: 0,
          workoutStreak: server.count,
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 2,
          completedWorkoutCount: 1,
          activityTypes: ["cardio"],
          targetStreak: 0,
          workoutStreak: 1,
        },
      ]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path.endsWith("/weekly-target")) {
      if (method === "PUT") {
        if (failing("target")) return route.fulfill(failure(500));
        return ok({
          membershipId,
          weeklyTarget: request.postDataJSON().weeklyTarget,
        });
      }
      return ok({
        membershipId,
        recurringTarget: 4,
        lockedTarget: 4,
        nextWeekStartsAt: "2026-10-19T05:00:00.000Z",
        memberCount: 2,
        timeZone: "America/Chicago",
      });
    }
    if (path.endsWith("/members"))
      return ok({
        groupName: "6AM Crew",
        members: [
          {
            membershipId,
            displayName: "Akrum",
            weeklyTarget: 4,
            creator: true,
          },
          {
            membershipId: friendMembershipId,
            displayName: "Maya",
            weeklyTarget: 2,
            creator: false,
          },
        ],
      });
    if (path.endsWith("/pending-invitations")) return ok(server.invitations);
    if (path.endsWith("/revoke")) {
      if (failing("revoke")) return route.fulfill(failure(500));
      server.invitations = [];
      return ok({ invitationId });
    }
    if (path === "/v1/groups" && method === "POST") {
      server.creates++;
      return ok({ membershipId });
    }
    if (path === "/v1/group-invitations")
      return ok({
        invitationId: request.postDataJSON().invitationId,
        token: "invite-token",
        expiresAt: "2026-10-23T00:00:00.000Z",
      });
    if (path === "/v1/nudges") return ok([]);
    if (path === "/v1/proof/feed")
      return ok([
        {
          workoutCheckinId: hiddenProofId,
          authorMembershipId: friendMembershipId,
          authorName: "Maya",
          mine: false,
          activityType: "strength",
          durationMinutes: 45,
          perceivedIntensity: "high",
          completedAt: "2026-10-12T15:00:00.000Z",
          submittedAt: "2026-10-12T15:05:00.000Z",
          reviewStatus: "verified",
          reviewClosesAt: null,
          decisionClosesAt: null,
          hidden: server.hidden,
          myVote: null,
          acceptVotes: 0,
          rejectVotes: 0,
          eligibleVoters: 0,
          canReview: false,
          canVote: false,
          activityPhotoUrl: photo,
          presencePhotoUrl: photo,
          reactions: [],
          myReactions: [],
        },
      ]);
    if (path === `/v1/proof/${hiddenProofId}/moderate`) {
      if (failing("moderate")) return route.fulfill(failure(500));
      server.hidden = false;
      return ok({ status: "restored" });
    }
    if (path === "/v1/consequences") return ok(server.consequences);
    if (path.startsWith("/v1/consequences/")) {
      const action = path.split("/").pop();
      if (action && failing(action)) return route.fulfill(failure(500));
      const { choice } = request.postDataJSON();
      const home = server.consequences;
      if (action === "request_pause" && home.attempt)
        home.attempt.pauseRequest = {
          approvals: 0,
          rejections: 0,
          approvalsNeeded: 2,
        };
      if (action === "respond") home.reviews[0].myResponse = choice;
      if (action === "vote_pause") home.pauseReviews[0].myVote = choice;
      if (action === "resume") home.attempt = null;
      return ok(home);
    }
    if (path === "/v1/proof/uploads") {
      server.uploads++;
      return ok({
        path: `20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-00000000000${server.uploads}.jpg`,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/proof-photos/${server.uploads}?token=t`,
      });
    }
    if (path === "/v1/workout-check-ins") {
      const body = request.postDataJSON();
      server.checkIns.push(request.headers()["idempotency-key"] ?? "");
      if (server.checkInMode === "fail") return route.fulfill(failure(500));
      if (server.checkInMode === "lost") {
        // The server logs it once, but the response never arrives.
        const key = request.headers()["idempotency-key"];
        if (server.checkIns.filter((entry) => entry === key).length === 1)
          server.count++;
        return route.fulfill(failure(500));
      }
      if (server.checkInMode === "denied")
        return route.fulfill({
          status: 403,
          json: {
            contractVersion: 1,
            error: { code: "denied", message: "private", retryable: false },
          },
        });
      server.count++;
      return ok({
        workoutCheckinId: body.workoutCheckinId,
        currentWeekCount: server.count,
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return server;
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("status of"))
      errors.push(message.text());
  });
  return errors;
}

async function timed(
  page: Page,
  testInfo: TestInfo,
  label: string,
  action: () => Promise<unknown>,
  target: ReturnType<Page["getByText"]>,
) {
  const ms = await msUntilVisible(page, action, target);
  testInfo.annotations.push({
    type: "timing",
    description: `${label}: ${ms.toFixed(1)}ms`,
  });
  console.log(`[timing] ${label}: ${ms.toFixed(1)}ms`);
  expect(ms, label).toBeLessThanOrEqual(budget);
}

async function fillWorkout(page: Page) {
  await page.getByRole("button", { name: "Log workout" }).click();
  const dialog = page.getByRole("dialog", { name: "Log a workout" });
  await dialog.getByRole("button", { name: "Strength" }).click();
  await dialog.getByRole("button", { name: "45 min" }).click();
  const inputs = dialog.locator('input[type="file"]');
  for (const index of [0, 1])
    await inputs.nth(index).setInputFiles({
      name: `proof-${index}.png`,
      mimeType: "image/png",
      buffer: proofPng,
    });
  await expect(
    dialog.getByRole("img", { name: "Your presence preview" }),
  ).toBeVisible();
  return dialog;
}

test("check-in shows at once, then confirms, retries and discards in the background", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const server = await mockServer(page);
  await signIn(page);
  await expect(
    page.getByText("2 of 4 this week", { exact: true }),
  ).toBeVisible();
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);
  await delayRoute(page, "http://127.0.0.1:54321/storage/v1/**", 1000);
  const sending = page.getByRole("list", { name: "Your workouts sending" });

  // Success: sheet closes, count bumps and an Uploading entry shows at once.
  let dialog = await fillWorkout(page);
  await timed(
    page,
    testInfo,
    "check-in entry",
    () => dialog.getByRole("button", { name: "Log workout" }).click(),
    sending.getByText("Uploading…"),
  );
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("3 of 4 this week", { exact: true }),
  ).toBeVisible();
  // The rest of Home stays usable while the workout uploads.
  await page.getByRole("button", { name: "Log workout" }).click();
  await expect(
    page.getByRole("dialog", { name: "Log a workout" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sending.getByText("Uploading…")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("check-in-uploading.png"),
  });
  await expect(sending).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByText(/^Workout logged\. 3 of 4 this week\./),
  ).toBeVisible();
  await expect(
    page.getByText("3 of 4 this week", { exact: true }),
  ).toBeVisible();
  expect(server.uploads).toBe(2);

  // Failure: the entry offers Retry; Retry reuses the uploaded photos.
  server.checkInMode = "fail";
  dialog = await fillWorkout(page);
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(
    page.getByText("4 of 4 this week", { exact: true }),
  ).toBeVisible();
  await expect(sending.getByText("Couldn’t upload")).toBeVisible({
    timeout: 10_000,
  });
  await expect(sending.getByRole("alert")).toHaveText(
    "Action failed. Try again.",
  );
  await expect(
    page.getByText("3 of 4 this week", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("check-in-failed.png"),
  });
  const uploadsBeforeRetry = server.uploads;
  const keysBeforeRetry = new Set(server.checkIns.slice(1));
  server.checkInMode = "ok";
  await timed(
    page,
    testInfo,
    "check-in retry",
    () => sending.getByRole("button", { name: "Retry" }).click(),
    sending.getByText("Uploading…"),
  );
  await expect(
    page.getByText("4 of 4 this week", { exact: true }),
  ).toBeVisible();
  await expect(sending).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByText("4 of 4 this week", { exact: true }),
  ).toBeVisible();
  expect(server.uploads).toBe(uploadsBeforeRetry);
  expect(keysBeforeRetry.size).toBe(1);
  expect(new Set(server.checkIns.slice(1)).size).toBe(1);

  // Domain failure: the existing message shows on the entry; Discard drops it.
  server.checkInMode = "denied";
  dialog = await fillWorkout(page);
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(sending.getByRole("alert")).toHaveText(
    "Finish your Consequence card before logging workouts.",
    { timeout: 10_000 },
  );
  await expect(
    page.getByText("4 of 4 this week", { exact: true }),
  ).toBeVisible();
  await sending.getByRole("button", { name: "Discard" }).click();
  await expect(sending).toHaveCount(0);
  await expect(
    page.getByText("4 of 4 this week", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Home decisions, pause, target and Wall restore show at once and undo on failure", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const server = await mockServer(page);
  await signIn(page);
  const cards = page.getByRole("region", { name: "Consequence cards" });
  await expect(cards.getByText("Maya")).toBeVisible();
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);

  // A failed response rolls back only that change.
  server.fail.add("respond");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByText("You approved Maya’s 100 push-ups."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  server.fail.delete("respond");

  await timed(
    page,
    testInfo,
    "card respond",
    () => page.getByRole("button", { name: "Approve", exact: true }).click(),
    page.getByText("You approved Maya’s 100 push-ups."),
  );
  // Another control stays usable while the response is in flight.
  await timed(
    page,
    testInfo,
    "pause vote",
    () => page.getByRole("button", { name: "Approve pause" }).click(),
    page.getByText("You approved Jordan’s pause."),
  );
  await page.getByRole("button", { name: "Request a pause" }).click();
  await timed(
    page,
    testInfo,
    "pause request",
    () =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Request pause" })
        .click(),
    page.getByText(/^Pause requested: 0 of 2 approvals/),
  );

  // Wall restore by the Group admin.
  await timed(
    page,
    testInfo,
    "wall restore",
    () => page.getByRole("button", { name: "Restore" }).click(),
    page.getByRole("button", { name: "Report photos" }),
  );
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("home-decisions.png"),
  });

  // Cached cards render at once on reload while the API is still slow.
  await page.reload();
  await expect(cards.locator(".consequence-strip")).toBeVisible({
    timeout: 900,
  });

  // Resume after an approved pause.
  server.consequences.attempt = {
    ...server.consequences.attempt,
    status: "safety_paused",
  };
  await page.reload();
  await expect(page.getByRole("button", { name: "I’m ready" })).toBeVisible();
  await timed(
    page,
    testInfo,
    "resume",
    () => page.getByRole("button", { name: "I’m ready" }).click(),
    page.getByText("Ready. Pick a fresh card."),
  );
  await expect(page.getByRole("button", { name: "I’m ready" })).toHaveCount(0);

  // Weekly target: instant, then undone on failure.
  await page.getByRole("link", { name: "Change target" }).click();
  await page.getByRole("button", { name: "Increase weekly target" }).click();
  await timed(
    page,
    testInfo,
    "set target",
    () => page.getByRole("button", { name: "Save for next week" }).click(),
    page.getByText("Saved. From Oct 19 your target is 5."),
  );
  server.fail.add("target");
  await page.getByRole("button", { name: "Increase weekly target" }).click();
  await page.getByRole("button", { name: "Save for next week" }).click();
  await expect(
    page.getByText("Saved. From Oct 19 your target is 6."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  expect(errors).toEqual([]);
});

test("Group and Account actions are instant, per control, and sign-out clears caches", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const server = await mockServer(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page);
  await expect(
    page.getByText("2 of 4 this week", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Group" }).click();
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByText("friend@example.test")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Cached Group and invitations render at once on reload with a slow API.
  const undoSlow = await delayRoute(page, "http://127.0.0.1:8787/v1/**", 3000);
  await page.reload();
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible({
    timeout: 1000,
  });
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(page.getByText("friend@example.test")).toBeVisible({
    timeout: 1000,
  });
  await page.getByRole("button", { name: "Done" }).click();
  await undoSlow();
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);

  // A pending invite holds only its own button; revoke still works.
  await page.getByLabel("Friend email").fill("new@example.test");
  await page.getByRole("button", { name: "Invite a friend" }).click();
  await expect(
    page.getByRole("button", { name: "Creating invite…" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Manage" }).click();
  server.fail.add("revoke");
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("friend@example.test")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  await expect(page.getByText("friend@example.test")).toBeVisible();
  server.fail.delete("revoke");
  await timed(
    page,
    testInfo,
    "revoke invite",
    () => page.getByRole("button", { name: "Revoke" }).click(),
    page.getByText("Invitation revoked."),
  );
  await expect(page.getByText("friend@example.test")).toHaveCount(0);

  // Account name and sign-out.
  await page.getByRole("link", { name: "Account" }).click();
  const name = page.getByRole("textbox", { name: "Name" });
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue("Akrum");
  await name.fill("Akrum B");
  await timed(
    page,
    testInfo,
    "save name",
    () => page.getByRole("button", { name: "Save name" }).click(),
    page.getByText("Name saved."),
  );
  server.fail.add("name");
  await name.fill("Broken");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  await expect(name).toHaveValue("Akrum B");
  const cached = () =>
    page.evaluate(() =>
      ["consequences", "invitations", "weekly", "group"].filter(
        (key) => localStorage.getItem(`no-excuses:cache:${key}`) !== null,
      ),
    );
  expect(await cached()).toEqual(
    expect.arrayContaining(["consequences", "invitations"]),
  );
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("account-before-sign-out.png"),
  });
  await timed(
    page,
    testInfo,
    "sign out",
    () => page.getByRole("button", { name: "Sign out" }).click(),
    page.getByRole("heading", { name: "Sign in required" }),
  );
  expect(await cached()).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("signed-out-desktop.png"),
  });
  expect(errors).toEqual([]);
});

test("onboarding About you waits for consent and never creates after it fails", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const server = await mockServer(page, { member: false });
  await signIn(page);
  await expect(page.getByText("Step 1 of 3 · About you")).toBeVisible();
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);
  await page.getByLabel("What should your crew call you?").fill("Akrum");
  await page.getByLabel("I’m 18 or older").check();
  await page.getByLabel("I understand this is an early-access pilot").check();
  await page.getByLabel("I agree to the terms and how my data is used").check();
  server.fail.add("consent");
  // Consent is pending on its own control until the server records it.
  await timed(
    page,
    testInfo,
    "onboarding consent pending",
    () => page.getByRole("button", { name: "Continue" }).click(),
    page.getByRole("button", { name: "Saving…" }),
  );
  await expect(page.getByRole("alert")).toHaveText("Action failed. Try again.");
  await expect(page.getByText("Step 1 of 3 · About you")).toBeVisible();
  await expect(page.getByText("Step 2 of 3 · Your crew")).toHaveCount(0);
  expect(server.creates).toBe(0);
  server.fail.delete("consent");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 3 · Your crew")).toBeVisible();
  await page.getByLabel("Crew name").fill("6AM Crew");
  await timed(
    page,
    testInfo,
    "start a crew",
    () => page.getByRole("button", { name: "Continue" }).click(),
    page.getByText("Step 3 of 3 · Your target"),
  );
  await page.getByRole("button", { name: "Start 6AM Crew" }).click();
  await expect.poll(() => server.creates).toBe(1);
  expect(errors).toEqual([]);
});

// Holds Auth logout calls; `mode` picks how each one ends.
async function holdLogout(
  page: Page,
  mode: "slow" | "error" | "abort",
  calls: { count: number },
) {
  await page.route("http://127.0.0.1:54321/auth/v1/logout**", async (route) => {
    calls.count++;
    if (mode === "abort") return route.abort("internetdisconnected");
    if (mode === "error")
      return route.fulfill({ status: 500, json: { message: "down" } });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ status: 204 }).catch(() => undefined);
  });
}

test("signing back in during a slow sign-out stays signed in", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  await mockServer(page);
  const logouts = { count: 0 };
  await holdLogout(page, "slow", logouts);
  await signIn(page);
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  await signIn(page);
  // Verify waits for the old sign-out, so it can never remove the new session.
  await expect(page).toHaveURL("http://127.0.0.1:4174/home", {
    timeout: 10_000,
  });
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  expect(logouts.count).toBe(1);
  await page.reload();
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("signed-back-in.png"),
  });
  expect(errors).toEqual([]);
});

for (const mode of ["slow", "error", "abort"] as const)
  test(`a ${mode} logout never restores the previous member`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockServer(page);
    const logouts = { count: 0 };
    await holdLogout(page, mode, logouts);
    await signIn(page);
    await expect(page.getByText("2 of 4 this week")).toBeVisible();
    await page.getByRole("link", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    const signedOut = page.getByRole("heading", { name: "Sign in required" });
    await expect(signedOut).toBeVisible();
    // Focus and a reload while the logout is still in flight or failed.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(signedOut).toBeVisible();
    await page.reload();
    await expect(signedOut).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.reload();
    await expect(signedOut).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("2 of 4 this week")).toHaveCount(0);
  });

test("sign-out reaches other tabs and leaves other projects' sessions", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockServer(page);
  await signIn(page);
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem("sb-otherproj-auth-token", '{"other":true}'),
  );
  const other = await context.newPage();
  await other.setViewportSize({ width: 390, height: 844 });
  await mockServer(other);
  await other.goto("/home");
  await expect(other.getByText("2 of 4 this week")).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  await expect(
    other.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible({ timeout: 3000 });
  await expect(other.getByText("2 of 4 this week")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("sb-otherproj-auth-token")),
  ).toBe('{"other":true}');
});

test("a token refresh landing during sign-out keeps the member signed out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await mockServer(page);
  let refreshes = 0;
  await page.route("http://127.0.0.1:54321/auth/v1/token**", async (route) => {
    refreshes++;
    await new Promise((resolve) => setTimeout(resolve, 9000));
    await route
      .fulfill({
        status: 200,
        json: { ...session, access_token: "refreshed", expires_in: 3600 },
      })
      .catch(() => undefined);
  });
  await page.route("http://127.0.0.1:54321/auth/v1/verify", (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...session,
        expires_in: 200,
        expires_at: Math.floor(Date.now() / 1000) + 200,
      },
    }),
  );
  await signIn(page);
  await expect(page.getByText("2 of 4 this week")).toBeVisible();
  await page.getByRole("link", { name: "Account" }).click();
  // Bring the session inside the refresh window, then start a refresh.
  await page.clock.fastForward(150_000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  const signedOut = page.getByRole("heading", { name: "Sign in required" });
  await expect(signedOut).toBeVisible();
  await page.waitForTimeout(10_000);
  await expect(signedOut).toBeVisible();
  await expect(page.getByText("Access check failed")).toHaveCount(0);
});

test("discarding a workout whose response was lost reconciles the count", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = watchErrors(page);
  const server = await mockServer(page);
  await signIn(page);
  await expect(
    page.getByText("2 of 4 this week", { exact: true }),
  ).toBeVisible();
  server.checkInMode = "lost";
  const dialog = await fillWorkout(page);
  await dialog.getByRole("button", { name: "Log workout" }).click();
  const sending = page.getByRole("list", { name: "Your workouts sending" });
  await expect(sending.getByText("Couldn’t upload")).toBeVisible({
    timeout: 10_000,
  });
  await sending.getByRole("button", { name: "Discard" }).click();
  await expect(sending).toHaveCount(0);
  await expect(
    page.getByText(
      "Discarded here. It may already be logged; your count will update.",
    ),
  ).toBeVisible();
  // The server logged it once; the count catches up.
  expect(server.count).toBe(3);
  await expect(
    page.getByText("3 of 4 this week", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
