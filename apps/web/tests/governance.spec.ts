import { expect, test } from "@playwright/test";
import { friendId, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const settings = {
  name: "6AM Crew",
  timeZone: "UTC",
  weekStarts: 1,
  pendingTimeZone: null,
  pendingWeekStarts: null,
  admin: true,
  changesAt: "2026-10-26T00:00:00.000Z",
};

test("admins rename the crew, manage admins and the schedule; everyone sees activity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failAdmin = true;
  const { calls, errors } = await signIn(
    page,
    ({ path, body }) => {
      if (path === "/v1/group/settings")
        return body
          ? {
              ...settings,
              pendingTimeZone: body.timeZone,
              pendingWeekStarts: body.weekStarts,
            }
          : settings;
      if (path === "/v1/group/rename") return { ...settings, name: body?.name };
      if (path === "/v1/group/admin") {
        if (failAdmin) {
          failAdmin = false;
          return 500;
        }
        return { membershipId: friendId, admin: body?.admin };
      }
      if (path === "/v1/group/activity")
        return [
          {
            kind: "joined",
            at: "2026-10-12T10:00:00.000Z",
            name: "Maya",
            actor: null,
            detail: null,
          },
        ];
    },
    "/group",
  );
  await expect(page.getByRole("heading", { name: "6AM Crew" })).toBeVisible();
  await delayRoute(page, "http://127.0.0.1:8787/v1/group/**", 1000);
  await page.getByRole("button", { name: "Manage", exact: true }).click();

  // Rename shows at once on a slow API.
  await page.getByLabel("Group name").fill("Dawn Patrol");
  const renamed = await msUntilVisible(
    page,
    () => page.getByRole("button", { name: "Rename" }).click(),
    page.getByRole("heading", { name: "Dawn Patrol" }),
  );
  expect(renamed).toBeLessThanOrEqual(100);
  await expect
    .poll(() => calls.some((c) => c.path === "/v1/group/rename"))
    .toBe(true);

  // A failed promotion rolls back only that change; the retry sticks.
  const maya = page.getByRole("listitem").filter({ hasText: "Maya" });
  // Member actions live in a labelled member sheet.
  await maya.getByRole("button", { name: "Manage Maya" }).click();
  const sheet = page.getByRole("dialog", { name: "Maya" });
  await sheet.getByRole("button", { name: "Make admin" }).click();
  await expect(maya).toContainText("Admin");
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Make admin" })).toBeVisible();
  await sheet.getByRole("button", { name: "Make admin" }).click();
  await expect(
    sheet.getByRole("button", { name: "Remove admin" }),
  ).toBeVisible();
  // Admins cannot be removed until demoted.
  await expect(
    sheet.getByRole("button", { name: "Remove from group" }),
  ).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByLabel("Start day").selectOption("3");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText(/From Oct 2\d: Wednesday · UTC/)).toBeVisible();

  await page.getByText("Group activity").click();
  await expect(page.getByText("Maya joined")).toBeVisible();
  expect(errors).toEqual([]);
});
