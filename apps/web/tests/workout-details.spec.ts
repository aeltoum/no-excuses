import { expect, test } from "@playwright/test";
import { signIn } from "./member";

const proofPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a cardio workout carries optional distance and time details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://127.0.0.1:54321/storage/v1/**", (route) =>
    route.fulfill({ status: 200, json: { Key: "proof-photos/x" } }),
  );
  let uploads = 0;
  let count = 1;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/proof/uploads") {
      uploads++;
      return {
        path: `20000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-00000000000${uploads}.jpg`,
        uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/proof-photos/${uploads}?token=t`,
      };
    }
    if (path === "/v1/workout-check-ins") {
      count++;
      return {
        workoutCheckinId: body?.workoutCheckinId,
        currentWeekCount: count,
      };
    }
    if (path.endsWith("/details"))
      return { workoutCheckinId: "x", details: body?.details };
  });
  await page.getByRole("button", { name: "Log workout" }).click();
  const dialog = page.getByRole("dialog", { name: "Log workout" });
  await dialog.getByRole("button", { name: "Cardio" }).click();
  await dialog.getByRole("button", { name: "30 min" }).click();
  await dialog.getByText("Add workout details").click();
  await dialog.getByLabel("Cardio type").selectOption("run");
  await dialog.getByLabel("Distance (km)").fill("5");
  await dialog.getByLabel("Time (mm:ss)").fill("25:30");
  const inputs = dialog.locator('input[type="file"]');
  for (const index of [0, 1])
    await inputs.nth(index).setInputFiles({
      name: `proof-${index}.png`,
      mimeType: "image/png",
      buffer: proofPng,
    });
  await expect(
    dialog.getByRole("img", { name: "Your presence preview" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByText("2 of 3 this week")).toBeVisible();
  await expect
    .poll(() => calls.find((c) => c.path.endsWith("/details"))?.body)
    .toEqual({
      details: {
        cardio: { activity: "run", distanceKm: 5, timeSeconds: 1530 },
      },
    });
  // Details post only after the check-in itself.
  const order = calls.map((c) => c.path);
  expect(order.indexOf("/v1/workout-check-ins")).toBeLessThan(
    order.findIndex((p) => p.endsWith("/details")),
  );
  expect(errors).toEqual([]);
});

test("feed posts show their details on one line", async ({ page }) => {
  await signIn(page, ({ path }) =>
    path === "/v1/proof/feed"
      ? [
          {
            workoutCheckinId: "70000000-0000-4000-8000-000000000001",
            authorMembershipId: "30000000-0000-4000-8000-000000000002",
            authorName: "Maya",
            mine: false,
            activityType: "mixed",
            durationMinutes: 60,
            perceivedIntensity: "high",
            completedAt: new Date().toISOString(),
            submittedAt: new Date().toISOString(),
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
            canDelete: false,
            activityPhotoUrl: null,
            presencePhotoUrl: null,
            reactions: [],
            myReactions: [],
            details: {
              lifts: [
                {
                  exercise: "back_squat",
                  equipment: "barbell",
                  sets: 3,
                  reps: 5,
                  weightKg: 100,
                },
              ],
              cardio: { activity: "row", distanceKm: 2, timeSeconds: 480 },
            },
          },
        ]
      : undefined,
  );
  await expect(
    page.getByText("Back squat 3×5 @ 100 kg · Row 2 km in 8:00"),
  ).toBeVisible();
});
