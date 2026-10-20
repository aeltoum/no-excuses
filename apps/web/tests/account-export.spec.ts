import { expect, test } from "@playwright/test";
import { signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

test("Account downloads the member's data as JSON", async ({ page }) => {
  const { errors } = await signIn(
    page,
    ({ path }) =>
      path === "/v1/account/export"
        ? { account: { email: "member@example.test" }, memberships: [] }
        : undefined,
    "/account",
  );
  await delayRoute(page, "**/v1/account/export", 1000);
  const download = page.waitForEvent("download");
  const pending = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Download my data" }).click(),
    page.getByText("Preparing your data…"),
  );
  expect(pending).toBeLessThanOrEqual(100);
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^no-excuses-data-\d{4}-\d{2}-\d{2}\.json$/,
  );
  await expect(page.getByText("Your data downloaded.")).toBeVisible();
  expect(errors).toEqual([]);
});
