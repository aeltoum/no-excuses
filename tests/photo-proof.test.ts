import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const group = "10000000-0000-4000-8000-000000000001";
const auth = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
const accounts = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
];
const memberships = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
];
const week = "50000000-0000-4000-8000-000000000001";

const switchOver = "20261115000000_proof_counts_on_submit.sql";

async function database(before?: string) {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
    if (before && file >= before) break;
    await db.exec(await readFile(new URL(file, migrationsDirectory), "utf8"));
  }
  await db.exec(`
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at, display_name) values
      ('${accounts[0]}', '${auth[0]}', 'a@example.test', '2026-03-01Z', 'Alex'),
      ('${accounts[1]}', '${auth[1]}', 'b@example.test', '2026-03-01Z', 'Blair'),
      ('${accounts[2]}', '${auth[2]}', 'c@example.test', '2026-03-01Z', 'Casey');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at) values
      ('${group}', 'Friends', 'UTC', 'active', '2026-03-02Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target) values
      ('${memberships[0]}', '${accounts[0]}', '${group}', '2026-03-01Z', 1),
      ('${memberships[1]}', '${accounts[1]}', '${group}', '2026-03-01Z', 1),
      ('${memberships[2]}', '${accounts[2]}', '${group}', '2026-03-01Z', 1);
    insert into app_private.group_admins (membership_id) values ('${memberships[0]}');
    insert into app_private.accountability_weeks
      (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at) values
      ('${week}', '${group}', '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z');
    insert into app_private.member_weeks
      (member_week_id, membership_id, accountability_week_id, target, target_locked_at) values
      ('60000000-0000-4000-8000-000000000001', '${memberships[0]}', '${week}', 1, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000002', '${memberships[1]}', '${week}', 1, '2026-03-02Z'),
      ('60000000-0000-4000-8000-000000000003', '${memberships[2]}', '${week}', 1, '2026-03-02Z');
  `);
  return db;
}

async function as(db: PGlite, member: number) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [
    auth[member],
  ]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-04T00:00Z",
  ]);
}

async function upload(db: PGlite, kind: string, at = "2026-03-05T09:00Z") {
  return (
    await db.query<{ path: string }>(
      "select app_private.create_proof_upload($1, $2) as path",
      [kind, at],
    )
  ).rows[0]?.path as string;
}

async function submit(
  db: PGlite,
  member: number,
  photos?: { activity?: string; presence?: string; consent?: boolean },
) {
  await as(db, member);
  const activity = photos?.activity ?? (await upload(db, "activity"));
  const presence = photos?.presence ?? (await upload(db, "presence"));
  const id = randomUUID();
  await db.query(
    `select * from app_private.submit_proof_checkin($1, $2, $3, $4, 'cardio',
      '2026-03-05T09:00Z', 30, 'moderate', true, $5, $6, $7, '2026-03-05T10:00Z')`,
    [
      randomUUID(),
      "a".repeat(64),
      randomUUID(),
      id,
      activity,
      presence,
      photos?.consent ?? true,
    ],
  );
  return id;
}

const status = async (db: PGlite, id: string) =>
  (
    await db.query<{ review_status: string }>(
      "select review_status::text from app_private.workout_checkins where workout_checkin_id = $1",
      [id],
    )
  ).rows[0]?.review_status;

