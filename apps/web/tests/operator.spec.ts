import { expect, test } from "@playwright/test";
import { homeExtras, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const state = {
  cases: [
    {
      id: "90000000-0000-4000-8000-000000000001",
      kind: "message_report",
      category: "harassment",
      createdAt: "2026-10-19T10:00:00.000Z",
      group: "6AM Crew",
      groupId: "40000000-0000-4000-8000-000000000001",
      reporter: "Akrum",
      subject: "Maya",
      subjectStatus: "active",
      message: "rude words",
      photoUrls: [],
    },
  ],
  holds: [],
  suspended: [],
  groups: [
    {
      groupId: "40000000-0000-4000-8000-000000000001",
      name: "6AM Crew",
      members: [
        { membershipId: "30000000-0000-4000-8000-000000000002", name: "Maya" },
      ],
    },
  ],
};

test("operators work cases and open pauses from the console", async ({
  page,
}) => {
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/home/extras")
      return homeExtras({
        safety: { conductAccepted: true, blocked: [], operator: true },
      });
    if (path === "/v1/operator") return state;
    if (path === "/v1/operator/resolve")
      return {
        ...state,
        cases: [],
        suspended: [{ accountId: "a", name: "Maya" }],
      };
    if (path === "/v1/operator/hold")
      return {
        ...state,
        cases: [],
        holds: [
          {
            id: "91000000-0000-4000-8000-000000000001",
            kind: "technical",
            group: "6AM Crew",
            member: "Maya",
            reason: body?.reason,
            startsAt: "2026-10-19T11:00:00.000Z",
          },
        ],
      };
  });
  await page.getByRole("link", { name: /^Account/ }).click();
  await page.getByRole("link", { name: /Operator console/ }).click();
  await expect(page.getByText("rude words")).toBeVisible();
  await delayRoute(page, "**/v1/operator/resolve", 1000);
  await page.getByRole("button", { name: "Suspend access" }).click();
  const pending = await msUntilVisible(
    page,
    () =>
      page
        .getByRole("dialog", { name: "Suspend access?" })
        .getByRole("button", { name: "Suspend access" })
        .click(),
    page.getByRole("button", { name: "Working…" }),
  );
  expect(pending).toBeLessThanOrEqual(100);
  await expect(page.getByRole("button", { name: "Reinstate" })).toBeVisible();
  await page
    .getByRole("combobox", { name: /^Group/ })
    .selectOption({ label: "6AM Crew" });
  await page
    .getByRole("combobox", { name: /^Who/ })
    .selectOption({ label: "Maya (Technical pause)" });
  await page.getByLabel("Reason").fill("Camera bug");
  await page.getByRole("button", { name: "Open pause" }).click();
  await expect(page.getByText(/Technical · Maya · Camera bug/)).toBeVisible();
  expect(calls.find((c) => c.path === "/v1/operator/hold")?.body).toEqual({
    open: true,
    groupId: "40000000-0000-4000-8000-000000000001",
    membershipId: "30000000-0000-4000-8000-000000000002",
    reason: "Camera bug",
  });
  expect(errors).toEqual([]);
});

test("the console refuses members who are not operators", async ({ page }) => {
  await signIn(page, ({ path }) => (path === "/v1/operator" ? 403 : undefined));
  await page.evaluate(() => {
    window.history.pushState(null, "", "/operator");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByText("This console is for the app’s operator only."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Operator console/ }),
  ).toHaveCount(0);
});
