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
  } | null;
  reviews: { claimId: string; memberName: string; title: string }[];
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

    const attemptId = selected.attempt?.attemptId as string;
    const claimed = await command(db, 0, "claim", attemptId);
    expect(claimed.attempt).toMatchObject({
      status: "review",
      approvals: 0,
      approvalsNeeded: 2,
    });
    const peer = await home(db, 1);
    expect(peer.reviews).toMatchObject([
      { memberName: "Alex", title: picked?.title },
    ]);
    expect(peer.groupOwed).toEqual({ [memberships[0] as string]: 2 });
    const claimId = peer.reviews[0]?.claimId as string;
    await command(db, 1, "respond", claimId, "approve");
    await command(db, 2, "respond", claimId, "approve");

    const done = await home(db, 0);
    expect(done.owed).toBe(1);
    expect(done.attempt).toBeNull();
    expect(done.offer?.canRedraw).toBe(true);
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
    await command(db, 0, "pause", attemptId);
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
    await command(db, 0, "claim", attemptId);
    const claimId = (await home(db, 1)).reviews[0]?.claimId as string;
    await command(db, 1, "respond", claimId, "reject");
    await command(db, 2, "respond", claimId, "reject");
    const after = await home(db, 0);
    expect(after.owed).toBe(1);
    expect(after.offer?.canRedraw).toBe(true);
  });
});
