import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { friendId, openHome, openWeek, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const friendClaim = {
  owed: 0,
  offer: null,
  attempt: null,
  reviews: [
    {
      claimId: "90000000-0000-4000-8000-000000000001",
      memberName: "Maya",
      title: "100 push-ups",
      instructions: "In sets of 25.",
      clipUrl: null,
      myResponse: null,
    },
  ],
  pauseReviews: [],
  logBlocked: false,
  groupOwed: { [friendId]: 1 },
};

const seriousAxe = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
    ["serious", "critical"].includes(item.impact ?? ""),
  );

test("Week tab holds the week's status; Home keeps the feed and Log", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(page, ({ path }) =>
    path === "/v1/consequences" ? friendClaim : undefined,
  );
  const nav = page.getByRole("navigation", { name: "Member destinations" });
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(5);
  for (const [index, name] of [
    /^Home/,
    "Week",
    "Group",
    "History",
    "Account",
  ].entries())
    await expect(links.nth(index)).toHaveAccessibleName(name);

  // Home: feed and Log stay; the week section is gone; the badge still counts.
  await expect(page.getByRole("button", { name: "Log workout" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Friends this week" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "The Group this week" }),
  ).toHaveCount(0);
  // Cards waiting on the member sit in Home's Needs you.
  await expect(
    page
      .getByRole("region", { name: "Needs you" })
      .getByRole("region", { name: "Consequence cards" }),
  ).toHaveCount(1);
  await expect(nav.getByRole("link", { name: /^Home/ })).toHaveAccessibleName(
    "Home 1 waiting on you",
  );

  // Week: the moved section, unchanged.
  await openWeek(page);
  const week = nav.getByRole("link", { name: "Week", exact: true });
  await expect(week).toHaveAttribute("aria-current", "page");
  await expect(nav.locator(".tab-indicator")).toHaveAttribute(
    "style",
    /translateX\(100%\)/,
  );
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "1 of 3 workouts. Change weekly target." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Week options" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Friends this week" }).getByRole("listitem"),
  ).toHaveText(["MAMaya2 of 3 workoutsOwes 1 cardNudge"]);
  // Every member's barbell for this week lives on Week alone.
  const bars = page.getByRole("region", { name: "The Group this week" });
  await expect(bars.getByRole("listitem")).toHaveCount(2);
  await expect(bars.getByRole("listitem").first()).toContainText("You1 of 3");
  await expect(bars.getByRole("listitem").nth(1)).toContainText("Maya2 of 3");
  await expect(
    page.getByRole("region", { name: "Consequence cards" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log workout" })).toHaveCount(
    0,
  );
  expect(await seriousAxe(page)).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("week.png"),
  });

  // The big barbell docks into the slim bar once it scrolls away.
  await page.setViewportSize({ width: 390, height: 420 });
  const dock = page.locator(".week-dock");
  await expect(dock).not.toHaveClass(/\bon\b/);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(dock).toHaveClass(/\bon\b/);
  await expect(dock).toContainText("1 of 3");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(dock).not.toHaveClass(/\bon\b/);
  await page.setViewportSize({ width: 390, height: 844 });

  // A deep link lands on Week, selected.
  await page.goto("/week");
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toBeVisible();
  await expect(week).toHaveAttribute("aria-current", "page");
  // Change target is a Week subpage.
  await page.getByRole("button", { name: "Week options" }).click();
  await page.getByRole("link", { name: "Change target" }).click();
  await expect(page).toHaveURL(/\/target$/);
  await expect(week).toHaveAttribute("aria-current", "true");
  await page.getByRole("link", { name: "Back to Week" }).click();
  await expect(page).toHaveURL(/\/week$/);
  await openHome(page);
  await expect(page.getByRole("button", { name: "Log workout" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Week shows the solo state until a second member joins", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(
    page,
    ({ path }) => (path.endsWith("/current-week-progress") ? [] : undefined),
    "/week",
  );
  await expect(
    page.getByRole("heading", { name: "Waiting for a second member" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Change target" })).toBeVisible();
  expect(await seriousAxe(page)).toEqual([]);
});

test("switching to Week under a slow API answers at once with a placeholder", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole("button", { name: "Log workout" })).toBeVisible();
  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);
  const nav = page.getByRole("navigation", { name: "Member destinations" });
  const week = nav.getByRole("link", { name: "Week", exact: true });
  const timings: Record<string, number> = {};
  const placeholder = page.getByRole("status", {
    name: "Loading weekly progress",
  });
  // First visit: the placeholder comes with the tap and holds the hero's space.
  timings.placeholder = await msUntilVisible(
    page,
    () => week.click(),
    placeholder,
  );
  const held = await placeholder.boundingBox();
  expect(held?.height ?? 0).toBeGreaterThanOrEqual(150);
  await expect(
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  ).toBeVisible();
  // The tab itself answers the tap at once.
  await openHome(page);
  timings.tabFeedback = await msUntilVisible(
    page,
    () => week.click(),
    nav.locator('a[href="/week"][aria-current="page"]'),
  );
  // The cached week shows at once while it refreshes.
  await openHome(page);
  timings.cachedWeek = await msUntilVisible(
    page,
    () => week.click(),
    page.getByRole("link", { name: /^1 of 3 workouts/ }),
  );
  await expect(placeholder).toHaveCount(0);
  console.log(`[timing] ${JSON.stringify(timings)}`);
  testInfo.annotations.push({
    type: "timing",
    description: JSON.stringify(timings),
  });
  for (const [label, ms] of Object.entries(timings))
    expect(ms, label).toBeLessThanOrEqual(100);
});
