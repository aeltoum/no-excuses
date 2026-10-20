import { expect, test } from "@playwright/test";
import { signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const proofPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a timed workout keeps photos on the phone, then logs the picked pair", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) =>
    route.fulfill({ status: 200, json: { Key: "proof-photos/x" } }),
  );
  let uploads = 0;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path.endsWith("/start"))
      return { id: path.split("/")[3], startedAt: new Date().toISOString() };
    if (path.endsWith("/end")) return { status: "ended" };
    if (path.endsWith("/link")) return { linked: true };
    if (path === "/v1/proof/uploads") {
      uploads++;
      return {
        path: `20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-00000000000${uploads}.jpg`,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/proof-photos/${uploads}?token=t`,
      };
    }
    if (path === "/v1/workout-check-ins")
      return { workoutCheckinId: body?.workoutCheckinId, currentWeekCount: 2 };
  });
  await delayRoute(page, "**/v1/sessions/**", 1000);
  const started = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Start timer" }).click(),
    page.getByRole("timer"),
  );
  expect(started).toBeLessThanOrEqual(100);
  const card = page.getByRole("region", { name: "Workout in progress" });
  for (const label of ["Gear photo", "Selfie", "Selfie"])
    await card
      .getByText(label, { exact: true })
      .locator("input")
      .setInputFiles({
        name: "shot.png",
        mimeType: "image/png",
        buffer: proofPng,
      });
  await expect(card.getByRole("img")).toHaveCount(3);
  // No photo leaves the phone during the session.
  expect(uploads).toBe(0);
  await card.getByRole("button", { name: "Finish" }).click();
  const dialog = page.getByRole("dialog", { name: "Log a workout" });
  await dialog.getByRole("button", { name: "Strength" }).click();
  await expect(dialog.getByLabel("Duration in minutes")).toHaveValue("1");
  await dialog
    .getByRole("group", { name: "Use a session photo as activity photo" })
    .getByRole("button", { name: "Session photo 1" })
    .click();
  await dialog
    .getByRole("group", { name: "Use a session photo as you at the workout" })
    .getByRole("button", { name: "Session photo 3" })
    .click();
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByText("2 of 3 this week")).toBeVisible();
  await expect
    .poll(() => calls.some((c) => c.path.endsWith("/link")))
    .toBe(true);
  expect(uploads).toBe(2);
  const sessionCalls = calls
    .filter((c) => c.path.startsWith("/v1/sessions/"))
    .map((c) => c.path.split("/").at(-1));
  expect(sessionCalls).toEqual(["start", "end", "link"]);
  expect(errors).toEqual([]);
});
