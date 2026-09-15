import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const runtimeFindings = new WeakMap<
  object,
  { consoleErrors: string[]; failedRequests: string[]; pageErrors: string[] }
>();

test.beforeEach(async ({ page }) => {
  const findings = {
    consoleErrors: [] as string[],
    failedRequests: [] as string[],
    pageErrors: [] as string[],
  };
  runtimeFindings.set(page, findings);
  page.on("console", (message) => {
    if (message.type() === "error") findings.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => findings.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().startsWith("http://127.0.0.1:4174/")) {
      findings.failedRequests.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText}`,
      );
    }
  });
});

test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("verdict.png"),
  });
  expect(runtimeFindings.get(page)).toEqual({
    consoleErrors: [],
    failedRequests: [],
    pageErrors: [],
  });
});

for (const route of [
  "/",
  "/sign-in",
  "/group",
  "/home",
  "/target",
  "/history",
  "/account",
]) {
  test(`direct load survives refresh: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("unsupported route recovers without prior-route content", async ({
  page,
}) => {
  await page.goto("/group");
  await expect(
    page.getByRole("heading", { name: "Sign in required" }),
  ).toBeVisible();
  await page.goto("/not-a-route");
  await expect(
    page.getByRole("heading", { name: "Nothing shared here." }),
  ).toBeVisible();
  await expect(page.getByText("Use your invited email")).toHaveCount(0);
  await page.getByRole("link", { name: "Return to start" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/");
});

test("shell is keyboard reachable and has no serious axe findings", async ({
  browserName,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const wordmark = page.getByRole("link", { name: "No Excuses" });
  if (browserName === "chromium") await page.keyboard.press("Tab");
  else await wordmark.focus();
  await expect(wordmark).toBeFocused();
  const findings = await new AxeBuilder({ page }).analyze();
  expect(
    findings.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});

for (const fixture of [
  {
    name: "portrait",
    width: 320,
    height: 568,
    reducedMotion: "no-preference" as const,
  },
  {
    name: "landscape",
    width: 568,
    height: 320,
    reducedMotion: "no-preference" as const,
  },
  {
    name: "reduced motion",
    width: 320,
    height: 568,
    reducedMotion: "reduce" as const,
  },
]) {
  test(`${fixture.name} has no horizontal overflow or clipped actions`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: fixture.width,
      height: fixture.height,
    });
    await page.emulateMedia({ reducedMotion: fixture.reducedMotion });
    await page.goto("/");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(fixture.width);
    const action = page.getByRole("link", { name: "Continue to sign in" });
    await expect(action).toBeVisible();
    expect((await action.boundingBox())?.width).toBeGreaterThan(0);
  });
}

test("200% text keeps routes and action in page width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("manifest exposes install metadata and icons", async ({ request }) => {
  const response = await request.get(
    "http://127.0.0.1:4174/manifest.webmanifest",
  );
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "No Excuses",
    start_url: "/",
    display: "standalone",
  });
  for (const icon of manifest.icons)
    expect((await request.get(`http://127.0.0.1:4174${icon.src}`)).ok()).toBe(
      true,
    );
});

test("document favicon resolves from an explicit PWA icon", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("/icons/icon.svg");
  expect((await request.get(`http://127.0.0.1:4174${href}`)).ok()).toBe(true);
});
