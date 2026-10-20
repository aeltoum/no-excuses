import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { homeExtras } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const membershipId = "30000000-0000-4000-8000-000000000001";
const groupId = "40000000-0000-4000-8000-000000000001";
const pendingId = "70000000-0000-4000-8000-000000000001";
const questionedId = "70000000-0000-4000-8000-000000000002";
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
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='3' height='4'><rect width='3' height='4' fill='%23555'/></svg>";
const friendMembershipId = "30000000-0000-4000-8000-000000000002";
const item = (overrides: Record<string, unknown>) => ({
  workoutCheckinId: pendingId,
  authorMembershipId: friendMembershipId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: "2026-10-12T15:00:00.000Z",
  submittedAt: "2026-10-12T15:05:00.000Z",
  reviewStatus: "pending",
  reviewClosesAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  decisionClosesAt: null,
  hidden: false,
  myVote: null,
  acceptVotes: 0,
  rejectVotes: 0,
  eligibleVoters: 0,
  canReview: true,
  canVote: false,
  activityPhotoUrl: photo,
  presencePhotoUrl: photo,
  reactions: [],
  myReactions: [],
  ...overrides,
});

test("Home reacts to friends' proof and nudges members behind target", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const calls: string[] = [];
  let failNextReaction = true;
  let failNextReactors = true;
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
          completedWorkoutCount: 3,
          activityTypes: [],
          targetStreak: 1,
          workoutStreak: 3,
        },
        {
          membershipId: friendMembershipId,
          displayName: "Maya",
          lockedTarget: 3,
          completedWorkoutCount: 1,
          activityTypes: ["strength"],
          targetStreak: 1,
          workoutStreak: 3,
        },
        {
          membershipId: "30000000-0000-4000-8000-000000000003",
          displayName: "Jordan",
          lockedTarget: 2,
          completedWorkoutCount: 2,
          activityTypes: ["cardio"],
          targetStreak: 1,
          workoutStreak: 3,
        },
      ]);
    // Home's background loads, which a longer session reaches.
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
    if (path.endsWith("/weekly-target"))
      return ok({
        membershipId,
        recurringTarget: 3,
        lockedTarget: 3,
        nextWeekStartsAt: null,
        memberCount: 3,
        timeZone: "UTC",
      });
    if (path === "/v1/proof/feed")
      return ok([
        item({
          reviewStatus: "verified",
          canReview: false,
          reactions: [{ emoji: "🔥", count: 2 }],
        }),
        item({
          workoutCheckinId: questionedId,
          authorMembershipId: membershipId,
          authorName: "Akrum",
          mine: true,
          reviewStatus: "verified",
          canReview: false,
          reactions: [{ emoji: "💪", count: 1 }],
        }),
      ]);
    if (path === "/v1/consequences")
      return ok({
        owed: 0,
        offer: null,
        attempt: null,
        reviews: [],
        groupOwed: {},
      });
    if (path === "/v1/nudges" && request.method() === "GET") return ok([]);
    if (path === "/v1/nudges") {
      calls.push(`nudge:${request.postDataJSON().membershipId}`);
      return ok({ membershipId: request.postDataJSON().membershipId });
    }
    if (path.endsWith("/reactions")) {
      if (failNextReactors) {
        failNextReactors = false;
        return route.fulfill({ status: 500, json: {} });
      }
      return ok(
        path.includes(pendingId)
          ? [
              { emoji: "🔥", name: "Jordan", mine: false },
              { emoji: "🔥", name: "Sam", mine: false },
            ]
          : [{ emoji: "💪", name: "Maya", mine: false }],
      );
    }
    if (path.endsWith("/react")) {
      if (failNextReaction) {
        failNextReaction = false;
        return route.fulfill({ status: 500, json: {} });
      }
      const { emoji, on } = request.postDataJSON();
      calls.push(`react:${emoji}:${on}`);
      return ok({ emoji, on });
    }
    if (path === "/v1/home/extras")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: homeExtras() },
      });
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

  // On a slow API the drawer and your own controls show at once; names follow below them.
  failNextReactors = false;
  failNextReaction = false;
  const slow = [
    await delayRoute(page, "**/v1/proof/*/reactions", 1500),
    await delayRoute(page, "**/v1/proof/*/react", 1500),
  ];
  const slowDrawer = page.getByRole("dialog", { name: "Reactions" });
  const slowFire = page
    .getByRole("group", { name: "Reactions" })
    .first()
    .getByRole("button", { name: "🔥, 2" });
  const slowReact = slowDrawer.getByRole("button", { name: "React with 🔥" });
  const slowRemove = slowDrawer.getByRole("button", { name: "Remove your 🔥" });
  const timings: Record<string, number> = {};
  timings.open = await msUntilVisible(page, () => slowFire.click(), slowReact);
  await expect(slowDrawer.getByRole("tab", { name: "🔥, 2" })).toBeVisible();
  await expect(slowDrawer.getByRole("status")).toHaveText("Loading names…");
  const reactBox = await slowReact.boundingBox();
  await expect(slowDrawer.locator(".reactor-name")).toHaveText([
    "Jordan",
    "Sam",
  ]);
  expect(await slowReact.boundingBox()).toEqual(reactBox);
  timings.react = await msUntilVisible(
    page,
    () => slowReact.click(),
    slowRemove,
  );
  timings.remove = await msUntilVisible(
    page,
    () => slowRemove.click(),
    slowReact,
  );
  await page.keyboard.press("Escape");
  await expect(slowDrawer).toHaveCount(0);
  // Reopening shows the cached names at once.
  timings.reopen = await msUntilVisible(
    page,
    () => slowFire.click(),
    slowDrawer.getByText("Jordan"),
  );
  await page.keyboard.press("Escape");
  await expect(slowDrawer).toHaveCount(0);
  for (const undo of slow) await undo();
  testInfo.annotations.push({
    type: "timings",
    description: JSON.stringify(timings),
  });
  console.log("Reactions timings (ms):", JSON.stringify(timings));
  for (const ms of Object.values(timings)) expect(ms).toBeLessThanOrEqual(100);
  await expect.poll(() => calls.length).toBe(2);
  calls.length = 0;
  failNextReactors = true;
  failNextReaction = true;

  // Chips open a drawer of who reacted; on your own proof it is view-only.
  const reactions = page.getByRole("group", { name: "Reactions" });
  await expect(reactions).toHaveCount(2);
  const own = reactions.nth(1);
  await expect(own.getByRole("button")).toHaveCount(1);
  const strong = own.getByRole("button", { name: "💪, 1" });
  const drawer = page.getByRole("dialog", { name: "Reactions" });
  const emojiTabs = drawer.getByRole("tablist", { name: "Emoji" });
  const expectClear = async (
    notice: ReturnType<typeof page.getByRole>,
    actions: ReturnType<typeof page.getByRole>[],
  ) => {
    const noticeBox = await notice.boundingBox();
    for (const target of [
      drawer.getByRole("heading", { name: "Reactions" }),
      drawer.getByRole("button", { name: "Close" }),
      emojiTabs,
      ...actions,
    ]) {
      const other = await target.boundingBox();
      expect(noticeBox && other).toBeTruthy();
      if (!noticeBox || !other) continue;
      expect(
        noticeBox.x < other.x + other.width &&
          other.x < noticeBox.x + noticeBox.width &&
          noticeBox.y < other.y + other.height &&
          other.y < noticeBox.y + noticeBox.height,
      ).toBe(false);
    }
  };
  const names = drawer.locator(".reactor-name");
  await strong.click();
  // The first load fails and offers a retry.
  await expect(drawer.getByRole("alert")).toContainText(
    "Couldn’t load reactions.",
  );
  await drawer.getByRole("button", { name: "Try again" }).click();
  await expect(names).toHaveText(["Maya"]);
  await expect(emojiTabs.getByRole("tab", { name: "💪, 1" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    drawer.getByRole("button", { name: /Remove|React with/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(strong).toBeFocused();

  // On friends' proof the drawer adds or removes your own emoji.
  const friend = reactions.first();
  const fire = friend.getByRole("button", { name: "🔥, 2" });
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  await fire.click();
  await expect(names).toHaveText(["Jordan", "Sam"]);
  const reactFire = drawer.getByRole("button", { name: "React with 🔥" });
  // A failed reaction rolls back; focus stays on the restored control.
  await reactFire.focus();
  await page.keyboard.press("Enter");
  const notice = page.getByRole("alert");
  await expect(notice).toHaveText("Something went wrong. Try again.");
  await expect(fire).toHaveAttribute("aria-pressed", "false");
  await expect(names).toHaveText(["Jordan", "Sam"]);
  await expect(reactFire).toBeFocused();
  // The notice leaves the drawer's title, Close and action clear.
  await expectClear(notice, [reactFire]);
  await page.screenshot({ path: testInfo.outputPath("reactions-notice.png") });
  await page.keyboard.press("Space");
  await expect(names).toHaveText(["You", "Jordan", "Sam"]);
  await expect(reactFire).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "Remove your 🔥" }),
  ).toBeFocused();
  await expect(emojiTabs.getByRole("tab", { name: "🔥, 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(friend.getByRole("button", { name: "🔥, 3" })).toBeFocused();
  await expect(friend.getByRole("button", { name: "🔥, 3" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The picker sheet adds a gym favorite alongside the existing reaction.
  const add = friend.getByRole("button", { name: "Add reaction" });
  await add.click();
  const sheet = page.getByRole("dialog", { name: "React" });
  await sheet.getByRole("button", { name: "React 🦍" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(friend.getByRole("button", { name: "🦍, 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(friend.getByRole("button", { name: "🔥, 3" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Tabs switch by arrow key; removing your only 🦍 empties its tab and drops the chip.
  const gorilla = friend.getByRole("button", { name: "🦍, 1" });
  await gorilla.click();
  const gorillaTab = emojiTabs.getByRole("tab", { name: "🦍, 1" });
  const fireTab = emojiTabs.getByRole("tab", { name: "🔥, 3" });
  await expect(gorillaTab).toHaveAttribute("aria-selected", "true");
  await expect(names).toHaveText(["You"]);
  await gorillaTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(fireTab).toHaveAttribute("aria-selected", "true");
  await expect(fireTab).toBeFocused();
  await expect(names).toHaveText(["You", "Jordan", "Sam"]);
  await page.screenshot({ path: testInfo.outputPath("reactions-drawer.png") });
  await page.keyboard.press("ArrowRight");
  await expect(gorillaTab).toHaveAttribute("aria-selected", "true");
  // In a short drawer a failed removal's notice still clears the header, tabs and action.
  const removeGorilla = drawer.getByRole("button", { name: "Remove your 🦍" });
  failNextReaction = true;
  await removeGorilla.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(removeGorilla).toBeFocused();
  await expectClear(page.getByRole("alert"), [removeGorilla]);
  await page.screenshot({
    path: testInfo.outputPath("reactions-notice-short.png"),
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectClear(page.getByRole("alert"), [removeGorilla]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Enter");
  await expect(gorillaTab).toHaveCount(0);
  await expect(emojiTabs.getByRole("tab", { name: "🦍, 0" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(gorilla).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "React with 🦍" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // Any emoji is a search and a tap away; Escape closes the sheet.
  await add.click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // The page behind an open sheet stays put.
  await add.click();
  await expect(sheet).toBeVisible();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await page.mouse.move(195, 40);
  await page.mouse.wheel(0, 600);
  await page.keyboard.press("PageDown");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
  // Category tabs are line icons with names; a horizontal swipe changes tab.
  const tabs = sheet.getByRole("tablist", { name: "Categories" });
  await expect(tabs.getByRole("tab")).toHaveCount(9);
  await expect(tabs).toHaveText("", { useInnerText: true });
  const smileys = tabs.getByRole("tab", { name: "Smileys and emoticons" });
  const people = tabs.getByRole("tab", { name: "People and body" });
  await expect(smileys).toHaveAttribute("aria-selected", "true");
  const box = (locator: typeof tabs) =>
    locator
      .boundingBox()
      .then((value) => value ?? { x: 0, y: 0, width: 0, height: 0 });
  const navBox = await box(tabs);
  const lastBox = await box(tabs.getByRole("tab").last());
  expect(lastBox.width).toBeGreaterThan(0);
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(
    navBox.x + navBox.width + 1,
  );
  const grid = await box(sheet.getByRole("tabpanel"));
  const swipe = async (from: number, to: number) => {
    const y = grid.y + grid.height / 2;
    await page.mouse.move(grid.x + from, y);
    await page.mouse.down();
    await page.mouse.move(grid.x + to, y + 8, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(250, 100);
  await expect(people).toHaveAttribute("aria-selected", "true");
  await swipe(100, 250);
  await expect(smileys).toHaveAttribute("aria-selected", "true");
  await swipe(100, 250);
  await expect(smileys).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("reactions-sheet.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  await add.click();
  await sheet.getByRole("combobox", { name: "Search" }).fill("kenya");
  await sheet.getByRole("option", { name: /Kenya/ }).click();
  await expect(sheet).toHaveCount(0);
  // Remove in the drawer takes your emoji back.
  await friend.getByRole("button", { name: "🔥, 3" }).click();
  await drawer.getByRole("button", { name: "Remove your 🔥" }).click();
  await expect(names).toHaveText(["Jordan", "Sam"]);
  await page.keyboard.press("Escape");
  await expect(friend.getByRole("button", { name: "🔥, 2" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(friend.getByRole("button", { name: "🇰🇪, 1" })).toBeVisible();
  // Removing your last emoji keeps the drawer open on an empty tab; a failure rolls back in place.
  const kenya = friend.getByRole("button", { name: "🇰🇪, 1" });
  await kenya.click();
  await expect(names).toHaveText(["You"]);
  failNextReaction = true;
  await drawer.getByRole("button", { name: "Remove your 🇰🇪" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Something went wrong. Try again.",
  );
  await expect(names).toHaveText(["You"]);
  await expect(kenya).toBeVisible();
  await drawer.getByRole("button", { name: "Remove your 🇰🇪" }).click();
  await expect(drawer).toContainText("No reactions yet.");
  await expect(emojiTabs.getByRole("tab", { name: "🇰🇪, 0" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    drawer.getByRole("button", { name: "React with 🇰🇪" }),
  ).toBeVisible();
  await expect(kenya).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("reactions-drawer-empty.png"),
  });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(add).toBeFocused();

  // Only members behind target can be nudged, once.
  const friends = page.getByRole("list", { name: "Friends this week" });
  await expect(
    friends.getByRole("button", { name: "Nudge Jordan" }),
  ).toHaveCount(0);
  await friends.getByRole("button", { name: "Nudge Maya" }).click();
  await expect(page.getByRole("status")).toHaveText("Nudge sent.");
  await expect(
    friends.getByRole("button", { name: "Nudged Maya today" }),
  ).toBeDisabled();
  expect(calls).toEqual([
    "react:🔥:true",
    "react:🦍:true",
    "react:🦍:false",
    "react:🇰🇪:true",
    "react:🔥:false",
    "react:🇰🇪:false",
    `nudge:${friendMembershipId}`,
  ]);
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((entry) =>
      ["serious", "critical"].includes(entry.impact ?? ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("reactions-nudges.png"),
  });
  expect(errors.filter((text) => !text.includes("status of 500"))).toEqual([]);
});

test("Signing out drops the cached reactor names", async ({ page }) => {
  let reactorsAnswer = true;
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({ membership: { groupId, membershipId } });
    if (path === "/v1/proof/feed")
      return ok([
        item({
          reviewStatus: "verified",
          canReview: false,
          reactions: [{ emoji: "🔥", count: 2 }],
        }),
      ]);
    if (path.endsWith("/reactions")) {
      // The next member's request never answers, so only a stale cache could fill the list.
      if (!reactorsAnswer) return;
      return ok([
        { emoji: "🔥", name: "Jordan", mine: false },
        { emoji: "🔥", name: "Sam", mine: false },
      ]);
    }
    if (path.endsWith("/current-week-progress"))
      return ok(
        [membershipId, friendMembershipId].map((id, index) => ({
          membershipId: id,
          displayName: ["Akrum", "Maya"][index],
          lockedTarget: 3,
          completedWorkoutCount: 1,
          activityTypes: [],
          targetStreak: 0,
          workoutStreak: 1,
        })),
      );
    if (path === "/v1/nudges") return ok([]);
    if (path === "/v1/home/extras")
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: homeExtras() },
      });
    return route.fulfill({ status: 404, json: {} });
  });
  const signIn = async (email: string) => {
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send code" }).click();
    for (const [index, digit] of [..."123456"].entries())
      await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  };
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await signIn("member@example.test");
  const fire = page
    .getByRole("group", { name: "Reactions" })
    .getByRole("button", { name: "🔥, 2" });
  const drawer = page.getByRole("dialog", { name: "Reactions" });
  await fire.click();
  await expect(drawer.locator(".reactor-name")).toHaveText(["Jordan", "Sam"]);
  await page.keyboard.press("Escape");
  // Sign out in place, without a reload that would reset memory anyway.
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  reactorsAnswer = false;
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.getByRole("button", { name: "Use another email" }).click();
  await signIn("other@example.test");
  await fire.click();
  await expect(drawer.getByRole("status")).toHaveText("Loading names…");
  await expect(drawer.locator(".reactor-name")).toHaveCount(0);
});