const progress = async (db: PGlite, member: number) =>
  (
    await db.query<{ n: number }>(
      "select count(*)::integer as n from app_private.workout_checkins c join app_private.memberships m using (membership_id) where m.membership_id = $1 and c.review_status = 'verified'",
      [memberships[member]],
    )
  ).rows[0]?.n;

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("Photo proof", { timeout: 30_000 }, () => {
  it("requires two own unused photos and media consent", async () => {
    const db = await database();
    await expect(submit(db, 0, { consent: false })).rejects.toThrow(
      "media-sharing consent required",
    );
    await as(db, 1);
    const foreign = await upload(db, "activity");
    await expect(submit(db, 0, { activity: foreign })).rejects.toThrow(
      "both proof photos required",
    );
    await as(db, 0);
    const presence = await upload(db, "presence");
    await expect(
      submit(db, 0, { activity: presence, presence }),
    ).rejects.toThrow("both proof photos required");
    const id = await submit(db, 0);
    expect(await status(db, id)).toBe("verified");
  });

  it("counts a report at once and offers no single-peer Verify", async () => {
    const db = await database();
    const id = await submit(db, 0);
    expect(await status(db, id)).toBe("verified");
    expect(
      (
        await db.query(
          "select verified_at = submitted_at as same from app_private.workout_checkins where workout_checkin_id = $1",
          [id],
        )
      ).rows,
    ).toEqual([{ same: true }]);
    expect(await progress(db, 0)).toBe(1);
    await as(db, 1);
    await expect(
      db.query(
        "select app_private.review_proof_checkin($1, 'verify', '2026-03-05T11:00Z')",
        [id],
      ),
    ).rejects.toThrow("unknown review action");
    expect(
      await db.query(
        "select app_private.advance_proof_reviews('2026-03-07T10:00Z') as n",
      ),
    ).toMatchObject({ rows: [{ n: 0 }] });
    expect(await status(db, id)).toBe("verified");
  });

  it("accepts a question until 24 hours after submission and keeps the credit", async () => {
    const db = await database();
    const early = await submit(db, 0);
    const late = await submit(db, 1);
    await as(db, 0);
    await expect(
      db.query(
        "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
        [early],
      ),
    ).rejects.toThrow("review unavailable");
    await expect(
      db.query(
        "select app_private.review_proof_checkin($1, 'question', '2026-03-06T10:00Z')",
        [late],
      ),
    ).rejects.toThrow("review window closed");
    await as(db, 1);
    expect(
      (
        await db.query<{ s: string }>(
          "select app_private.review_proof_checkin($1, 'question', '2026-03-06T09:59Z')::text as s",
          [early],
        )
      ).rows[0]?.s,
    ).toBe("questioned");
    await as(db, 2);
    await expect(
      db.query(
        "select app_private.review_proof_checkin($1, 'question', '2026-03-06T09:59Z')",
        [early],
      ),
    ).rejects.toThrow("review window closed");
    expect(await status(db, early)).toBe("verified");
    expect(await progress(db, 0)).toBe(1);
    const feed = (
      await db.query<{ review_status: string; can_vote: boolean }>(
        "select review_status, can_vote from app_private.proof_feed('2026-03-06T10:30Z') where workout_checkin_id = $1",
        [early],
      )
    ).rows;
    expect(feed).toEqual([{ review_status: "questioned", can_vote: true }]);
  });

  it("rejects by strict majority, owes a Consequence card and removes the credit", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await as(db, 1);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [id],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [id],
    );
    expect(await status(db, id)).toBe("verified");
    await as(db, 2);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:30Z')",
      [id],
    );
    expect(await status(db, id)).toBe("rejected");
    expect(await progress(db, 0)).toBe(0);
    expect(
      (
        await db.query(
          "select source_kind from app_private.consequence_obligations where source_id = $1",
          [id],
        )
      ).rows,
    ).toEqual([{ source_kind: "rejected_report" }]);
  });

  it("stays Verified without a strict majority, and withdraw makes it Unsupported", async () => {
    const db = await database();
    const split = await submit(db, 0);
    const timedOut = await submit(db, 2);
    const withdrawn = await submit(db, 1);
    await as(db, 1);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [split],
    );
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [timedOut],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [split],
    );
    await as(db, 2);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'cannot_assess', '2026-03-05T12:00Z')",
      [split],
    );
    expect(await status(db, split)).toBe("verified");
    await expect(
      db.query(
        "select app_private.vote_proof_checkin($1, 'accept', '2026-03-05T12:10Z')",
        [split],
      ),
    ).rejects.toThrow("decision closed");
    await db.query(
      "select app_private.advance_proof_reviews('2026-03-07T11:00Z')",
    );
    expect(await status(db, timedOut)).toBe("verified");
    expect(
      (
        await db.query(
          "select decided_at is not null as closed from app_private.workout_checkins where workout_checkin_id = $1",
          [timedOut],
        )
      ).rows,
    ).toEqual([{ closed: true }]);

    await as(db, 0);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [withdrawn],
    );
    await as(db, 1);
    await db.query(
      "select app_private.withdraw_proof_checkin($1, '2026-03-05T12:00Z')",
      [withdrawn],
    );
    expect(await status(db, withdrawn)).toBe("unsupported");
    expect(await progress(db, 1)).toBe(0);
  });

  it("waits for open question windows and decisions, and finished weeks never change", async () => {
    const db = await database();
    const late = await submit(db, 0);
    const rejected = await submit(db, 1);
    const questioned = await submit(db, 2);
    await as(db, 0);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [rejected],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T11:00Z')",
      [rejected],
    );
    await as(db, 2);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T11:00Z')",
      [rejected],
    );
    await db.exec(
      `update app_private.workout_checkins set submitted_at = '2026-03-08T23:00Z',
         verified_at = '2026-03-08T23:00Z' where workout_checkin_id in ('${late}', '${questioned}')`,
    );
    await as(db, 0);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-08T23:30Z')",
      [questioned],
    );
    const outcomes = async () =>
      (
        await db.query<{ membership_id: string; status: string }>(
          "select membership_id, status::text from app_private.member_weeks order by membership_id",
        )
      ).rows.map((row) => row.status);
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-09T00:01Z')",
    );
    expect(await outcomes()).toEqual(["active", "missed", "active"]);
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-09T23:00Z')",
    );
    expect(await outcomes()).toEqual(["attained", "missed", "active"]);
    await db.query(
      "select app_private.finalize_ended_member_weeks('2026-03-10T23:30Z')",
    );
    expect(await outcomes()).toEqual(["attained", "missed", "attained"]);
    await as(db, 1);
    await expect(
      db.query(
        "select app_private.review_proof_checkin($1, 'question', '2026-03-09T23:30Z')",
        [late],
      ),
    ).rejects.toThrow("review window closed");
    expect(await outcomes()).toEqual(["attained", "missed", "attained"]);
  });

  it("shows a post on the Wall for 90 days from submission, to later joiners too", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await db.exec(
      `update app_private.memberships set joined_at = '2026-03-06Z' where membership_id = '${memberships[2]}'`,
    );
    const seen = async (at: string) => {
      await as(db, 2);
      return (
        await db.query(
          "select workout_checkin_id from app_private.proof_feed($1)",
          [at],
        )
      ).rows.length;
    };
    expect(await seen("2026-03-06T12:00Z")).toBe(1);
    expect(await seen("2026-06-03T09:59Z")).toBe(1);
    expect(await seen("2026-06-03T10:00Z")).toBe(0);
    expect(id).toBeTruthy();
  });

  it("expires a legacy auto-verified post 90 days from submission, not verification", async () => {
    const db = await database();
    const id = await submit(db, 0);
    await db.exec(
      `update app_private.workout_checkins set verified_at = submitted_at + interval '24 hours',
         decided_at = submitted_at + interval '24 hours' where workout_checkin_id = '${id}'`,
    );
    await as(db, 1);
    const shown = async (at: string) =>
      (
        await db.query(
          "select workout_checkin_id from app_private.proof_feed($1)",
          [at],
        )
      ).rows.length;
    expect(await shown("2026-06-03T09:00Z")).toBe(1);
    expect(await shown("2026-06-03T11:00Z")).toBe(0);
  });

  it("hides reported proof from members until an admin restores or removes it", async () => {
    const db = await database();
    const id = await submit(db, 1);
    await as(db, 2);
    await db.query(
      "select app_private.report_proof_checkin($1, '2026-03-05T11:00Z')",
      [id],
    );
    const feed = async (member: number) => {
      await as(db, member);
      return (
        await db.query<{ workout_checkin_id: string; hidden: boolean }>(
          "select workout_checkin_id, hidden from app_private.proof_feed('2026-03-05T12:00Z')",
        )
      ).rows;
    };
    expect(await feed(2)).toEqual([]);
    expect(await feed(0)).toEqual([{ workout_checkin_id: id, hidden: true }]);
    await as(db, 2);
    await expect(
      db.query(
        "select app_private.moderate_proof_checkin($1, 'remove', '2026-03-05T12:00Z')",
        [id],
      ),
    ).rejects.toThrow("moderation unavailable");
    await as(db, 0);
    await db.query(
      "select app_private.moderate_proof_checkin($1, 'remove', '2026-03-05T12:00Z')",
      [id],
    );
    expect(await feed(0)).toEqual([]);
    const due = (
      await db.query<{ path: string }>(
        "select path from app_private.proof_media_due('2026-03-05T12:00Z')",
      )
    ).rows;
    expect(due).toHaveLength(2);
    await db.query(
      "select app_private.mark_proof_media_deleted($1, '2026-03-05T12:01Z')",
      [due.map((row) => row.path)],
    );
    expect(
      (
        await db.query(
          "select count(*)::integer as count from app_private.proof_media_due('2026-03-05T12:02Z')",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  });

  it("keeps Verified Wall media and expires abandoned uploads after a day", async () => {
    const db = await database();
    await submit(db, 0);
    await as(db, 1);
    await upload(db, "activity", "2026-03-05T11:00Z");
    const due = async (at: string) =>
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from app_private.proof_media_due($1)",
          [at],
        )
      ).rows[0]?.count;
    expect(await due("2026-03-06T10:59Z")).toBe(0);
    expect(await due("2026-03-06T11:00Z")).toBe(1);
    expect(await due("2027-03-05T11:00Z")).toBe(1);
  });

  it("switches over: pending becomes Verified, open decisions close under the new rule", async () => {
    const db = await database(switchOver);
    const pending = await submit(db, 0);
    const open = await submit(db, 1);
    const closed = await submit(db, 2);
    await as(db, 2);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [open],
    );
    await as(db, 0);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-05T11:00Z')",
      [closed],
    );
    await db.query(
      "select app_private.vote_proof_checkin($1, 'accept', '2026-03-05T11:30Z')",
      [closed],
    );
    await as(db, 1);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'cannot_assess', '2026-03-05T11:30Z')",
      [closed],
    );
    expect(await status(db, pending)).toBe("pending");
    expect(await status(db, closed)).toBe("unsupported");
    await db.exec(
      await readFile(new URL(switchOver, migrationsDirectory), "utf8"),
    );
    expect(await status(db, pending)).toBe("verified");
    expect(await status(db, open)).toBe("verified");
    expect(await status(db, closed)).toBe("unsupported");
    expect(
      (
        await db.query(
          "select verified_at = submitted_at as kept from app_private.workout_checkins where workout_checkin_id = $1",
          [pending],
        )
      ).rows,
    ).toEqual([{ kept: true }]);
    await as(db, 1);
    await db.query(
      "select app_private.review_proof_checkin($1, 'question', '2026-03-06T09:00Z')",
      [pending],
    );
    await as(db, 0);
    await db.query(
      "select app_private.vote_proof_checkin($1, 'reject', '2026-03-05T12:00Z')",
      [open],
    );
    expect(await status(db, open)).toBe("verified");
    await db.query(
      "select app_private.advance_proof_reviews('2026-03-07T11:00Z')",
    );
    expect(await status(db, open)).toBe("verified");
  });
});
