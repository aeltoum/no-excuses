import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { homeExtras } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

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
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
const offerId = "80000000-0000-4000-8000-000000000001";
const attemptId = "80000000-0000-4000-8000-000000000002";
const claimId = "80000000-0000-4000-8000-000000000003";
const pauseRequestId = "80000000-0000-4000-8000-000000000004";
const challengeId = "80000000-0000-4000-8000-000000000005";
const clipPath = `20000000-0000-4000-8000-000000000001/${challengeId}.webm`;
const friendClipUrl =
  "http://127.0.0.1:54321/storage/v1/object/sign/consequence-clips/friend.webm?token=t";
const cards = [
  [
    "90000000-0000-4000-8000-000000000001",
    "50 burpees",
    "Complete 50 burpees, any sets.",
  ],
  [
    "90000000-0000-4000-8000-000000000002",
    "100 push-ups",
    "Complete 100 push-ups, any sets.",
  ],
  [
    "90000000-0000-4000-8000-000000000003",
    "5 km run",
    "Run 5 km in one session on the same day.",
  ],
].map(([cardId, title, instructions]) => ({
  cardId,
  title,
  instructions,
  unlockedByFriend: false,
}));

const extra = {
  cardId: "90000000-0000-4000-8000-000000000004",
  title: "200 jumping jacks",
  instructions: "Complete 200 jumping jacks, any sets.",
  unlockedByFriend: true,
};

