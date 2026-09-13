import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

test.skip(
  !process.env.LIVE_PWA_INTEGRATION,
  "Requires started local Supabase and loopback API",
);

const root = "http://127.0.0.1:4174";
const supabase = "http://127.0.0.1:54321";
const mailbox = "http://127.0.0.1:54324";
const databaseUrl = process.env.DATABASE_URL;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;

async function makeAccount() {
  if (
    !serviceKey ||
    !databaseUrl ||
    new URL(databaseUrl).hostname !== "127.0.0.1"
  )
    throw new Error("Local service key and database URL required");
  const email = `pwa-${randomUUID()}@example.test`;
  const created = await fetch(`${supabase}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`Local Auth seed failed: ${created.status}`);
  const user = await created.json();
  const accountId = randomUUID();
  const sql = `insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at) values ('${accountId}'::uuid, '${user.id}'::uuid, '${email}', now()); insert into app_private.consents (account_id, purpose, version, granted_at) select '${accountId}'::uuid, purpose, 'v1', now() from (values ('pilot'), ('product'), ('media')) p(purpose);`;
  const database = new URL(databaseUrl);
  const seeded = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
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
  if (seeded.status !== 0) throw new Error("Local Account seed failed");
  return email;
}

async function signIn(page: Page, email: string) {
  await page.goto(`${root}/sign-in`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
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
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Your Group" })).toBeVisible();
}

test("live local Auth and PostgreSQL weekly loop", async ({
  browser,
}, testInfo) => {
  const owner = await makeAccount();
  const peer = await makeAccount();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const failures: string[] = [];
  const inspect = (target: Page) => {
    target.on("pageerror", (error) => failures.push(error.message));
    target.on("requestfailed", (request) => failures.push(request.url()));
    target.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text());
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
  };
  inspect(page);
  await signIn(page, owner);
  await page.getByLabel("Group name").fill("Local PWA acceptance");
  await page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Create Group" }) })
    .getByLabel("Weekly target")
    .fill("2");
  await page.getByRole("button", { name: "Create Group", exact: true }).click();
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
  expect(token).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Home" }).click();

  const peerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const peerPage = await peerContext.newPage();
  inspect(peerPage);
  await signIn(peerPage, peer);
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
  await page.screenshot({
    path: testInfo.outputPath("home-before.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Target" }).click();
  await page.getByLabel("Workouts per week").fill("3");
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(
    page.getByText("Weekly target set to 3", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save target" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("target.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("0 / 2", { exact: true })).toBeVisible();
  await page.getByLabel("Duration in minutes").fill("30");
  await page.getByLabel(/self-report/i).check();
  await page.getByRole("button", { name: "Log workout" }).click();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log workout" })).toBeEnabled();
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
  expect(failures).toEqual([]);
  await peerContext.close();
  await context.close();
});
