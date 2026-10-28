import { expect, type Page, type Route } from "@playwright/test";

export const membershipId = "30000000-0000-4000-8000-000000000001";
export const friendId = "30000000-0000-4000-8000-000000000002";
export const groupId = "40000000-0000-4000-8000-000000000001";
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
export const progressItem = (overrides: Record<string, unknown> = {}) => ({
  membershipId,
  displayName: "Akrum",
  lockedTarget: 3,
  completedWorkoutCount: 1,
  activityTypes: ["cardio"],
  targetStreak: 0,
  workoutStreak: 1,
  ...overrides,
});

export const homeExtras = (overrides: Record<string, unknown> = {}) => ({
  exceptions: { mine: [], toDecide: [], excused: [], pending: [] },
  recap: [],
  season: null,
  unlocks: [],
  unreadNotifications: 0,
  safety: { conductAccepted: false, blocked: [] },
  session: null,
  ...overrides,
});

export type ApiCall = {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
};
// Return a value to answer with it, a number for that error status, or undefined for the default.
export type Handler = (call: ApiCall) => unknown;

const defaults = (call: ApiCall): unknown => {
  const { path } = call;
  if (path.endsWith("/current"))
    return { membership: { groupId, membershipId } };
  if (path === "/v1/account/display-name") return { displayName: "Akrum" };
  if (path.endsWith("/current-week-progress"))
    return [
      progressItem(),
      progressItem({
        membershipId: friendId,
        displayName: "Maya",
        completedWorkoutCount: 2,
      }),
    ];
  if (path.endsWith("/finalized-weekly-history")) return [];
  if (path.endsWith("/weekly-target"))
    return {
      membershipId,
      recurringTarget: 3,
      lockedTarget: 3,
      nextWeekStartsAt: "2026-10-26T05:00:00.000Z",
      memberCount: 2,
      timeZone: "UTC",
    };
  if (path.endsWith("/members"))
    return {
      groupName: "6AM Crew",
      members: [
        {
          membershipId,
          displayName: "Akrum",
          weeklyTarget: 3,
          creator: true,
        },
        {
          membershipId: friendId,
          displayName: "Maya",
          weeklyTarget: 3,
          creator: false,
        },
      ],
    };
  if (path.endsWith("/pending-invitations")) return [];
  if (path === "/v1/proof/feed") return [];
  if (path === "/v1/proof/seen") return { marked: 0 };
  if (path === "/v1/consequences")
    return { owed: 0, offer: null, attempt: null, reviews: [], groupOwed: {} };
  if (path === "/v1/nudges") return [];
  if (path === "/v1/home/extras") return homeExtras();
  return undefined;
};

// Mocks Auth and the API, then signs in through the real form and lands on `start`.
export async function signIn(
  page: Page,
  handler: Handler = () => undefined,
  start = "/home",
  sessionOverrides: Record<string, unknown> = {},
) {
  const calls: ApiCall[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://127.0.0.1:54321/auth/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/otp")) return route.fulfill({ status: 200, json: {} });
    if (path.endsWith("/verify"))
      return route.fulfill({
        status: 200,
        json: { ...session, ...sessionOverrides },
      });
    if (path.endsWith("/user"))
      return route.fulfill({ status: 200, json: session.user });
    return route.fulfill({ status: 401, json: { message: "no session" } });
  });
  await page.route("http://127.0.0.1:8787/v1/**", async (route: Route) => {
    const request = route.request();
    const call: ApiCall = {
      path: new URL(request.url()).pathname,
      method: request.method(),
      body: request.postData() ? request.postDataJSON() : null,
    };
    calls.push(call);
    const answer = handler(call) ?? defaults(call);
    if (typeof answer === "number")
      return route.fulfill({ status: answer, json: {} });
    if (answer === undefined) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      status: 200,
      json: { contractVersion: 1, data: answer },
    });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "I already have an account" }).click();
  await page.getByLabel("Email address").fill("member@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  for (const [index, digit] of [..."123456"].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4174/home");
  if (start !== "/home")
    await page
      .getByRole("navigation", { name: "Member destinations" })
      .getByRole("link", { name: new RegExp(`^${start.slice(1)}`, "i") })
      .click();
  return { calls, errors };
}

// The week's status (barbell, friends, cards) lives on the Week tab.
export async function openWeek(page: Page) {
  await page
    .getByRole("navigation", { name: "Member destinations" })
    .getByRole("link", { name: "Week", exact: true })
    .click();
  await expect(page).toHaveURL(/\/week$/);
}

export async function openHome(page: Page) {
  await page
    .getByRole("navigation", { name: "Member destinations" })
    .getByRole("link", { name: /^Home/ })
    .click();
  await expect(page).toHaveURL(/\/home$/);
}

// Home's feed is day rows of tiles; a tile opens its post full screen.
export async function openPost(page: Page, author: string) {
  await page
    .getByRole("list", { name: "Posts by day" })
    .getByRole("button", { name: new RegExp(`^${author},`) })
    .first()
    .click();
  const viewer = page.getByRole("dialog", { name: /post$/ });
  await expect(viewer).toBeVisible();
  return viewer;
}

export async function closePost(page: Page) {
  await page.getByRole("button", { name: "Close post" }).click();
  await expect(page.getByRole("dialog", { name: /post$/ })).toHaveCount(0);
}
