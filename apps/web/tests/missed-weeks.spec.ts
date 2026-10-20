import { expect, test } from "@playwright/test";
import { friendId, homeExtras, signIn } from "./member";
import { delayRoute, msUntilVisible } from "./timing";

const week = {
  memberWeekId: "60000000-0000-4000-8000-000000000009",
  membershipId: friendId,
  name: "Maya",
  mine: false,
  completed: 1,
  target: 3,
  endsAt: new Date().toISOString(),
  responses: [{ response: "got_you", count: 1 }],
  myResponse: null,
};

test("a friend's missed week takes one preset response, instantly and changeably", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  const { calls, errors } = await signIn(page, ({ path, body }) => {
    if (path === "/v1/home/extras") return homeExtras({ missed: [week] });
    if (path.endsWith("/respond")) {
      if (fail) {
        fail = false;
        return 500;
      }
      return homeExtras({
        missed: [
          {
            ...week,
            myResponse: body?.response,
            responses: [
              { response: "got_you", count: 1 },
              { response: body?.response, count: 1 },
            ],
          },
        ],
      });
    }
  });
  const responses = page.getByRole("group", {
    name: "Respond to Maya’s missed week",
  });
  await expect(page.getByText(/missed last week · 1 of 3/)).toBeVisible();
  await responses.getByRole("button", { name: "Next week" }).click();
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(
    responses.getByRole("button", { name: "Next week" }),
  ).toHaveAttribute("aria-pressed", "false");

  await delayRoute(page, "**/v1/missed/**", 1000);
  const shown = await msUntilVisible(
    page,
    () => responses.getByRole("button", { name: "Next week" }).click(),
    responses.getByRole("button", { name: "Next week, 1" }),
  );
  expect(shown).toBeLessThanOrEqual(100);
  await expect
    .poll(() => calls.filter((c) => c.path.endsWith("/respond")).at(-1)?.body)
    .toEqual({ response: "next_week" });
  expect(errors).toEqual([]);
});
