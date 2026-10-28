import { expect, test } from "@playwright/test";
import { signIn } from "./member";

const proofPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a workout logged offline survives a reload and sends once back online", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) =>
    route.fulfill({ status: 200, json: { Key: "proof-photos/x" } }),
  );
  let online = false;
  let uploads = 0;
  const keys: string[] = [];
  const { errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/proof/uploads") {
      if (!online) return 503;
      uploads++;
      return {
        path: `20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-00000000000${uploads}.jpg`,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/proof-photos/${uploads}?token=t`,
      };
    }
    if (path === "/v1/workout-check-ins") {
      keys.push(String(body?.workoutCheckinId));
      return { workoutCheckinId: body?.workoutCheckinId, currentWeekCount: 2 };
    }
  });
  await page.getByRole("button", { name: "Log workout" }).click();
  const dialog = page.getByRole("dialog", { name: "Log workout" });
  await dialog.getByRole("button", { name: "Cardio" }).click();
  await dialog.getByRole("button", { name: "30 min" }).click();
  const inputs = dialog.locator('input[type="file"]');
  for (const index of [0, 1])
    await inputs.nth(index).setInputFiles({
      name: "p.png",
      mimeType: "image/png",
      buffer: proofPng,
    });
  await expect(
    dialog.getByRole("img", { name: "Your presence preview" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByText("Couldn’t upload")).toBeVisible();

  // The phone dies; the app reopens later with a connection.
  online = true;
  await page.reload();
  await expect.poll(() => keys.length).toBe(1);
  await expect(page.getByText("Couldn’t upload")).toHaveCount(0);
  // A sent workout leaves the device queue: the next start sends nothing again.
  const loaded = page.waitForResponse("**/v1/home/extras");
  await page.reload();
  await loaded;
  expect(keys).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("a new deployment offers a reload", async ({ page }) => {
  await signIn(page);
  await page.route("http://127.0.0.1:4174/", (route) =>
    route.request().resourceType() === "fetch"
      ? route.fulfill({
          status: 200,
          contentType: "text/html",
          body: '<script type="module" src="/assets/index-NEW.js"></script>',
        })
      : route.fallback(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("A new version of No Excuses is ready."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});
