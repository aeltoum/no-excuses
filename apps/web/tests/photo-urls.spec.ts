import { expect, type Page, test } from "@playwright/test";
import { friendId, homeExtras, openPost, signIn } from "./member";
import { delayRoute } from "./timing";

// Storage here acts like Supabase: an expired token gets 400 InvalidJWT.
const storage = "http://127.0.0.1:54321/storage/v1/object/sign/proof-photos/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const token = (exp: number, sig: string) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(exp / 1000) })).toString("base64url")}.${sig}`;
const expOf = (url: string) => {
  const payload = new URL(url).searchParams.get("token")?.split(".")[1] ?? "";
  return (
    JSON.parse(Buffer.from(payload, "base64url").toString()).exp * 1000 || 0
  );
};
const day = 86_400_000;
const paths = {
  activity: "a/activity.jpg",
  presence: "a/presence.jpg",
  avatar: "m/avatar.jpg",
};
const signed = (path: string, sig: string, exp = Date.now() + day) =>
  `${storage}${path}?token=${token(exp, sig)}`;

const post = (sig: string) => ({
  workoutCheckinId: "70000000-0000-4000-8000-000000000001",
  authorMembershipId: friendId,
  authorName: "Maya",
  mine: false,
  activityType: "strength",
  durationMinutes: 45,
  perceivedIntensity: "high",
  completedAt: new Date(Date.now() - 60_000).toISOString(),
  submittedAt: new Date(Date.now() - 60_000).toISOString(),
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
  activityPhotoUrl: signed(paths.activity, sig),
  presencePhotoUrl: signed(paths.presence, sig),
  reactions: [],
  myReactions: [],
  seen: true,
});

async function setup(page: Page, failing = () => false) {
  const requested: string[] = [];
  let version = 0;
  // Context routes also see requests the service worker makes.
  await page.context().route(`${storage}**`, (route) => {
    const url = route.request().url();
    requested.push(url);
    if (expOf(url) <= Date.now())
      return route.fulfill({
        status: 400,
        json: {
          error: "InvalidJWT",
          message: '"exp" claim timestamp check failed',
        },
      });
    if (failing()) return route.fulfill({ status: 500, body: "" });
    return route.fulfill({ status: 200, contentType: "image/png", body: png });
  });
  const { errors } = await signIn(page, ({ path }) => {
    if (path === "/v1/proof/feed") return [post(`v${++version}`)];
    if (path === "/v1/home/extras")
      return homeExtras({
        avatars: { [friendId]: signed(paths.avatar, `v${version}`) },
      });
  });
  return { requested, errors, version: () => version };
}

const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((images) =>
      images.every(
        (image) =>
          (image as HTMLImageElement).complete &&
          (image as HTMLImageElement).naturalWidth > 0,
      ),
    );

// Rewrites every saved photo URL as if the app was last opened over a day ago.
const expireSaved = (page: Page) =>
  page.evaluate(() => {
    const old = (url: string) => {
      const next = new URL(url);
      const exp = Math.floor(Date.now() / 1000) - 3600;
      next.searchParams.set(
        "token",
        `h.${btoa(JSON.stringify({ exp })).replace(/=+$/, "")}.old`,
      );
      return next.toString();
    };
    for (const key of ["no-excuses:cache:feed", "no-excuses:cache:avatars"]) {
      const value = localStorage.getItem(key);
      if (value)
        localStorage.setItem(
          key,
          value.replace(/http:[^"]*proof-photos[^"]*/g, (url) => old(url)),
        );
    }
  });

const expiredRequests = (requested: string[]) =>
  requested.filter((url) => url.includes(".old"));

for (const worker of ["with", "without"] as const)
  test.describe(`${worker} the service worker`, () => {
    test.use({ serviceWorkers: worker === "with" ? "allow" : "block" });

    test("a reopened app never requests saved expired photo URLs and shows the fresh ones", async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { requested, errors } = await setup(page);
      await expect.poll(() => loaded(page, ".day-tile-photo")).toBe(true);
      if (worker === "with") {
        await expect
          .poll(() =>
            page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
          )
          .toBe(true);
        // The OS may evict the photo cache; storage alone holds the photos then.
        await page.evaluate(() => caches.delete("proof-photos"));
      }
      await expireSaved(page);
      // Fresh URLs arrive a second after the saved feed shows.
      await delayRoute(page, "**/v1/proof/feed", 1000);
      await delayRoute(page, "**/v1/home/extras", 1000);
      await page.reload();
      const tile = page.locator(".day-tile-photo");
      await expect(tile).toHaveCount(1);
      await expect.poll(() => loaded(page, "img.day-tile-photo")).toBe(true);
      await expect.poll(() => loaded(page, ".avatar img")).toBe(true);
      const viewer = await openPost(page, "Maya");
      await expect(viewer.locator(".proof-frame img")).toHaveCount(2);
      await expect.poll(() => loaded(page, ".proof-frame img")).toBe(true);
      await expect(viewer.getByText("A proof photo didn’t load.")).toHaveCount(
        0,
      );
      expect(expiredRequests(requested)).toEqual([]);
      await page.screenshot({ path: info.outputPath("fresh.png") });
      expect(errors).toEqual([]);
    });
  });

test("a photo that failed loads once a fresh URL replaces its URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Storage fails at first; the next feed load signs new URLs.
  let failing = true;
  const { requested, errors, version } = await setup(page, () => failing);
  const viewer = await openPost(page, "Maya");
  await expect(viewer.getByText("A proof photo didn’t load.")).toBeVisible();
  const failedVersion = version();
  failing = false;
  // Returning to the app reloads the feed with new URLs.
  for (const state of ["hidden", "visible"])
    await page.evaluate((value) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  await expect(viewer.getByText("A proof photo didn’t load.")).toHaveCount(0);
  await expect.poll(() => loaded(page, ".proof-frame img")).toBe(true);
  expect(requested.some((url) => url.includes(`.v${failedVersion + 1}`))).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
