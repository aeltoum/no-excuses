import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { type ApiCall, friendId, signIn } from "./member";
import { delayRoute } from "./timing";

const shots = process.env.SEEN_SHOTS;
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'><rect width='9' height='16' fill='%23555'/></svg>";
const sinceMidnight =
  (Date.now() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) /
  3_600_000;
// Hours ago, kept inside today however early the test runs.
const today = (share: number) =>
  new Date(Date.now() - sinceMidnight * share * 3_600_000).toISOString();
const id = (n: number) => `70000000-0000-4000-8000-0000000000${10 + n}`;
const post = (
  n: number,
  name: string,
  share: number,
  extra: Record<string, unknown> = {},
) => ({
  workoutCheckinId: id(n),
  authorMembershipId: friendId,
  authorName: name,
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: today(share),
  submittedAt: today(share),
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
  reactions: [],
  myReactions: [],
  seen: false,
  ...extra,
});

const tiles = (page: Page) =>
  page.getByRole("list", { name: "Today posts" }).getByRole("button");
const dot = (page: Page, name: string) =>
  page
    .getByRole("button", { name: new RegExp(`^${name},`) })
    .locator(".day-tile-new");

async function open(
  page: Page,
  feed: unknown[],
  seen: (call: ApiCall) => unknown = () => ({ marked: 1 }),
) {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: ApiCall[] = [];
  const signed = await signIn(page, (call) => {
    if (call.path === "/v1/proof/feed") return feed;
    if (call.path === "/v1/proof/seen" && call.method === "POST") {
      calls.push(call);
      return seen(call);
    }
    return undefined;
  });
  await expect(tiles(page).first()).toBeVisible();
  return { ...signed, calls };
}

