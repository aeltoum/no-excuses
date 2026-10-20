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

type Home = {
  owed: number;
  offer: {
    offerId: string;
    canRedraw: boolean;
    cards: { cardId: string; title: string }[];
  } | null;
  attempt: {
    attemptId: string;
    status: string;
    title: string;
    expiresAt: string;
    approvals: number;
    approvalsNeeded: number;
    clipPath?: string | null;
    pauseRequest?: { approvals: number; approvalsNeeded: number } | null;
  } | null;
  reviews: {
    claimId: string;
    memberName: string;
    title: string;
    clipPath: string | null;
  }[];
  pauseReviews: { pauseRequestId: string; memberName: string }[];
  logBlocked: boolean;
  groupOwed: Record<string, number>;
};

async function database() {
  const db = new PGlite();
  opened.push(db);
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const file of (await readdir(migrationsDirectory)).sort()) {
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
  `);
  return db;
}

async function owe(db: PGlite, member = 0, at = "2026-03-09T00:00Z") {
  await db.query(
    "select app_private.add_consequence_obligation($1, $2, 'missed_target', $3, $4)",
    [randomUUID(), memberships[member], randomUUID(), at],
  );
}

async function as(db: PGlite, member: number) {
  await db.query("select set_config('app.auth_user_id', $1, false)", [
    auth[member],
  ]);
  await db.query("select set_config('app.token_issued_at', $1, false)", [
    "2026-03-08T00:00Z",
  ]);
}

const home = async (db: PGlite, member: number, at = "2026-03-09T01:00Z") => {
  await as(db, member);
  return (
    await db.query<{ home: Home }>(
      "select app_private.consequence_home($1) as home",
      [at],
    )
  ).rows[0]?.home as Home;
};

const command = async (
  db: PGlite,
  member: number,
  action: string,
  target: string,
  choice = "",
  at = "2026-03-09T01:00Z",
) => {
  await as(db, member);
  return (
    await db.query<{ home: Home }>(
      "select app_private.consequence_command($1, $2, $3, $4) as home",
      [action, target, choice, at],
    )
  ).rows[0]?.home as Home;
};

type Challenge = {
  challengeId: string;
  code: string;
  action: string;
  issuedAt: string;
  expiresAt: string;
};
const challenge = async (
  db: PGlite,
  member: number,
  attemptId: string,
  at = "2026-03-09T01:00Z",
) => {
  await as(db, member);
  return (
    await db.query<{ challenge: Challenge }>(
      "select app_private.issue_consequence_challenge($1, $2) as challenge",
      [attemptId, at],
    )
  ).rows[0]?.challenge as Challenge;
};
const clipUpload = async (
  db: PGlite,
  member: number,
  challengeId: string,
  at = "2026-03-09T01:00Z",
  extension = "mp4",
) => {
  await as(db, member);
  return (
    await db.query<{ path: string }>(
      "select app_private.create_consequence_clip_upload($1, $2, $3) as path",
      [challengeId, extension, at],
    )
  ).rows[0]?.path as string;
};
// Challenge, then upload path, as the card owner would record it in the app.
const recordClip = async (
  db: PGlite,
  member: number,
  attemptId: string,
  at = "2026-03-09T01:00Z",
) =>
  clipUpload(
    db,
    member,
    (await challenge(db, member, attemptId, at)).challengeId,
    at,
  );

const advance = (db: PGlite, at: string) =>
  db.query("select app_private.advance_consequences($1)", [at]);

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("Consequence play loop", { timeout: 30_000 }, () => {
  it("offers three heavy cards, redraws once, and completes after two approvals", async () => {
    const db = await database();
    await owe(db);
    await owe(db, 0, "2026-03-09T00:01Z");
    expect((await home(db, 0)).offer).toBeNull();
    await advance(db, "2026-03-09T00:30Z");
    const first = await home(db, 0);
    expect(first.owed).toBe(2);
    expect(first.offer?.canRedraw).toBe(true);
    expect(first.offer?.cards).toHaveLength(3);
    const offerId = first.offer?.offerId as string;

    await expect(command(db, 1, "redraw", offerId)).rejects.toThrow(
      "Consequence action unavailable",
    );
    const redrawn = await command(db, 0, "redraw", offerId);
    expect(redrawn.offer?.canRedraw).toBe(false);
    const original = new Set(first.offer?.cards.map((card) => card.cardId));
    for (const card of redrawn.offer?.cards ?? [])
      expect(original.has(card.cardId)).toBe(false);
    await expect(command(db, 0, "redraw", offerId)).rejects.toThrow();

    const picked = redrawn.offer?.cards[0];
    const selected = await command(db, 0, "select", offerId, picked?.cardId);
    expect(selected.offer).toBeNull();
    expect(selected.attempt).toMatchObject({
      status: "active",
      title: picked?.title,
      expiresAt: "2026-03-11T01:00:00+00:00",
    });

    expect(selected.logBlocked).toBe(true);
    const attemptId = selected.attempt?.attemptId as string;
    await expect(command(db, 0, "claim", attemptId)).rejects.toThrow(
      "video proof required",
    );
    const clipPath = await recordClip(db, 0, attemptId);
    const claimed = await command(db, 0, "claim", attemptId, clipPath);
    expect(claimed.attempt?.clipPath).toBe(clipPath);
    expect(claimed.attempt).toMatchObject({
      status: "review",
      approvals: 0,
      approvalsNeeded: 2,
    });
    expect(claimed.logBlocked).toBe(false);
    const peer = await home(db, 1);
    expect(peer.reviews).toMatchObject([
      { memberName: "Alex", title: picked?.title, clipPath },
    ]);
    expect(peer.groupOwed).toEqual({ [memberships[0] as string]: 2 });
    const claimId = peer.reviews[0]?.claimId as string;
    await command(db, 1, "respond", claimId, "approve");
    await command(db, 2, "respond", claimId, "approve");

    const done = await home(db, 0);
    expect(done.owed).toBe(1);
    expect(done.attempt).toBeNull();
    expect(done.offer?.canRedraw).toBe(true);
    expect(done.logBlocked).toBe(true);
  });

  it("denies a pause request once enough members reject it", async () => {
    const db = await database();
    await owe(db);
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    const attemptId = (
      await command(
        db,
        0,
        "select",
        offer?.offerId as string,
        offer?.cards[0]?.cardId,
      )
    ).attempt?.attemptId as string;
    await command(db, 0, "request_pause", attemptId);
    const requestId = (await home(db, 1)).pauseReviews[0]
      ?.pauseRequestId as string;
    await command(db, 1, "vote_pause", requestId, "reject");
    await command(db, 2, "vote_pause", requestId, "reject");
    const after = await home(db, 0);
    expect(after.attempt?.status).toBe("active");
    expect(after.attempt?.pauseRequest).toBeNull();
    expect(after.logBlocked).toBe(true);
    expect((await home(db, 1)).pauseReviews).toEqual([]);
  });

  it("adds another owed card when the 48-hour deadline passes", async () => {
    const db = await database();
    await owe(db);
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    await command(
      db,
      0,
      "select",
      offer?.offerId as string,
      offer?.cards[0]?.cardId,
    );
    await advance(db, "2026-03-11T00:59Z");
    expect((await home(db, 0, "2026-03-11T00:59Z")).attempt?.status).toBe(
      "active",
    );
    await advance(db, "2026-03-11T01:00Z");
    const after = await home(db, 0, "2026-03-11T01:00Z");
    expect(after.owed).toBe(2);
    expect(after.attempt).toBeNull();
    expect(after.offer?.cards).toHaveLength(3);
  });

  it("reminds silent reviewers 12 hours out and approves a review with no rejections", async () => {
    const db = await database();
    await owe(db);
    await owe(db, 0, "2026-03-09T00:01Z");
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    await command(
      db,
      0,
      "select",
      offer?.offerId as string,
      offer?.cards[0]?.cardId,
    );
    const attemptId = (await home(db, 0)).attempt?.attemptId as string;
    await command(
      db,
      0,
      "claim",
      attemptId,
      await recordClip(db, 0, attemptId),
    );
    const claimId = (await home(db, 1)).reviews[0]?.claimId as string;
    await command(db, 1, "respond", claimId, "approve");
    await db.exec(`insert into app_private.web_push_subscriptions
      (endpoint, account_id, p256dh, auth, created_at) values
      ('https://push.example.test/1', '${accounts[1]}', 'key', 'secret', '2026-03-01Z'),
      ('https://push.example.test/2', '${accounts[2]}', 'key', 'secret', '2026-03-01Z')`);
    const reminders = async (at: string) => {
      await db.query("select app_private.enqueue_consequence_push($1)", [at]);
      return (
        await db.query<{ account_id: string }>(
          "select account_id from app_private.web_push_outbox where dedupe_key like 'card-claim-reminder:%'",
        )
      ).rows.map((row) => row.account_id);
    };
    expect(await reminders("2026-03-10T12:59Z")).toEqual([]);
    expect(await reminders("2026-03-10T13:00Z")).toEqual([accounts[2]]);
    expect(await reminders("2026-03-10T14:00Z")).toEqual([accounts[2]]);

    await advance(db, "2026-03-11T01:00Z");
    const after = await home(db, 0, "2026-03-11T01:00Z");
    expect(after.owed).toBe(1);
    expect(after.attempt).toBeNull();
    expect(after.offer?.cards).toHaveLength(3);
  });

  it("pauses expiry for safety and reoffers when the member is ready", async () => {
    const db = await database();
    await owe(db);
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    const attemptId = (
      await command(
        db,
        0,
        "select",
        offer?.offerId as string,
        offer?.cards[0]?.cardId,
      )
    ).attempt?.attemptId as string;
    await expect(command(db, 0, "pause", attemptId)).rejects.toThrow(
      "Consequence action unavailable",
    );
    const requested = await command(db, 0, "request_pause", attemptId);
    expect(requested.attempt).toMatchObject({
      status: "active",
      pauseRequest: { approvals: 0, approvalsNeeded: 2 },
    });
    const peer = await home(db, 1);
    expect(peer.pauseReviews).toMatchObject([{ memberName: "Alex" }]);
    const requestId = peer.pauseReviews[0]?.pauseRequestId as string;
    await expect(
      command(db, 0, "vote_pause", requestId, "approve"),
    ).rejects.toThrow("Consequence action unavailable");
    await command(db, 1, "vote_pause", requestId, "approve");
    expect((await home(db, 0)).attempt?.status).toBe("active");
    await command(db, 2, "vote_pause", requestId, "approve");
    const paused = await home(db, 0);
    expect(paused.attempt?.status).toBe("safety_paused");
    expect(paused.logBlocked).toBe(false);
    await advance(db, "2026-03-20Z");
    expect((await home(db, 0, "2026-03-20Z")).owed).toBe(1);
    const resumed = await command(
      db,
      0,
      "resume",
      attemptId,
      "",
      "2026-03-20Z",
    );
    expect(resumed.attempt).toBeNull();
    expect(resumed.offer?.cards).toHaveLength(3);
  });

  it("returns a rejected claim to a fresh offer without adding a card", async () => {
    const db = await database();
    await owe(db);
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    const attemptId = (
      await command(
        db,
        0,
        "select",
        offer?.offerId as string,
        offer?.cards[0]?.cardId,
      )
    ).attempt?.attemptId as string;
    await command(
      db,
      0,
      "claim",
      attemptId,
      await recordClip(db, 0, attemptId),
    );
    const claimId = (await home(db, 1)).reviews[0]?.claimId as string;
    await command(db, 1, "respond", claimId, "reject");
    await command(db, 2, "respond", claimId, "reject");
    const after = await home(db, 0);
    expect(after.owed).toBe(1);
    expect(after.offer?.canRedraw).toBe(true);
  });
});

describe("Consequence video proof", { timeout: 30_000 }, () => {
  const activeAttempt = async (db: PGlite) => {
    await owe(db);
    await advance(db, "2026-03-09T00:30Z");
    const offer = (await home(db, 0)).offer;
    return (
      await command(
        db,
        0,
        "select",
        offer?.offerId as string,
        offer?.cards[0]?.cardId,
      )
    ).attempt?.attemptId as string;
  };

  it("issues a one-time code and action for the owner's own active card only", async () => {
    const db = await database();
    const attemptId = await activeAttempt(db);
    const issued = await challenge(db, 0, attemptId);
    expect(issued.code).toMatch(/^[0-9]{3}$/);
    expect(issued.action).toMatch(
      /^(Hold up [2-5] fingers|Give a thumbs up|Touch your nose|Wave at the camera)$/,
    );
    expect(issued.expiresAt).toBe("2026-03-09T01:02:00+00:00");
    await expect(challenge(db, 1, attemptId)).rejects.toThrow(
      "Consequence action unavailable",
    );
    await expect(clipUpload(db, 1, issued.challengeId)).rejects.toThrow(
      "valid Consequence challenge required",
    );
    await expect(
      clipUpload(db, 0, issued.challengeId, "2026-03-09T01:00Z", "mov"),
    ).rejects.toThrow("valid Consequence challenge required");

    // Reissue replaces the open challenge; only one stays open per card.
    const again = await challenge(db, 0, attemptId);
    expect(again.challengeId).not.toBe(issued.challengeId);
    await expect(clipUpload(db, 0, issued.challengeId)).rejects.toThrow(
      "valid Consequence challenge required",
    );
    expect(
      (
        await db.query(
          `select count(*)::integer as count from app_private.consequence_challenges
          where attempt_id = $1 and replaced_at is null and used_at is null`,
          [attemptId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    const path = await clipUpload(db, 0, again.challengeId);
    expect(path).toBe(`${accounts[0]}/${again.challengeId}.mp4`);
    expect(await clipUpload(db, 0, again.challengeId)).toBe(path);
  });

  it("expires the upload window after 2 minutes and the claim window after 10", async () => {
    const db = await database();
    const attemptId = await activeAttempt(db);
    const late = await challenge(db, 0, attemptId);
    await expect(
      clipUpload(db, 0, late.challengeId, "2026-03-09T01:02Z"),
    ).rejects.toThrow("valid Consequence challenge required");

    const slow = await challenge(db, 0, attemptId, "2026-03-09T01:03Z");
    const slowPath = await clipUpload(
      db,
      0,
      slow.challengeId,
      "2026-03-09T01:04:59Z",
    );
    await expect(
      command(db, 0, "claim", attemptId, slowPath, "2026-03-09T01:13Z"),
    ).rejects.toThrow("video proof required");
    const done = await command(
      db,
      0,
      "claim",
      attemptId,
      slowPath,
      "2026-03-09T01:12:59Z",
    );
    expect(done.attempt?.status).toBe("review");
  });

  it("rejects claims without a valid, unused clip from the caller's challenge", async () => {
    const db = await database();
    const attemptId = await activeAttempt(db);
    const issued = await challenge(db, 0, attemptId);
    await expect(
      command(
        db,
        0,
        "claim",
        attemptId,
        `${accounts[0]}/${issued.challengeId}.mp4`,
      ),
    ).rejects.toThrow("video proof required");
    await expect(
      command(db, 0, "claim", attemptId, `${accounts[0]}/${randomUUID()}.mp4`),
    ).rejects.toThrow("video proof required");
    const path = await clipUpload(db, 0, issued.challengeId);
    await expect(command(db, 1, "claim", attemptId, path)).rejects.toThrow(
      "Consequence action unavailable",
    );
    await command(db, 0, "claim", attemptId, path);
    await expect(recordClip(db, 0, attemptId)).rejects.toThrow(
      "Consequence action unavailable",
    );
    expect(
      (
        await db.query(
          "select clip_path from app_private.consequence_claims where attempt_id = $1",
          [attemptId],
        )
      ).rows,
    ).toEqual([{ clip_path: path }]);
  });

  it("keeps attached clips until the author leaves and cleans up abandoned uploads after a day", async () => {
    const db = await database();
    const attemptId = await activeAttempt(db);
    const abandoned = await recordClip(db, 0, attemptId);
    const kept = await recordClip(db, 0, attemptId, "2026-03-09T01:05Z");
    await command(db, 0, "claim", attemptId, kept, "2026-03-09T01:06Z");
    const due = async (at: string) =>
      (
        await db.query<{ path: string }>(
          "select path from app_private.consequence_clips_due($1)",
          [at],
        )
      ).rows.map((row) => row.path);
    expect(await due("2026-03-10T00:59Z")).toEqual([]);
    expect(await due("2026-03-10T01:00Z")).toEqual([abandoned]);
    await db.query(
      "select app_private.mark_consequence_clips_deleted($1, '2026-03-10T01:00Z')",
      [[abandoned]],
    );
    expect(await due("2027-03-10T00:00Z")).toEqual([]);
    expect(
      (
        await db.query(
          "select deleted_at from app_private.consequence_challenges where clip_path = $1",
          [kept],
        )
      ).rows,
    ).toEqual([{ deleted_at: null }]);
    await db.query(
      `update app_private.memberships m set ended_at = '2027-03-10T00:00Z', end_reason = 'left'
       from app_private.consequence_attempts t
       join app_private.consequence_obligations o on o.obligation_id = t.obligation_id
       where t.attempt_id = $1 and m.membership_id = o.membership_id`,
      [attemptId],
    );
    expect(await due("2027-03-10T00:01Z")).toEqual([kept]);
    await db.query(
      "select app_private.mark_consequence_clips_deleted($1, '2027-03-10T00:01Z')",
      [[kept]],
    );
    expect(await due("2027-03-10T00:02Z")).toEqual([]);
    expect(
      (
        await db.query(
          "select clip_path from app_private.consequence_claims where attempt_id = $1",
          [attemptId],
        )
      ).rows,
    ).toEqual([{ clip_path: null }]);
  });

  it("requires the uploaded clip object when storage is present", async () => {
    const db = await database();
    await db.exec(`create schema storage;
      create table storage.objects (bucket_id text, name text, metadata jsonb,
        created_at timestamptz);`);
    const attemptId = await activeAttempt(db);
    const path = await recordClip(db, 0, attemptId);
    await expect(command(db, 0, "claim", attemptId, path)).rejects.toThrow(
      "video proof required",
    );
    const store = (size: number, type: string, at = "2026-03-09T01:00:30Z") =>
      db.query(
        "insert into storage.objects values ('consequence-clips', $1, $2, $3)",
        [path, { size, mimetype: type }, at],
      );
    await store(1000, "image/jpeg");
    await store(13_000_000, "video/mp4");
    await store(1000, "video/mp4", "2026-03-09T00:59Z");
    await expect(command(db, 0, "claim", attemptId, path)).rejects.toThrow(
      "video proof required",
    );
    await db.exec("delete from storage.objects");
    await store(1000, "video/mp4");
    const done = await command(
      db,
      0,
      "claim",
      attemptId,
      path,
      "2026-03-09T01:01Z",
    );
    expect(done.attempt?.status).toBe("review");
  });
});
