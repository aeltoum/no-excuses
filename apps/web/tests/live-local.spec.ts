import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

test.skip(
  !process.env.LIVE_PWA_INTEGRATION,
  "Requires local Supabase and real PWA API",
);

const root = "http://127.0.0.1:4174";
const supabase = "http://127.0.0.1:54321";
const mailbox = "http://127.0.0.1:54324";
const databaseUrl = process.env.DATABASE_URL;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;

function localPsql(sql: string) {
  if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1")
    throw new Error("Local database URL required");
  const database = new URL(databaseUrl);
  const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: database.hostname,
      PGPORT: database.port,
      PGUSER: decodeURIComponent(database.username),
      PGPASSWORD: decodeURIComponent(database.password),
      PGDATABASE: database.pathname.slice(1),
    },
  });
  if (result.status !== 0)
    throw new Error(`Local SQL fixture/cleanup failed: ${result.stderr}`);
}

async function readCode(email: string) {
  let code = "";
  await expect
    .poll(
      async () => {
        const listing = await (
          await fetch(`${mailbox}/api/v1/messages`)
        ).json();
        const message = listing.messages?.find(
          (item: { To?: { Address: string }[] }) =>
            item.To?.some((recipient) => recipient.Address === email),
        );
        if (!message) return "";
        const detail = await (
          await fetch(`${mailbox}/api/v1/message/${message.ID}`)
        ).json();
        code =
          String(detail.Text ?? detail.HTML ?? "").match(/\b\d{6}\b/)?.[0] ??
          "";
        return code;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  return code;
}

async function signIn(page: Page, email: string, enrollmentToken?: string) {
  await page.goto(`${root}/sign-in`);
  await page
    .getByRole("button", {
      name: enrollmentToken ? "I was invited" : "I already have an account",
    })
    .click();
  await page.getByLabel("Email address").fill(email);
  if (enrollmentToken) {
    await page.getByLabel("Invitation code").fill(enrollmentToken);
  }
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code digit 1")).toBeVisible();
  for (const [index, digit] of [...(await readCode(email))].entries())
    await page.getByLabel(`Code digit ${index + 1}`).fill(digit);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Your Group" })).toBeVisible();
}

async function directToken(email: string) {
  if (!anonKey) throw new Error("Local anonymous key required");
  const headers = { apikey: anonKey, "content-type": "application/json" };
  const sent = await fetch(`${supabase}/auth/v1/otp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, create_user: false }),
  });
  if (!sent.ok) throw new Error("Local OTP request failed");
  const verified = await fetch(`${supabase}/auth/v1/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email,
      token: await readCode(email),
      type: "email",
    }),
  });
  if (!verified.ok) throw new Error("Local OTP verification failed");
  return (await verified.json()).access_token as string;
}

async function consent(page: Page) {
  await page.getByLabel("I am 18 or older.").check();
  await page.getByLabel("I consent to this private pilot.").check();
  await page.getByLabel("I consent to product terms and data use.").check();
  await page.getByRole("button", { name: "Confirm age and consent" }).click();
  await expect(
    page.getByText("Age and consent recorded.", { exact: false }),
  ).toBeVisible();
}

async function removeAuth(email: string) {
  if (!serviceKey) throw new Error("Local service key required");
  const listing = await fetch(`${supabase}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!listing.ok) throw new Error("Local Auth cleanup listing failed");
  const users = (await listing.json()).users as { id: string; email: string }[];
  const user = users.find((item) => item.email === email);
  if (!user) return;
  const deleted = await fetch(`${supabase}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!deleted.ok) throw new Error("Local Auth cleanup failed");
}

function cleanLocalRows(owner: string, peer: string, groupId?: string) {
  const group = groupId ?? "00000000-0000-4000-8000-000000000000";
  localPsql(`begin;
    create temp table smoke_accounts as select account_id from app_private.accounts where email in ('${owner}', '${peer}');
    create temp table smoke_memberships as select membership_id from app_private.memberships where account_id in (select account_id from smoke_accounts);
    delete from app_private.idempotent_requests where actor_id in (select account_id from smoke_accounts);
    delete from app_private.workout_sessions where membership_id in (select membership_id from smoke_memberships);
    delete from app_private.workout_checkins where membership_id in (select membership_id from smoke_memberships);
    delete from app_private.member_weeks where membership_id in (select membership_id from smoke_memberships);
    delete from app_private.group_invitations where group_id='${group}'::uuid;
    delete from app_private.group_admins where membership_id in (select membership_id from smoke_memberships);
    delete from app_private.season_weeks where accountability_week_id in (select accountability_week_id from app_private.accountability_weeks where group_id='${group}'::uuid);
    delete from app_private.seasons where group_id='${group}'::uuid;
    delete from app_private.accountability_weeks where group_id='${group}'::uuid;
    delete from app_private.memberships where membership_id in (select membership_id from smoke_memberships);
    delete from app_private.groups where group_id='${group}'::uuid;
    delete from app_private.consents where account_id in (select account_id from smoke_accounts);
    delete from app_private.accounts where account_id in (select account_id from smoke_accounts);
    commit;`);
}