test("an unseen tile shows a dot until it has been on screen for 1s", async ({
  page,
}) => {
  const feed = [
    post(1, "Maya", 0.2, { seen: true }),
    post(2, "Jordan", 0.4),
    post(3, "Sam", 0.6),
    post(4, "Own", 0.1, { mine: true }),
    post(5, "Riley", 0.8),
    post(6, "Dana", 0.9),
  ];
  const { calls, errors } = await open(page, feed);
  // Unseen first, then newest first; own and seen posts follow.
  expect(
    await tiles(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  ).toEqual([
    "Jordan, Strength · 45 min, new. Open post",
    "Sam, Strength · 45 min, new. Open post",
    "Riley, Strength · 45 min, new. Open post",
    "Dana, Strength · 45 min, new. Open post",
    "You, Strength · 45 min. Open post",
    "Maya, Strength · 45 min. Open post",
  ]);
  await expect(dot(page, "Jordan")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/seen-dots-390x844.png` });
  const axe = await new AxeBuilder({ page }).include(".proof-feed").analyze();
  expect(axe.violations).toEqual([]);

  // On screen with its photo loaded for 1s: the dot clears and the mark is sent.
  await expect(dot(page, "Jordan")).toHaveCount(0, { timeout: 3_000 });
  await expect(dot(page, "Sam")).toHaveCount(0);
  // Off to the side of the reel: still new.
  await expect(dot(page, "Dana")).toBeVisible();
  await expect
    .poll(() => calls.flatMap((c) => c.body?.ids as string[]))
    .toEqual(expect.arrayContaining([id(2), id(3)]));
  const sent = calls.flatMap((c) => c.body?.ids as string[]);
  expect(sent).not.toContain(id(1));
  expect(sent).not.toContain(id(4));
  expect(sent).not.toContain(id(6));
  expect(errors).toEqual([]);
});

test("a quick scroll past does not mark a tile", async ({ page }) => {
  const feed = [1, 2, 3, 4, 5, 6].map((n) => post(n, `M${n}`, n / 10));
  await open(page, feed);
  const reel = page.getByRole("list", { name: "Today posts" });
  await reel.evaluate((node) => {
    node.style.scrollBehavior = "auto";
    node.style.scrollSnapType = "none";
  });
  // M6 is off screen; sweep across it and back within a few hundred ms.
  await reel.evaluate(async (node) => {
    node.scrollLeft = node.scrollWidth;
    await new Promise((resolve) => setTimeout(resolve, 300));
    node.scrollLeft = 0;
  });
  await page.waitForTimeout(1_500);
  await expect(dot(page, "M6")).toBeVisible();
  await expect(dot(page, "M1")).toHaveCount(0);
});

test("a failed or offline flush keeps the mark and retries later", async ({
  page,
  context,
}) => {
  let fail = 2;
  const { calls } = await open(page, [post(1, "Maya", 0.5)], () =>
    fail-- > 0 ? 500 : { marked: 1 },
  );
  await expect(dot(page, "Maya")).toHaveCount(0, { timeout: 3_000 });
  await expect.poll(() => calls.length, { timeout: 10_000 }).toBeGreaterThan(0);
  // Offline flushes fail; the dot never comes back.
  await context.setOffline(true);
  await page.waitForTimeout(3_500);
  await expect(dot(page, "Maya")).toHaveCount(0);
  await context.setOffline(false);
  await expect
    .poll(() => calls.length, { timeout: 12_000 })
    .toBeGreaterThanOrEqual(3);
  expect(
    calls.every((c) => (c.body?.ids as string[] | undefined)?.[0] === id(1)),
  ).toBe(true);
  const settled = calls.length;
  await page.waitForTimeout(3_500);
  expect(calls.length).toBe(settled);
});

test("a mark still queued after a reload stays seen and flushes on pagehide", async ({
  page,
}) => {
  const answered: string[][] = [];
  const { calls } = await open(page, [post(1, "Maya", 0.5)], () => 500);
  await expect(dot(page, "Maya")).toHaveCount(0, { timeout: 3_000 });
  // The server never stored it: the reloaded feed says unseen, the queue says seen.
  await page.reload();
  await expect(tiles(page).first()).toBeVisible();
  await expect(dot(page, "Maya")).toHaveCount(0);
  await page.unroute("http://127.0.0.1:8787/v1/proof/seen");
  await page.route("http://127.0.0.1:8787/v1/proof/seen", (route) => {
    answered.push(route.request().postDataJSON().ids);
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: { marked: 1 } },
    });
  });
  const before = calls.length;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect.poll(() => answered.length, { timeout: 500 }).toBe(1);
  expect(answered[0]).toEqual([id(1)]);
  expect(calls.length).toBe(before);
});

test("the dot clears at once while the mark takes 1000ms to send", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Page clock, checked every frame: when the tile is half on screen with its photo
    // loaded, and when its dot goes.
    const stamps: { ready?: number; cleared?: number } = {};
    (window as unknown as { __seen: typeof stamps }).__seen = stamps;
    const tick = () => {
      const tile = document.querySelector<HTMLElement>(".day-tile-open");
      const image = tile?.querySelector("img");
      if (tile && image?.complete && image.naturalWidth > 0) {
        const box = tile.getBoundingClientRect();
        const shown =
          Math.min(box.bottom, innerHeight) - Math.max(box.top, 0) >=
            box.height / 2 &&
          Math.min(box.right, innerWidth) - Math.max(box.left, 0) >=
            box.width / 2;
        if (shown) stamps.ready ??= performance.now();
        if (stamps.ready && !tile.querySelector(".day-tile-new"))
          stamps.cleared ??= performance.now();
      }
      if (!stamps.cleared) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await delayRoute(page, "http://127.0.0.1:8787/v1/proof/seen", 1_000);
  await open(page, [post(1, "Maya", 0.5)]);
  await expect(dot(page, "Maya")).toHaveCount(0, { timeout: 3_000 });
  const { ready, cleared } = await page.evaluate(
    () =>
      (window as unknown as { __seen: { ready: number; cleared: number } })
        .__seen,
  );
  const late = cleared - ready - 1_000;
  console.log(`seen dot cleared ${Math.round(late)}ms after the 1s dwell`);
  expect(late).toBeLessThanOrEqual(100);
});

test("only the post open full screen counts while the viewer covers the tiles", async ({
  page,
}) => {
  const feed = [1, 2, 3, 4, 5, 6].map((n) => post(n, `M${n}`, n / 10));
  const { calls } = await open(page, feed);
  const sent = () => calls.flatMap((c) => c.body?.ids as string[]);
  // Open M6, off screen in the reel, before the visible tiles reach 1s.
  const m6 = page.getByRole("button", { name: /^M6,/ });
  await m6.evaluate((node: HTMLElement) => node.click());
  await expect(page.getByRole("dialog", { name: "M6’s post" })).toBeVisible();
  // Its tile is not on screen behind the viewer: only the viewer post can count.
  expect(
    await m6.evaluate(
      (node) => node.getBoundingClientRect().left >= innerWidth,
    ),
  ).toBe(true);
  await page.waitForTimeout(5_000);
  expect(sent()).toEqual([id(6)]);
  // Closed: the tiles it covered start their own 1s again.
  await page.getByRole("button", { name: "Close post" }).click();
  await expect(dot(page, "M1")).toBeVisible();
  await expect(dot(page, "M6")).toHaveCount(0);
  // Focus returned to M6 scrolled the reel; bring M1 back on screen.
  await page
    .getByRole("list", { name: "Today posts" })
    .evaluate((node) => node.scrollTo({ left: 0, behavior: "instant" }));
  await expect(dot(page, "M1")).toHaveCount(0, { timeout: 3_000 });
  await expect.poll(sent, { timeout: 8_000 }).toContain(id(1));
});

test("a hidden page marks nothing until it is shown again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { value: "hidden" };
    (window as unknown as { __visibility: typeof state }).__visibility = state;
    Object.defineProperty(document, "visibilityState", {
      get: () => state.value,
    });
    Object.defineProperty(document, "hidden", {
      get: () => state.value === "hidden",
    });
  });
  const { calls } = await open(page, [post(1, "Maya", 0.5)]);
  await page.waitForTimeout(4_000);
  await expect(dot(page, "Maya")).toBeVisible();
  expect(calls).toEqual([]);
  await page.evaluate(() => {
    (
      window as unknown as { __visibility: { value: string } }
    ).__visibility.value = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dot(page, "Maya")).toHaveCount(0, { timeout: 3_000 });
  await expect.poll(() => calls.length, { timeout: 8_000 }).toBe(1);
});

test("a sheet over Home marks nothing behind it", async ({ page }) => {
  const feed = [1, 2, 3].map((n) => post(n, `M${n}`, n / 10));
  const { calls } = await open(page, feed);
  await page.getByRole("button", { name: /^Log workout/ }).click();
  await expect(page.locator(".sheet-layer")).toBeVisible();
  await page.waitForTimeout(4_000);
  expect(calls).toEqual([]);
  await expect(dot(page, "M1")).toHaveCount(1);
});

test("a sheet over the viewer pauses its post until it closes", async ({
  page,
}) => {
  const feed = [1, 2, 3, 4, 5, 6].map((n) => post(n, `M${n}`, n / 10));
  const { calls } = await open(page, feed);
  const sent = () => calls.flatMap((c) => c.body?.ids as string[]);
  await page
    .getByRole("button", { name: /^M6,/ })
    .evaluate((node: HTMLElement) => node.click());
  const viewer = page.getByRole("dialog", { name: "M6’s post" });
  await viewer.getByRole("button", { name: "Add reaction" }).click();
  await expect(page.locator(".sheet-layer")).toBeVisible();
  await page.waitForTimeout(4_000);
  expect(sent()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet-layer")).toHaveCount(0);
  await expect(viewer).toBeVisible();
  await expect.poll(sent, { timeout: 8_000 }).toEqual([id(6)]);
});
