import { expect, test } from "@playwright/test";

// An invite link opens sign-in with the invitation attached and drops the token from the address bar.
test("an invite link attaches the invitation to sign-in", async ({ page }) => {
  let enrolled: Record<string, unknown> | null = null;
  await page.route("http://127.0.0.1:8787/v1/enrollment", (route) => {
    enrolled = route.request().postDataJSON();
    return route.fulfill({
      json: {
        contractVersion: 1,
        data: { message: "If invitation is eligible, request a sign-in code." },
      },
    });
  });
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) =>
    route.fulfill({ status: 200, json: {} }),
  );
  await page.goto("/join/pX3vQ9aT_mK2wLr8ZbN5uYc1eHd7JfG0");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Invitation attached.")).toBeVisible();
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
  await page.getByLabel("Email address").fill("maya@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code digit 1")).toBeVisible();
  expect(enrolled).toEqual({
    email: "maya@example.test",
    token: "pX3vQ9aT_mK2wLr8ZbN5uYc1eHd7JfG0",
  });
});
