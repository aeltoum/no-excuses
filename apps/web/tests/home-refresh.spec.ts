import { expect, test } from "@playwright/test";
import { friendId, homeExtras, membershipId, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const proofPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const post = {
  workoutCheckinId: "70000000-0000-4000-8000-000000000001",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "mixed",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date(Date.now() - 3_600_000).toISOString(),
  submittedAt: new Date(Date.now() - 3_600_000).toISOString(),
  reviewStatus: "verified",
  reviewClosesAt: null,
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 0,
  canReview: false,
  canVote: false,
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  caption: "Leg day",
  messages: [],
  reactions: [],
  myReactions: [],
};

test("Home shows the week countdown, friends' photos, and posts with a comment button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const endsAt = new Date(Date.now() + (2 * 24 + 3) * 3_600_000 + 60_000);
  const { errors } = await signIn(page, ({ path }) => {
    if (path.endsWith("/weekly-target"))
      return {
        membershipId,
        recurringTarget: 3,
        lockedTarget: 3,
        nextWeekStartsAt: endsAt.toISOString(),
        memberCount: 2,
        timeZone: "UTC",
      };
    if (path === "/v1/home/extras")
      return homeExtras({
        safety: { conductAccepted: true, blocked: [] },
        avatars: { [friendId]: photo },
      });
    if (path === "/v1/proof/feed") return [post];
    if (path.endsWith("/message")) return { id: "x" };
  });
  await expect(page.getByText("Week ends in 2d 3h")).toBeVisible();
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(friends.locator(".avatar img")).toHaveAttribute("src", photo);

  const card = page.locator(".proof-post").filter({ hasText: "Leg day" });
  await expect(card.locator(".post-caption")).toHaveText("Maya Leg day");
  // A mixed workout's caption once took the chalk plate colour behind chalk text.
  await expect(card.locator(".post-caption")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(card.getByRole("button", { name: "Message" })).toHaveCount(0);
  await expect(card.locator(".avatar img")).toHaveAttribute("src", photo);
  await delayRoute(page, "**/v1/proof/*/message", 1000);
  const opened = await msUntilVisible(
    page,
    () => card.getByRole("button", { name: "Comment" }).click(),
    card.getByRole("textbox", { name: "Comment" }),
  );
  expect(opened).toBeLessThanOrEqual(100);
  await card.getByRole("textbox", { name: "Comment" }).fill("Strong");
  const sent = await msUntilVisible(
    page,
    () => card.getByRole("button", { name: "Post" }).click(),
    card.getByText("Strong"),
  );
  expect(sent).toBeLessThanOrEqual(100);
  expect(errors).toEqual([]);
});

test("Log opens the camera with the sheet; several activities log as mixed with a slider effort", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) =>
    route.fulfill({ status: 200, json: { Key: "proof-photos/x" } }),
  );
  let uploads = 0;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/proof/uploads") {
      uploads++;
      return {
        path: `20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-00000000000${uploads}.jpg`,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/proof-photos/${uploads}?token=t`,
      };
    }
    if (path === "/v1/workout-check-ins")
      return { workoutCheckinId: body?.workoutCheckinId, currentWeekCount: 2 };
  });
  const camera = page.waitForEvent("filechooser");
  const shown = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Log workout" }).click(),
    page.getByRole("dialog", { name: "Log workout" }),
  );
  expect(shown).toBeLessThanOrEqual(100);
  await (await camera).setFiles({
    name: "activity.png",
    mimeType: "image/png",
    buffer: proofPng,
  });
  const dialog = page.getByRole("dialog", { name: "Log workout" });
  await expect(
    dialog.getByRole("img", { name: "Activity preview" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mixed" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Strength" }).click();
  await dialog.getByRole("button", { name: "Cardio" }).click();
  await expect(
    dialog.getByRole("button", { name: "Strength" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "45 min" }).click();
  const effort = dialog.getByRole("slider", { name: /How hard/ });
  await effort.fill("2");
  await expect(dialog.getByText("Brutal")).toBeVisible();
  await dialog.locator('input[type="file"]').nth(1).setInputFiles({
    name: "presence.png",
    mimeType: "image/png",
    buffer: proofPng,
  });
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect
    .poll(() => calls.find((c) => c.path === "/v1/workout-check-ins")?.body)
    .toMatchObject({ activityType: "mixed", perceivedIntensity: "high" });
  expect(errors).toEqual([]);
});

test("sheets drag down to close; notification settings use switches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(
    page,
    ({ path }) =>
      path === "/v1/notifications"
        ? {
            items: [],
            prefs: { socialPush: true, digest: false, digestHour: 19 },
          }
        : path === "/v1/notifications/prefs"
          ? { socialPush: false, digest: false, digestHour: 19 }
          : undefined,
    "/account",
  );
  await page.getByRole("button", { name: "Notification settings" }).click();
  const sheet = page.getByRole("dialog", { name: "Notification settings" });
  const push = sheet.getByRole("switch", { name: /Push reactions/ });
  await expect(push).toBeChecked();
  await push.click();
  await expect(push).not.toBeChecked();

  const header = sheet.locator(".sheet-drag");
  const box = await header.boundingBox();
  expect(box).toBeTruthy();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + 260, { steps: 4 });
    await page.mouse.up();
  }
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a nudge from yesterday clears at the day change, even if the refresh fails", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-27T23:58:00Z") });
  await page.setViewportSize({ width: 390, height: 844 });
  let failNudges = false;
  const { errors } = await signIn(page, ({ path, method }) => {
    if (path === "/v1/nudges" && method === "GET") return failNudges ? 503 : [];
    if (path === "/v1/nudges") return { membershipId: friendId };
  });
  const friends = page.getByRole("list", { name: "Friends this week" });
  await friends.getByRole("button", { name: "Nudge Maya" }).click();
  await expect(
    friends.getByRole("button", { name: "Nudged Maya today" }),
  ).toBeDisabled();
  failNudges = true;
  await page.clock.fastForward("03:00");
  await expect(
    friends.getByRole("button", { name: "Nudge Maya" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
