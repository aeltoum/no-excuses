import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { homeExtras, signIn } from "./member";
import { delayRoute } from "./timing";

const text =
  "Posts now count right away. You can still question one for 24 hours.";
const notice = (page: Page) =>
  page.getByRole("complementary", { name: "What changed" });

// The server's per-Account flag, shared by every "device" (page) in a test.
const server =
  (pending: { value: boolean }, failDismiss = false) =>
  ({ path, method }: { path: string; method: string }) => {
    if (path === "/v1/home/extras" && method === "GET")
      return homeExtras({ countNotice: pending.value });
    if (path === "/v1/notices/dismiss" && method === "POST") {
      if (failDismiss) return 500;
      pending.value = false;
      return { dismissed: true };
    }
    return undefined;
  };

// Milliseconds on the page clock from the trusted pointerdown to the frame after the notice left.
async function msUntilGone(page: Page, click: () => Promise<unknown>) {
  await page.evaluate(() => {
    const w = window as Window & { __gone?: Promise<number> };
    w.__gone = new Promise((resolve) => {
      let start = 0;
      addEventListener(
        "pointerdown",
        (event) => {
          start = event.timeStamp;
        },
        { capture: true, once: true },
      );
      const observer = new MutationObserver(() => {
        if (document.querySelector('[aria-label="What changed"]')) return;
        observer.disconnect();
        requestAnimationFrame(() => resolve(performance.now() - start));
      });
      observer.observe(document.body, { subtree: true, childList: true });
    });
  });
  await click();
  return page.evaluate(
    () => (window as Window & { __gone?: Promise<number> }).__gone,
  );
}

test("members at release see the notice once; dismissing is instant and sticks", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pending = { value: true };
  const { calls, errors } = await signIn(page, server(pending));
  await expect(notice(page)).toContainText(text);
  const findings = await new AxeBuilder({ page }).analyze();
  expect(
    findings.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);

  await delayRoute(page, "http://127.0.0.1:8787/v1/**", 1000);
  const ms = await msUntilGone(page, () =>
    notice(page).getByRole("button", { name: "Dismiss notice" }).click(),
  );
  console.log(`count notice dismiss feedback: ${ms.toFixed(1)}ms`);
  expect(ms).toBeLessThanOrEqual(100);
  await expect(notice(page)).toHaveCount(0);
  await expect
    .poll(() => calls.filter((c) => c.path === "/v1/notices/dismiss").length)
    .toBe(1);

  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Member destinations" }),
  ).toBeVisible();
  await expect
    .poll(() => calls.filter((c) => c.path === "/v1/home/extras").length)
    .toBeGreaterThan(1);
  await expect(notice(page)).toHaveCount(0);

  // Another device for the same Account reads the same server flag.
  const other = await browser.newPage();
  const second = await signIn(other, server(pending));
  await expect
    .poll(() => second.calls.filter((c) => c.path === "/v1/home/extras").length)
    .toBeGreaterThan(0);
  await expect(notice(other)).toHaveCount(0);
  await other.close();
  expect(errors).toEqual([]);
});

test("a failed dismissal brings the notice back with an error", async ({
  page,
}) => {
  const pending = { value: true };
  await signIn(page, server(pending, true));
  await notice(page).getByRole("button", { name: "Dismiss notice" }).click();
  await expect(notice(page)).toContainText("Couldn’t dismiss the notice.");
});

test("members who joined after release never see the notice", async ({
  page,
}) => {
  const { calls } = await signIn(page, server({ value: false }));
  await expect
    .poll(() => calls.filter((c) => c.path === "/v1/home/extras").length)
    .toBeGreaterThan(0);
  await expect(page.getByText(text)).toHaveCount(0);
});