test("private enrollment and live weekly PWA journey", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  if (!databaseUrl || !serviceKey || !process.env.SEED_ORGANIZER_EMAIL)
    throw new Error("Local integration environment incomplete");
  const owner = process.env.SEED_ORGANIZER_EMAIL;
  const peer = `pwa-${randomUUID()}@example.test`;
  let groupId: string | undefined;
  const failures: string[] = [];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const peerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const peerPage = await peerContext.newPage();
  for (const target of [page, peerPage]) {
    target.on("pageerror", (error) => failures.push(`page: ${error.message}`));
    target.on("requestfailed", (request) =>
      failures.push(`request: ${new URL(request.url()).pathname}`),
    );
    target.on("console", (message) => {
      if (message.type() === "error")
        failures.push(`console: ${message.text()}`);
    });
    target.on("response", (response) => {
      if (
        response.status() >= 400 &&
        /127\.0\.0\.1:(54321|8787)/.test(response.url())
      )
        failures.push(
          `${response.status()} ${new URL(response.url()).pathname}`,
        );
    });
  }
  try {
    const seeded = spawnSync(
      "node",
      [
        fileURLToPath(
          new URL("../../../dist/api/delivery/src/server.js", import.meta.url),
        ),
        "seed-organizer",
      ],
      {
        env: { ...process.env, SEED_ORGANIZER_EMAIL: owner },
        encoding: "utf8",
      },
    );
    expect(seeded.status, "Private organizer seed must succeed").toBe(0);
    await signIn(page, owner);
    await consent(page);
    await page.getByLabel("Group name").fill("Synthetic PWA acceptance");
    await page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Create Group" }) })
      .getByLabel("Weekly target")
      .fill("2");
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/v1/groups" &&
        request.method() === "POST"
      )
        groupId = request.postDataJSON().groupId;
    });
    await page
      .getByRole("button", { name: "Create Group", exact: true })
      .click();
    await expect(page.getByText("Group created.")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("owner-group.png"),
      fullPage: true,
    });
    await page.getByLabel("Friend email").fill(peer);
    await page.getByRole("button", { name: "Create invitation" }).click();
    const invitation = page.getByText(
      /Invitation created\. Share this token securely:/,
    );
    await expect(invitation).toBeVisible();
    const token = (await invitation.textContent())?.split(": ").at(-1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.getByRole("link", { name: "Home" }).click();
    await signIn(peerPage, peer, token);
    await consent(peerPage);
    await peerPage.getByLabel("Invitation token").fill(token ?? "");
    await peerPage
      .locator("form")
      .filter({ has: peerPage.getByRole("heading", { name: "Join Group" }) })
      .getByLabel("Weekly target")
      .fill("2");
    await peerPage.getByLabel("Current target").fill("2");
    await peerPage
      .getByRole("button", { name: "Join Group", exact: true })
      .click();
    await expect(
      peerPage.getByText("Invitation accepted. Group joined."),
    ).toBeVisible();
    await peerPage.screenshot({
      path: testInfo.outputPath("peer-joined.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(page.getByText(/Your workouts:/)).toBeVisible();
    await page.getByRole("link", { name: "Target", exact: true }).click();
    await page.getByRole("button", { name: "Increase weekly target" }).click();
    await page.getByRole("button", { name: "Save for next week" }).click();
    await expect(
      page.getByText(/Saved\. From .* your target is 3\./),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("target.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Home" }).click();
    await expect(page.getByText("0 / 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log workout" }).click();
    const workoutSheet = page.getByRole("dialog", { name: "Log a workout" });
    await workoutSheet.getByRole("button", { name: "Strength" }).click();
    await workoutSheet.getByRole("button", { name: "30 min" }).click();
    await workoutSheet.getByLabel(/self-report/i).check();
    await workoutSheet.getByRole("button", { name: "Log workout" }).click();
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("home-after.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "History" }).click();
    await expect(
      page.getByText("No finalized weekly history yet.", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("history.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText("No finalized weekly history yet.", { exact: false }),
    ).toBeVisible();
    const unauthenticated = await fetch(
      `http://127.0.0.1:8787/v1/group-memberships/current`,
    );
    expect(unauthenticated.status).toBe(401);
    const peerToken = await directToken(peer);
    localPsql(`update app_private.memberships set ended_at=now(), end_reason='left'
      where account_id=(select account_id from app_private.accounts where email='${peer}')
        and group_id='${groupId}'::uuid;`);
    for (const suffix of [
      "current-week-progress",
      "finalized-weekly-history",
    ]) {
      const denied = await fetch(
        `http://127.0.0.1:8787/v1/groups/${groupId}/${suffix}`,
        {
          headers: { authorization: `Bearer ${peerToken}` },
        },
      );
      expect(denied.status).toBe(403);
      expect(JSON.stringify(await denied.json())).not.toContain(
        "Synthetic PWA acceptance",
      );
    }
    expect(failures).toEqual([]);
  } finally {
    await context.close();
    await peerContext.close();
    cleanLocalRows(owner, peer, groupId);
    await removeAuth(owner);
    await removeAuth(peer);
  }
});
