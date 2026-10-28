import { expect, test } from "@playwright/test";
import { friendId, homeExtras, membershipId, signIn } from "./member";

const season = {
  season: 2,
  week: 3,
  standings: [
    { membershipId: friendId, name: "Maya", crowns: 2, mine: false, rank: 1 },
    { membershipId, name: "Akrum", crowns: 1, mine: true, rank: 2 },
  ],
  latest: {
    endsAt: "2026-10-19T00:00:00.000Z",
    results: [
      {
        category: "load_progression",
        name: "Maya",
        mine: false,
        score: 7.5,
        winner: true,
      },
      {
        category: "load_progression",
        name: "Akrum",
        mine: true,
        score: 2,
        winner: false,
      },
      {
        category: "cardio_leap",
        name: "Akrum",
        mine: true,
        score: 3,
        winner: false,
      },
    ],
  },
  champions: [{ season: 1, names: ["Akrum", "Maya"], crowns: 3 }],
};

test("Crowns stay hidden on Week and History while the feature is paused", async ({
  page,
}) => {
  const { errors } = await signIn(
    page,
    ({ path }) =>
      path === "/v1/home/extras"
        ? homeExtras({
            season,
            unlocks: [
              {
                title: "1 mile time trial",
                milestone: 2,
                unlockedAt: new Date().toISOString(),
                recent: true,
              },
            ],
          })
        : undefined,
    "/week",
  );
  await expect(
    page.getByText(/2-week streak: you added “1 mile time trial”/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Season 2/ })).toHaveCount(0);
  await expect(page.getByText(/👑|Crown/)).toHaveCount(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("region", { name: "Cards you added to the deck" }),
  ).toContainText("1 mile time trial · 2-week streak");
  await expect(
    page.getByRole("list", { name: "Season standings" }),
  ).toHaveCount(0);
  await expect(page.getByText(/👑|Crown/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
