import { expect, test } from "@playwright/test";
import { closePost, friendId, openPost, signIn } from "./member";

const clip = (overrides: Record<string, unknown>) => ({
  claimId: "80000000-0000-4000-8000-000000000001",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  cardTitle: "100 burpees",
  submittedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  approvedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  clipUrl: null,
  ...overrides,
});

test("approved Consequence clips join the Wall; your own pops up once", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed") return [];
    if (path === "/v1/consequences/feed")
      return [
        clip({}),
        clip({
          claimId: "80000000-0000-4000-8000-000000000002",
          mine: true,
          authorName: "You",
          cardTitle: "Cold shower",
        }),
      ];
  });
  const popup = page.getByRole("dialog", { name: "Card cleared" });
  await expect(popup).toContainText("Cold shower");
  await page.screenshot({ path: testInfo.outputPath("popup.png") });
  await popup.getByRole("button", { name: "Nice" }).click();
  await expect(popup).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("tiles.png") });
  const viewer = await openPost(page, "Maya");
  await expect(viewer.locator(".proof-consequence-label")).toHaveText(
    "Consequence",
  );
  await expect(viewer).toContainText("100 burpees");
  await page.screenshot({ path: testInfo.outputPath("post.png") });
  await closePost(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^You, Consequence: Cold shower/ }),
  ).toBeVisible();
  await expect(popup).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Consequence clips take reactions and comments like workout posts", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed") return [];
    if (path === "/v1/consequences/feed")
      return [
        clip({
          reactions: [{ emoji: "🔥", count: 1 }],
          myReactions: [],
          messages: [
            {
              id: "80000000-0000-4000-8000-0000000000aa",
              name: "Sam",
              mine: false,
              body: "Brutal card",
              at: new Date(Date.now() - 3_600_000).toISOString(),
            },
          ],
        }),
      ];
    if (path.endsWith("/react")) return { emoji: "🔥", on: true };
    if (path === "/v1/safety/conduct") return { version: 1 };
    if (path.endsWith("/message")) return { id: "x" };
  });
  const viewer = await openPost(page, "Maya");
  const reactions = viewer.getByRole("group", { name: "Reactions" });
  await expect(reactions.getByRole("button", { name: "🔥, 1" })).toBeVisible();
  await expect(viewer).toContainText("Brutal card");
  await page.screenshot({ path: testInfo.outputPath("clip-social.png") });
  await viewer.getByRole("button", { name: "Comment", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Group conduct rules" })
    .getByRole("button", { name: "I agree" })
    .click();
  const sent = page.waitForRequest("**/v1/consequences/clip/*/message");
  await page.getByRole("textbox", { name: "Comment" }).fill("Respect");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await sent;
  await expect(
    page.getByRole("list", { name: "Comments", exact: true }),
  ).toContainText("Respect");
  await page.screenshot({ path: testInfo.outputPath("clip-comments.png") });
  await page
    .getByRole("dialog", { name: "Comments" })
    .getByRole("button", { name: "Close" })
    .click();
  await reactions.getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("button", { name: "React 🔥" }).click();
  await expect(reactions.getByRole("button", { name: "🔥, 2" })).toBeVisible();
  expect(errors).toEqual([]);
});