test("owed Consequence card is picked, completed, and friends' claims approved", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const actions: string[] = [];
  let state: Record<string, unknown> = {
    owed: 1,
    offer: { offerId, canRedraw: true, cards: cards.slice(0, 2).concat(extra) },
    attempt: null,
    reviews: [
      {
        claimId,
        memberName: "Maya",
        title: "100 push-ups",
        instructions: "Complete 100 push-ups, any sets.",
        clipUrl: friendClipUrl,
        myResponse: null,
      },
    ],
    pauseReviews: [
      {
        pauseRequestId,
        memberName: "Maya",
        title: "200 jumping jacks",
        myVote: null,
      },
    ],
    logBlocked: true,
    groupOwed: { [membershipId]: 1, [friendMembershipId]: 2 },
  };
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
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(request.headers().authorization).toBe("Bearer live-access");
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({ membership: { groupId, membershipId } });
    if (path.endsWith("/current-week-progress"))
      return ok([
        {
          membershipId,
          displayName: "Akrum",
          lockedTarget: 3,
          completedWorkoutCount: 1,
          activityTypes: ["cardio"],
          targetStreak: 1,
          workoutStreak: 3,
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 3,
          completedWorkoutCount: 2,
          activityTypes: ["strength", "class"],
          targetStreak: 1,
          workoutStreak: 3,
        },
      ]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path.endsWith("/weekly-target"))
      return ok({
        membershipId,
        recurringTarget: 3,
        lockedTarget: 3,
        nextWeekStartsAt: null,
        memberCount: 2,
        timeZone: "UTC",
      });
    if (path === "/v1/proof/feed") return ok([]);
    if (path === "/v1/nudges") return ok([]);
    if (path === "/v1/consequences") return ok(state);
    if (path === "/v1/consequences/challenge") {
      actions.push(`challenge:${request.postDataJSON().attemptId}`);
      return ok({
        challengeId,
        code: "042",
        action: "Hold up 3 fingers",
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
    }
    if (path === "/v1/consequences/clip-upload") {
      const body = request.postDataJSON();
      actions.push(`clip-upload:${body.challengeId}:${body.mimeType}`);
      return ok({
        path: clipPath,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/consequence-clips/${clipPath}?token=u`,
      });
    }
    const action = /^\/v1\/consequences\/(\w+)$/.exec(path)?.[1];
    if (action) {
      const body = request.postDataJSON();
      actions.push(`${action}:${body.target}:${body.choice}`);
      if (action === "redraw")
        state = { ...state, offer: { offerId, canRedraw: false, cards } };
      if (action === "select")
        state = {
          ...state,
          offer: null,
          attempt: {
            attemptId,
            status: "active",
            title: "5 km run",
            instructions: "Run 5 km in one session on the same day.",
            expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
            approvals: 0,
            approvalsNeeded: 2,
            pauseRequest: null,
          },
        };
      if (action === "request_pause")
        state = {
          ...state,
          attempt: {
            ...(state.attempt as object),
            pauseRequest: { approvals: 0, rejections: 0, approvalsNeeded: 2 },
          },
        };
      if (action === "vote_pause")
        state = {
          ...state,
          pauseReviews: [
            {
              ...(state.pauseReviews as object[])[0],
              myVote: body.choice,
            },
          ],
        };
      if (action === "claim")
        state = {
          ...state,
          attempt: {
            ...(state.attempt as object),
            status: "review",
            clipUrl:
              "http://127.0.0.1:54321/storage/v1/object/sign/consequence-clips/mine.webm?token=m",
          },
          // A card owed meanwhile waits behind the one in review.
          owed: 2,
          logBlocked: false,
        };
      if (action === "respond")
        state = {
          ...state,
          reviews: [
            {
              ...(state.reviews as object[])[0],
              myResponse: body.choice,
            },
          ],
        };
      return ok(state);
    }
    if (path === "/v1/home/extras")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: homeExtras() },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  const uploads: string[] = [];
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) => {
    const request = route.request();
    uploads.push(
      `${request.method()}:${new URL(request.url()).pathname}:${request.headers()["content-type"]}`,
    );
    return route.fulfill({ status: 200, json: { Key: clipPath } });
  });
  // Live capture stand-ins: a canvas stream for the camera and a recorder that yields one chunk.
  await page.addInitScript(() => {
    const log: Record<string, unknown> = {};
    (window as unknown as { capture: unknown }).capture = log;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async (constraints: unknown) => {
          log.constraints = constraints;
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 36;
          return canvas.captureStream();
        },
      },
    });
    class FakeRecorder {
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported(type: string) {
        return type.startsWith("video/webm");
      }
      constructor(_stream: unknown, options: unknown) {
        log.options = options;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["clip"], { type: "video/webm" }),
        });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder });
  });
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { buzzes: unknown[] }).buzzes = calls;
    Object.defineProperty(navigator, "vibrate", {
      value: (pattern: unknown) => {
        calls.push(pattern);
        return true;
      },
    });
  });
  // A controllable page clock drives the recorder's 30-second auto-stop.
  await page.clock.install();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/home");

  // The hand pops up on its own, like an augment round.
  let dialog = page.getByRole("dialog", { name: "Choose your punishment" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Penalty due · 1 owed · 48 hours to finish"),
  ).toBeVisible();
  const handButtons = dialog.locator(".augment-card");
  await expect(handButtons).toHaveCount(3);
  await expect(
    dialog.getByRole("button", { name: "Accept penalty" }),
  ).toBeDisabled();
  await page.waitForTimeout(700);
  expect(
    (
      await new AxeBuilder({ page }).include("[role=dialog]").analyze()
    ).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("card-offer.png") });

  // The deal buzzes the phone (dev StrictMode may deal twice).
  expect(
    await page.evaluate(
      () => (window as unknown as { buzzes: unknown[] }).buzzes,
    ),
  ).toContainEqual([60, 80, 60, 80, 140]);
  await dialog.getByRole("button", { name: "Decide later" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("You owe 1 Consequence card")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Friends this week" }).getByRole("listitem"),
  ).toHaveText([
    "Maya2/3 · owes 2🔥 1 wk1-week streak · 3 workouts since last missNudge",
  ]);
  await expect(
    page.getByRole("img", { name: "Consequence debt: 1 of 5 cards owed" }),
  ).toContainText("1/5");

  // An owed card racks the bar: Log opens the warning instead of the form.
  const logButton = page.getByRole("button", { name: /^Log workout/ });
  await expect(logButton).toHaveAccessibleName(
    "Log workout, locked until your Consequence card is done",
  );
  await logButton.click();
  let lock = page.getByRole("dialog", { name: "Bar’s racked" });
  await expect(lock).toContainText("Pick your card");
  await expect(page.getByRole("dialog", { name: "Log a workout" })).toHaveCount(
    0,
  );
  await page.waitForTimeout(400);
  expect(
    (
      await new AxeBuilder({ page }).include("[role=dialog]").analyze()
    ).violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("log-locked.png") });
  await lock.getByRole("button", { name: "Choose my card" }).click();
  await expect(lock).toHaveCount(0);
  await expect(page.locator("#consequence-cards")).toBeFocused();

  await page.reload();
  await expect(page.getByText("You owe 1 Consequence card")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Choose your card" }).click();
  dialog = page.getByRole("dialog", { name: "Choose your punishment" });

  await dialog.getByRole("button", { name: /Reroll all/ }).click();
  await expect(
    dialog.getByRole("button", { name: /No rerolls left/ }),
  ).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /5 km run/ })).toBeVisible();
  await dialog.getByRole("button", { name: /5 km run/ }).click();
  await expect(
    dialog.getByRole("button", { name: /5 km run/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(800);
  await page.screenshot({ path: testInfo.outputPath("card-chosen.png") });
  await dialog.getByRole("button", { name: "Accept penalty" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "5 km run" })).toBeVisible();
  await expect(page.getByText(/Due in 4[78] hours/)).toBeVisible();

  await logButton.click();
  lock = page.getByRole("dialog", { name: "Bar’s racked" });
  await expect(lock.getByText("5 km run")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("log-locked-card.png") });
  await lock.getByRole("button", { name: "Go to my card" }).click();
  await expect(lock).toHaveCount(0);

  await expect(page.getByText("Can’t do it safely")).toHaveCount(0);
  await page.getByRole("button", { name: "Request a pause" }).click();
  const pauseConfirm = page.getByRole("dialog", { name: "Request a pause?" });
  await expect(pauseConfirm).toContainText("Two friends must approve");
  await pauseConfirm.getByRole("button", { name: "Request pause" }).click();
  await expect(
    page.getByText(/Pause requested: 0 of 2 approvals/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request a pause" }),
  ).toHaveCount(0);

  // Proof is a live in-app clip: heads-up copy, no gallery picker.
  await expect(
    page.getByText(
      "Proof must be a video recorded in the app right now. Uploads from your camera roll aren’t accepted. Record a quick clip (up to 30s) showing the code, then doing the card.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "I did it" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // Hosted APIs can be slow: the sheet, placeholder, and pending state show at once.
  const undoApi = await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);
  const undoStorage = await delayRoute(
    page,
    "http://127.0.0.1:54321/storage/v1/**",
    1000,
  );
  const timings: Record<string, number> = {};
  const recorder = page.getByRole("dialog", { name: "Record proof" });
  timings.sheetOpen = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Record proof" }).click(),
    recorder.getByRole("button", { name: "Close" }),
  );
  await expect(recorder.getByText("Getting your code…")).toBeVisible();
  // No stale toast from earlier actions covers the recorder.
  await expect(page.locator(".event-notice")).toHaveCount(0);
  await expect(
    recorder.getByRole("button", { name: "Getting ready…" }),
  ).toBeDisabled();
  await expect(recorder.locator('input[type="file"]')).toHaveCount(0);
  await expect(recorder.getByText("042")).toBeVisible();
  await expect(recorder.getByText("Hold up 3 fingers")).toBeVisible();
  timings.recordingFeedback = await msUntilVisible(
    page,
    () => recorder.getByRole("button", { name: "Start recording" }).click(),
    recorder.getByText(/Recording 0:00 · 0:30 left/),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { capture: unknown }).capture,
    ),
  ).toEqual({
    constraints: {
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: true,
    },
    options: {
      mimeType: "video/webm;codecs=vp9,opus",
      videoBitsPerSecond: 1_500_000,
      audioBitsPerSecond: 64_000,
    },
  });
  await recorder.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    recorder.getByRole("button", { name: "Record again" }),
  ).toBeVisible();
  // A second take stops itself at 30 seconds.
  await recorder.getByRole("button", { name: "Record again" }).click();
  await recorder.getByRole("button", { name: "Start recording" }).click();
  await expect(recorder.getByText(/Recording 0:00/)).toBeVisible();
  await page.clock.fastForward(29_000);
  await expect(recorder.getByText(/Recording 0:29 · 0:01 left/)).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(recorder.getByText("Recorded 0:30")).toBeVisible();
  await expect(
    recorder.getByRole("button", { name: "Stop recording" }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("clip-recorded.png") });
  timings.sendPending = await msUntilVisible(
    page,
    () => recorder.getByRole("button", { name: "Send proof" }).click(),
    recorder.getByRole("button", { name: "Sending…" }),
  );
  await expect(
    recorder.getByRole("button", { name: "Sending…" }),
  ).toBeDisabled();
  await expect(recorder).toHaveCount(0, { timeout: 10_000 });
  await undoApi();
  await undoStorage();
  console.log(`[timing] ${JSON.stringify(timings)}`);
  testInfo.annotations.push({
    type: "timing",
    description: JSON.stringify(timings),
  });
  for (const [label, ms] of Object.entries(timings))
    expect(ms, label).toBeLessThanOrEqual(100);
  expect(uploads).toEqual([
    `PUT:/storage/v1/object/upload/sign/consequence-clips/${clipPath}:video/webm`,
  ]);
  await expect(
    page.getByText("Waiting for friends: 0 of 2 approvals."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "1 more card is queued. The next is dealt once this one is done.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Your proof clip")).toHaveAttribute(
    "preload",
    "none",
  );
  // Proof is in: logging unlocks without waiting for approvals.
  await expect(logButton).toHaveAccessibleName("Log workout");

  const pauseReview = page
    .getByRole("list", { name: "Pause requests to approve" })
    .getByRole("listitem");
  await expect(pauseReview).toContainText("Maya asked to pause");
  await expect(pauseReview).toContainText("200 jumping jacks");
  await pauseReview.getByRole("button", { name: "Approve pause" }).click();
  // Voted: a receipt replaces the buttons.
  await expect(pauseReview).toContainText("You approved Maya’s pause.");
  await expect(pauseReview.getByRole("button")).toHaveCount(0);

  const review = page
    .getByRole("list", { name: "Consequence cards to approve" })
    .getByRole("listitem");
  await expect(review).toContainText("Maya says they did their card");
  await expect(review).toContainText("100 push-ups");
  const friendClip = review.getByLabel("Maya’s proof clip");
  await expect(friendClip).toHaveAttribute("src", friendClipUrl);
  await expect(friendClip).toHaveAttribute("preload", "none");
  await expect(friendClip).toHaveAttribute("controls", "");
  expect(
    await friendClip.evaluate((video: HTMLVideoElement) => [
      video.autoplay,
      video.playsInline,
    ]),
  ).toEqual([false, true]);
  await review.getByRole("button", { name: "Approve" }).click();
  // Voted: the clip and buttons give way to a one-line receipt.
  await expect(review).toContainText("You approved Maya’s 100 push-ups.");
  await expect(review.getByRole("button")).toHaveCount(0);
  await expect(review.getByLabel("Maya’s proof clip")).toHaveCount(0);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("card-home.png"),
  });
  // Dev StrictMode mounts the recorder twice; only the newest challenge is used.
  expect([...new Set(actions)]).toEqual([
    `redraw:${offerId}:`,
    `select:${offerId}:${cards[2]?.cardId}`,
    `request_pause:${attemptId}:`,
    `challenge:${attemptId}`,
    `clip-upload:${challengeId}:video/webm`,
    `claim:${attemptId}:${clipPath}`,
    `vote_pause:${pauseRequestId}:approve`,
    `respond:${claimId}:approve`,
  ]);
  expect(errors).toEqual([]);
});
