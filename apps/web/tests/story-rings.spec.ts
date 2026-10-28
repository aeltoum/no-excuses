import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { type ApiCall, membershipId, progressItem, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const shots = process.env.RING_SHOTS;
const photo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='9' height='16'><rect width='9' height='16' fill='%23555'/></svg>";
const member = (n: number) => `30000000-0000-4000-8000-00000000001${n}`;
const people = {
  Rae: member(1),
  Sam: member(2),
  Ben: member(3),
  Ann: member(4),
};
type Name = keyof typeof people | "Akrum";
const sinceMidnight =
  (Date.now() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 60_000;
// Minutes ago, kept inside today however early the test runs.
const at = (share: number) =>
  new Date(Date.now() - sinceMidnight * share * 60_000).toISOString();
let serial = 0;
const post = (who: Name, share: number, seen = false) => {
  serial += 1;
  return {
    workoutCheckinId: `70000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    authorMembershipId: who === "Akrum" ? membershipId : people[who],
    authorName: who,
    mine: who === "Akrum",
    activityType: "strength",
    durationMinutes: 30 + serial,
    perceivedIntensity: "high",
    completedAt: at(share),
    submittedAt: at(share),
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
    seen,
  };
};

// Smaller share = more recent. Rae: newest unseen; Sam: older unseen; Ben: all seen.
const feed = () => {
  serial = 0;
  return [
    post("Sam", 0.7),
    post("Sam", 0.5, true),
    post("Rae", 0.6),
    post("Rae", 0.3),
    post("Rae", 0.2),
    post("Ben", 0.4, true),
    post("Ben", 0.1, true),
    post("Akrum", 0.05),
  ];
};
const progress = [
  progressItem(),
  ...Object.entries(people).map(([displayName, id]) =>
    progressItem({ membershipId: id, displayName }),
  ),
];

async function open(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  const calls: ApiCall[] = [];
  const signed = await signIn(page, (call) => {
    if (call.path.endsWith("/current-week-progress")) return progress;
    if (call.path === "/v1/proof/feed") return feed();
    if (call.path === "/v1/proof/seen" && call.method === "POST") {
      calls.push(call);
      return { marked: 1 };
    }
    return undefined;
  });
  await expect(rings(page).first()).toBeVisible();
  return { ...signed, calls };
}
const rings = (page: Page) =>
  page.getByRole("region", { name: "Stories" }).getByRole("button");
const ringLabels = (page: Page) =>
  rings(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label")),
  );
const ring = (page: Page, name: string) =>
  page
    .getByRole("region", { name: "Stories" })
    .getByRole("button", { name: new RegExp(`^${name},`) });
const viewer = (page: Page) => page.getByRole("dialog", { name: /story$/ });
const ticks = (page: Page) =>
  viewer(page)
    .locator(".story-ticks span")
    .evaluateAll((nodes) => nodes.map((node) => node.className || "-"));

test("rings light for unseen posts and order lit, then unlit, then you", async ({
  page,
}) => {
  const { errors } = await open(page);
  expect(await ringLabels(page)).toEqual([
    "Rae, new posts",
    "Sam, new posts",
    "Ben, all seen",
    "Ann, no posts",
    "You, all seen",
  ]);
  await expect(page.locator(".story-ring.is-new")).toHaveCount(2);
  // The row sits above the feed and scrolls on its own; the page does not.
  const row = page.getByRole("region", { name: "Stories" });
  const feedTop = await page
    .getByRole("list", { name: "Posts by day" })
    .evaluate((node) => node.getBoundingClientRect().top);
  expect(
    await row.evaluate((node) => node.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(feedTop);
  if (shots) await page.screenshot({ path: `${shots}/home-rings-390x844.png` });
  const axe = await new AxeBuilder({ page }).include(".proof-feed").analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [360, 390])
  test(`no sideways page scroll at ${width}px`, async ({ page }) => {
    await open(page, width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // The ring row scrolls sideways inside itself.
    const row = page.getByRole("region", { name: "Stories" });
    expect(
      await row.evaluate((node) => getComputedStyle(node).overflowX === "auto"),
    ).toBe(true);
  });

test("the viewer starts at the oldest unseen post, or the newest when all are seen", async ({
  page,
}) => {
  await open(page);
  // Sam: oldest post unseen, newer one seen.
  await ring(page, "Sam").click();
  await expect(viewer(page)).toHaveAccessibleName("Sam’s story");
  expect(await ticks(page)).toEqual(["is-on", "-"]);
  await expect(viewer(page).getByText("Strength · 31 min")).toBeVisible();
  await page.keyboard.press("Escape");
  // Ben: all seen, opens on the newest.
  await ring(page, "Ben").click();
  expect(await ticks(page)).toEqual(["is-done", "is-on"]);
  await expect(viewer(page).getByText("Strength · 37 min")).toBeVisible();
  await page.keyboard.press("Escape");
  // You: your own week from its start.
  await ring(page, "You").click();
  await expect(viewer(page)).toHaveAccessibleName("Your story");
  expect(await ticks(page)).toEqual(["is-on"]);
  await page.keyboard.press("Escape");
  // Ann: no posts, a short line that closes on tap.
  const ann = ring(page, "Ann");
  await ann.click();
  await viewer(page).getByText("Ann hasn’t posted this week or last.").click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(ann).toBeFocused();
});

test("taps and arrow keys move through posts, it closes after the last, focus returns and stays trapped", async ({
  page,
}) => {
  await open(page);
  const rae = ring(page, "Rae");
  await rae.click();
  const dialog = viewer(page);
  await expect(
    dialog.getByRole("button", { name: "Close story" }),
  ).toBeFocused();
  expect(await ticks(page)).toEqual(["is-on", "-", "-"]);
  const box = await dialog.locator(".story-frame").boundingBox();
  if (!box) throw new Error("no story frame");
  const right = { x: box.x + box.width * 0.8, y: box.y + box.height / 2 };
  const left = { x: box.x + box.width * 0.2, y: box.y + box.height / 2 };
  await page.mouse.click(right.x, right.y);
  expect(await ticks(page)).toEqual(["is-done", "is-on", "-"]);
  await page.mouse.click(left.x, left.y);
  expect(await ticks(page)).toEqual(["is-on", "-", "-"]);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await ticks(page)).toEqual(["is-done", "is-done", "is-on"]);
  await page.keyboard.press("ArrowLeft");
  expect(await ticks(page)).toEqual(["is-done", "is-on", "-"]);
  // Tab cycles inside the dialog.
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  // Page scroll is locked while it is open.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).toBe("hidden");
  await page.mouse.click(right.x, right.y);
  await page.mouse.click(right.x, right.y);
  await expect(dialog).toHaveCount(0);
  await expect(rae).toBeFocused();
  // The close button closes too.
  await rae.click();
  await viewer(page).getByRole("button", { name: "Close story" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(rae).toBeFocused();
});

test("posts shown 1s in the viewer count as seen and the ring and dots update", async ({
  page,
}) => {
  const { calls } = await open(page);
  const tile = page
    .getByRole("list", { name: "Posts by day" })
    .getByRole("button", { name: /^Sam, Strength · 31 min/ });
  // Sam's unseen tile sits off screen at the reel's end, so only the viewer can mark it.
  await ring(page, "Sam").click();
  await expect(viewer(page).locator("[data-unseen]")).toHaveCount(0, {
    timeout: 3_000,
  });
  await page.keyboard.press("Escape");
  await expect(ring(page, "Sam")).toHaveAccessibleName("Sam, all seen");
  await expect(tile).not.toHaveAccessibleName(/new/);
  await expect(tile.locator(".day-tile-new")).toHaveCount(0);
  await expect
    .poll(() => calls.flatMap((c) => c.body?.ids as string[]), {
      timeout: 8_000,
    })
    .toContain(feed()[0].workoutCheckinId);
});

test("rings keep their order while lights change, and re-sort on the next load", async ({
  page,
}) => {
  await open(page);
  const start = await ringLabels(page);
  expect(start.slice(0, 2)).toEqual(["Rae, new posts", "Sam, new posts"]);
  const names = (labels: (string | null)[]) =>
    labels.map((text) => text?.split(",")[0]);
  // Bring Sam's unseen tile on screen so the feed marks it.
  await page.getByRole("list", { name: "Today posts" }).evaluate((node) => {
    node.style.scrollBehavior = "auto";
    node.style.scrollSnapType = "none";
  });
  await page
    .getByRole("list", { name: "Posts by day" })
    .getByRole("button", { name: /^Sam, Strength · 31 min/ })
    .evaluate((node) => node.scrollIntoView({ inline: "center" }));
  await expect(ring(page, "Sam")).toHaveAccessibleName("Sam, all seen", {
    timeout: 4_000,
  });
  // Lit state is live; the order holds while the member is on Home.
  expect(names(await ringLabels(page))).toEqual(names(start));
  await page.reload();
  await expect(rings(page).first()).toBeVisible();
  const after = names(await ringLabels(page));
  // Sam is unlit now and sorts by his most recent post, after Ben's newer one.
  expect(after.indexOf("Sam")).toBeGreaterThan(after.indexOf("Ben"));
  expect(after.at(-1)).toBe("You");
});

test("reduced motion turns off the tick transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await ring(page, "Rae").click();
  const duration = await viewer(page)
    .locator(".story-ticks span")
    .first()
    .evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(duration).toBe("0s");
  const axe = await new AxeBuilder({ page }).include(".story-viewer").analyze();
  expect(axe.violations).toEqual([]);
  if (shots) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/story-viewer-390x844.png` });
  }
});

test("a ring opens the viewer within 100ms at 1000ms API latency", async ({
  page,
}) => {
  await open(page);
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1_000);
  const ms = await msUntilVisible(
    page,
    () => ring(page, "Rae").click(),
    viewer(page).locator(".story-frame"),
  );
  console.log(`ring tap to story viewer: ${ms.toFixed(1)}ms`);
  expect(ms).toBeLessThanOrEqual(100);
});
