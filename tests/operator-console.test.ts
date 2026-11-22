import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accounts,
  as,
  data,
  database,
  group,
  memberships,
  memberWeeks,
  rejects,
  submitProof,
} from "./support/pwa-db.js";

type Console = {
  cases: Array<{
    id: string;
    kind: string;
    subject: string;
    message: string | null;
  }>;
  holds: Array<{ id: string; kind: string; member: string | null }>;
  suspended: Array<{ accountId: string; name: string }>;
};
type Db = Awaited<ReturnType<typeof database>>;

// Casey is the operator, as well as a member.
async function withOperator() {
  const db = await database();
  await db.query(
    "insert into app_private.staff_assignments (assignment_id, account_id, role, starts_at) values ($1, $2, 'operator', '2026-01-01Z')",
    [randomUUID(), accounts[2]],
  );
  return db;
}
const console_ = (db: Db) =>
  data<Console>(
    db,
    2,
    "select app_private.operator_console('2026-03-05T12:00Z') as data",
  );

describe("Operator console", { timeout: 30_000 }, () => {
  it("is for operators only", async () => {
    const db = await withOperator();
    await as(db, 0);
    expect(
      await rejects(
        db.query("select app_private.operator_console('2026-03-05Z')"),
      ),
    ).toBe("42501");
    const flag = await data<{ safety: { operator: boolean } }>(
      db,
      2,
      "select app_private.home_extras('2026-03-05Z') as data",
    );
    expect(flag.safety.operator).toBe(true);
  });

  it("restores a dismissed message and suspends with a Moderation hold", async () => {
    const db = await withOperator();
    const post = await submitProof(db, 0);
    await as(db, 1);
    await db.query("select app_private.accept_conduct()");
    const message = randomUUID();
    await db.query(
      "select app_private.post_proof_message($1, $2, 'hmm', '2026-03-05T11:00Z')",
      [message, post],
    );
    await as(db, 0);
    await db.query(
      "select app_private.report_message($1, 'harassment', '2026-03-05T11:10Z')",
      [message],
    );
    await db.query(
      "select app_private.report_member($1, 'threats', '2026-03-05T11:20Z')",
      [memberships[1]],
    );
    const queue = await console_(db);
    expect(
      queue.cases.map(({ kind, subject, message: body }) => ({
        kind,
        subject,
        body,
      })),
    ).toEqual([
      { kind: "message_report", subject: "Blair", body: "hmm" },
      { kind: "member_report", subject: "Blair", body: null },
    ]);
    await data(
      db,
      2,
      "select app_private.operator_resolve_case($1, 'dismiss', '2026-03-05T12:00Z') as data",
      [queue.cases[0]?.id],
    );
    const hidden = await db.query<{ hidden_at: string | null }>(
      "select hidden_at from app_private.proof_messages where proof_message_id = $1",
      [message],
    );
    expect(hidden.rows[0]?.hidden_at).toBeNull();

    const after = await data<Console>(
      db,
      2,
      "select app_private.operator_resolve_case($1, 'suspend', '2026-03-05T12:05Z') as data",
      [queue.cases[1]?.id],
    );
    expect(after.cases).toEqual([]);
    expect(after.suspended).toEqual([
      { accountId: accounts[1], name: "Blair" },
    ]);
    expect(after.holds).toMatchObject([{ kind: "technical", member: "Blair" }]);
    // Suspended: the API sees no active account.
    await as(db, 1);
    const actor = await db.query<{ id: string | null }>(
      "select app_private.actor_account_id() as id",
    );
    expect(actor.rows[0]?.id).toBeNull();
    const back = await data<Console>(
      db,
      2,
      "select app_private.operator_reinstate($1, '2026-03-06Z') as data",
      [accounts[1]],
    );
    expect(back).toMatchObject({ suspended: [], holds: [] });
  });

  it("holds a Group's weeks open during a Service pause", async () => {
    const db = await withOperator();
    const held = await data<Console>(
      db,
      2,
      "select app_private.operator_set_hold($1, null, 'Upload outage', true, null, '2026-03-08T20:00Z') as data",
      [group],
    );
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    const status = async () =>
      (
        await db.query<{ status: string }>(
          "select status::text from app_private.member_weeks where member_week_id = $1",
          [memberWeeks[0]],
        )
      ).rows[0]?.status;
    expect(await status()).toBe("active");
    await data(
      db,
      2,
      "select app_private.operator_set_hold(null, null, '', false, $1, '2026-03-09T03:00Z') as data",
      [held.holds[0]?.id],
    );
    // The 7-hour pause moved the week's end from Mar 9 00:00 to 07:00.
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T04:00Z')",
    );
    expect(await status()).toBe("active");
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T07:01Z')",
    );
    expect(await status()).toBe("missed");
  });

  it("stops the Group clock, notifies members, and shifts the calendar on resume", async () => {
    const db = await withOperator();
    const weeks = async () =>
      (
        await db.query<{ starts_at: Date; ends_at: Date }>(
          "select starts_at, ends_at from app_private.accountability_weeks where group_id = $1 order by starts_at",
          [group],
        )
      ).rows.map((row) => [
        new Date(row.starts_at).toISOString(),
        new Date(row.ends_at).toISOString(),
      ]);
    const notices = async () =>
      (
        await db.query<{ title: string; body: string }>(
          "select title, body from app_private.web_push_outbox where dedupe_key like 'pause:%' order by outbox_id",
        )
      ).rows;
    const held = await data<Console>(
      db,
      2,
      "select app_private.operator_set_hold($1, null, 'Upload outage', true, null, '2026-03-08T12:00Z') as data",
      [group],
    );
    expect(await notices()).toHaveLength(3);
    expect((await notices())[0]?.title).toBe("Week paused");
    expect(
      await data<{ groupPause: { reason: string } | null }>(
        db,
        0,
        "select app_private.home_extras('2026-03-08T13:00Z') as data",
      ),
    ).toMatchObject({ groupPause: { reason: "Upload outage" } });
    await as(db, 2);
    expect(
      await rejects(
        db.query(
          "select app_private.operator_set_hold($1, null, 'Again', true, null, '2026-03-08T13:00Z')",
          [group],
        ),
      ),
    ).toBe("22023");
    // The week end passes during the pause: no rollover.
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-10T00:00Z')",
    );
    expect(await weeks()).toEqual([
      ["2026-03-02T00:00:00.000Z", "2026-03-09T00:00:00.000Z"],
    ]);
    // Resumed after 36 hours: this week and every later one move 36 hours.
    await data(
      db,
      2,
      "select app_private.operator_set_hold(null, null, '', false, $1, '2026-03-10T00:00Z') as data",
      [held.holds[0]?.id],
    );
    expect((await notices()).at(-1)).toMatchObject({
      title: "Week resumed",
      body: "The clock is running again. This week now ends Tuesday March 10, 12:00 PM.",
    });
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-17T13:00Z')",
    );
    expect(await weeks()).toEqual([
      ["2026-03-02T00:00:00.000Z", "2026-03-10T12:00:00.000Z"],
      ["2026-03-10T12:00:00.000Z", "2026-03-17T12:00:00.000Z"],
      ["2026-03-17T12:00:00.000Z", "2026-03-24T12:00:00.000Z"],
    ]);
  });
});
