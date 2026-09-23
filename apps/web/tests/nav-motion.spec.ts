import { expect, type Page, test } from "@playwright/test";

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

async function signIn(page: Page) {
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({ status: 200, json: session });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/current"))
      return route.fulfill({
        status: 200,
        json: {
          contractVersion: 1,
          data: { membership: { groupId, membershipId } },
        },
      });
    if (path.endsWith("/current-week-progress"))
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: [] },
      });
    if (path.endsWith("/finalized-weekly-history"))
      return route.fulfill({
        status: 200,
        json: { contractVersion: 1, data: [] },
      });
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: {} },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/home");
}

const runtimeFindings = new WeakMap<
  object,
  { console: string[]; page: string[]; network: string[] }
>();

test.beforeEach(async ({ page }) => {
  const findings = {
    console: [] as string[],
    page: [] as string[],
    network: [] as string[],
  };
  runtimeFindings.set(page, findings);
  page.on("console", (message) => {
    if (message.type() === "error") findings.console.push(message.text());
  });
  page.on("pageerror", (error) => findings.page.push(error.message));
  page.on("requestfailed", (request) => findings.network.push(request.url()));
});

test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("nav-motion-verdict.png"),
  });
  expect(runtimeFindings.get(page)).toEqual({
    console: [],
    page: [],
    network: [],
  });
});

test("five icon tabs use one sliding indicator and fade only incoming content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page);

  const nav = page.getByRole("navigation", { name: "Member destinations" });
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(5);
  for (const [index, name] of [
    "Home",
    "Group",
    "Target",
    "History",
    "Account",
  ].entries())
    await expect(links.nth(index)).toHaveAccessibleName(name);
  await expect(nav.locator("svg")).toHaveCount(5);
  await expect(nav.locator(".tab-indicator")).toHaveCount(1);

  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }

  const home = page.getByRole("link", { name: "Home" });
  const group = page.getByRole("link", { name: "Group" });
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(group).not.toHaveAttribute("aria-current");
  expect(await home.evaluate((node) => getComputedStyle(node).color)).toBe(
    "rgb(242, 242, 238)",
  );
  expect(await group.evaluate((node) => getComputedStyle(node).color)).toBe(
    "rgb(140, 143, 147)",
  );

  const indicator = nav.locator(".tab-indicator");
  expect(
    await indicator.evaluate((node) => getComputedStyle(node).height),
  ).toBe("3px");
  expect(
    await indicator.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.transitionProperty} ${style.transitionDuration} ${style.transitionTimingFunction}`;
    }),
  ).toBe("transform 0.28s cubic-bezier(0.3, 0.7, 0.2, 1)");

  const mastheadBox = await page.locator(".masthead").boundingBox();
  const navBox = await nav.boundingBox();
  await group.click();
  await expect(group).toHaveAttribute("aria-current", "page");
  await expect(home).not.toHaveAttribute("aria-current");
  expect(
    await indicator.evaluate((node) => getComputedStyle(node).transform),
  ).not.toBe("none");
  expect(await page.locator(".masthead").boundingBox()).toEqual(mastheadBox);
  const movedNavBox = await nav.boundingBox();
  expect(movedNavBox?.x).toBe(navBox?.x);
  expect(movedNavBox?.width).toBe(navBox?.width);
  expect(movedNavBox?.height).toBe(navBox?.height);
  expect(Math.abs((movedNavBox?.y ?? 0) - (navBox?.y ?? 0))).toBeLessThan(0.1);

  const content = page.locator(".route-content > .hero");
  expect(
    await content.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.animationName} ${style.animationDuration}`;
    }),
  ).toBe("route-in 0.22s");
});

test("reduced motion switches content and indicator with no movement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.getByRole("link", { name: "History" }).click();

  await expect(page.getByRole("link", { name: "History" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    await page
      .locator(".route-content > .hero")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  expect(
    await page.locator(".tab-indicator").evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.animationName} ${style.transitionDuration}`;
    }),
  ).toBe("none 0s");
});
