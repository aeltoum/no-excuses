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
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T04:00Z')",
    );
    expect(await status()).toBe("missed");
  });

  it("voids one owed card with a reason and audit row", async () => {
    const db = await withOperator();
    const owe = () =>
      db.query(
        "select app_private.add_consequence_obligation($1, $2, 'missed_target', $3, '2026-03-05T10:00Z')",
        [randomUUID(), memberships[0], randomUUID()],
      );
    await owe();
    await db.query(
      "select app_private.advance_consequences('2026-03-05T11:00Z')",
    );
    type Cards = { cards: Array<{ obligationId: string; member: string }> };
    const before = await data<Cards>(
      db,
      2,
      "select app_private.operator_console('2026-03-05T12:00Z') as data",
    );
    expect(before.cards.map((c) => c.member)).toEqual(["Alex"]);
    const target = before.cards[0]?.obligationId;
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.operator_void_card($1, 'x', '2026-03-05T12:00Z')",
          [target],
        ),
      ),
    ).toBe("42501");
    await as(db, 2);
    expect(
      await rejects(
        db.query(
          "select app_private.operator_void_card($1, '  ', '2026-03-05T12:00Z')",
          [target],
        ),
      ),
    ).toBe("22023");
    const after = await data<Cards>(
      db,
      2,
      "select app_private.operator_void_card($1, 'Unsafe for injury', '2026-03-05T12:00Z') as data",
      [target],
    );
    expect(after.cards).toEqual([]);
    const rows = await db.query<{ o: string; offer: string; reason: string }>(
      `select o.status as o, (select string_agg(status, ',') from app_private.card_offers
         where obligation_id = o.obligation_id) as offer, v.reason
       from app_private.consequence_obligations o
       join app_private.operator_card_voids v using (obligation_id)
       where o.obligation_id = $1`,
      [target],
    );
    expect(rows.rows[0]).toEqual({
      o: "voided",
      offer: "voided",
      reason: "Unsafe for injury",
    });
    expect(
      await rejects(
        db.query(
          "select app_private.operator_void_card($1, 'again', '2026-03-05T12:01Z')",
          [target],
        ),
      ),
    ).toBe("P0002");
    // With nothing owed, the next miss owes a fresh card.
    await owe();
    const owed = await db.query<{ n: number }>(
      "select count(*)::int as n from app_private.consequence_obligations where membership_id = $1 and status = 'open'",
      [memberships[0]],
    );
    expect(owed.rows[0]?.n).toBe(1);
  });
});
