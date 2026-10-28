import { expect, test } from "@playwright/test";

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
test.use({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});

test("iPhone Safari members are told to install for notifications until they dismiss it", async ({
  page,
}) => {
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
  await page.route("http://127.0.0.1:8787/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { contractVersion: 1, data } });
    if (path.endsWith("/current"))
      return ok({ membership: { groupId, membershipId } });
    if (path.endsWith("/current-week-progress")) return ok([]);
    if (path.endsWith("/finalized-weekly-history")) return ok([]);
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
  const tip = page.getByRole("complementary", { name: "Install the app" });
  await expect(tip).toContainText("Add No Excuses to your Home Screen");
  await tip.getByRole("button", { name: "Dismiss install tip" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Home",
    }),
  ).toBeVisible();
  await expect(tip).toHaveCount(0);
});
