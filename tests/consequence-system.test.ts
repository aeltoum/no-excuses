import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const opened: PGlite[] = [];
const groupId = "81000000-0000-4000-8000-000000000001";
const accounts = [1, 2, 3, 4].map(
  (n) => `82000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);
const memberships = [1, 2, 3, 4].map(
  (n) => `83000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);

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
    insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at)
    values
      ('${accounts[0]}', '84000000-0000-4000-8000-000000000001', 'one@example.test', '2026-03-01Z'),
      ('${accounts[1]}', '84000000-0000-4000-8000-000000000002', 'two@example.test', '2026-03-01Z'),
      ('${accounts[2]}', '84000000-0000-4000-8000-000000000003', 'three@example.test', '2026-03-01Z'),
      ('${accounts[3]}', '84000000-0000-4000-8000-000000000004', 'four@example.test', '2026-03-01Z');
    insert into app_private.groups (group_id, name, time_zone, status, activation_at)
      values ('${groupId}', 'Consequences', 'UTC', 'active', '2026-03-01Z');
    insert into app_private.memberships
      (membership_id, account_id, group_id, joined_at, recurring_target)
    values
      ('${memberships[0]}', '${accounts[0]}', '${groupId}', '2026-03-01Z', 2),
      ('${memberships[1]}', '${accounts[1]}', '${groupId}', '2026-03-01Z', 2),
      ('${memberships[2]}', '${accounts[2]}', '${groupId}', '2026-03-01Z', 2),
      ('${memberships[3]}', '${accounts[3]}', '${groupId}', '2026-03-01Z', 2);
  `);
  return db;
}

async function addObligation(db: PGlite, membershipId = memberships[0]) {
  const obligationId = randomUUID();
  const sourceId = randomUUID();
  await db.query(
    "select app_private.add_consequence_obligation($1, $2, 'missed_target', $3, '2026-03-10Z')",
    [obligationId, membershipId, sourceId],
  );
  return { obligationId, sourceId };
}

async function offer(
  db: PGlite,
  obligationId: string,
  entropy: string = randomUUID(),
) {
  const offerId = randomUUID();
  await db.query(
    "select app_private.create_card_offer($1, $2, $3, '2026-03-10Z')",
    [offerId, obligationId, entropy],
  );
  return offerId;
}

afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

describe("M5 Consequence system", () => {
  it("seeds reviewed catalog, awards durable unique unlocks, and preserves unique contributor provenance", async () => {
    const db = await database();
    expect(
      (
        await db.query(`select count(*)::integer as total,
        count(*) filter (where not progression)::integer as starters,
        count(*) filter (where progression)::integer as progression
        from app_private.consequence_cards`)
      ).rows,
    ).toEqual([{ total: 14, starters: 6, progression: 8 }]);

    const unlockId = randomUUID();
    const unlock = await db.query<{ award_card_unlock: string }>(
      "select app_private.award_card_unlock($1, $2, 1, 'seed-a', '2026-03-09Z')",
      [unlockId, accounts[1]],
    );
    expect(unlock.rows[0]?.award_card_unlock).toBe(unlockId);
    expect(
      (
        await db.query(
          "select app_private.award_card_unlock($1, $2, 1, 'different', '2026-03-10Z')",
          [randomUUID(), accounts[1]],
        )
      ).rows,
    ).toEqual([{ award_card_unlock: unlockId }]);

    let contributorRows: unknown[] = [];
    for (let n = 0; n < 30 && contributorRows.length === 0; n += 1) {
      const { obligationId } = await addObligation(db);
      const offerId = await offer(db, obligationId, `unlock-${n}`);
      contributorRows = (
        await db.query(`select contributor.membership_id
          from app_private.offered_card_contributors contributor
          where contributor.offer_id = '${offerId}'`)
      ).rows;
      await db.exec(`update app_private.card_offers set status = 'replaced' where offer_id = '${offerId}';
        update app_private.consequence_obligations set status = 'completed', closed_at = '2026-03-10Z'
        where obligation_id = '${obligationId}';`);
    }
    expect(contributorRows).toEqual([{ membership_id: memberships[1] }]);
  });

  it("draws fair distinct snapshots and permits one disjoint redraw", async () => {
    const db = await database();
    const seen = new Set<string>();
    for (let n = 0; n < 48; n += 1) {
      const { obligationId } = await addObligation(db);
      const offerId = await offer(db, obligationId, `property-${n}`);
      const cards = await db.query<{ card_id: string }>(
        `select card_id from app_private.offered_cards where offer_id = '${offerId}'`,
      );
      expect(new Set(cards.rows.map((row) => row.card_id)).size).toBe(3);
      cards.rows.forEach((row) => {
        seen.add(row.card_id);
      });
      await db.exec(`update app_private.card_offers set status = 'replaced' where offer_id = '${offerId}';
        update app_private.consequence_obligations set status = 'completed', closed_at = '2026-03-10Z'
        where obligation_id = '${obligationId}';`);
    }
    expect(seen.size).toBe(6);

    const { obligationId } = await addObligation(db);
    const offerId = await offer(db, obligationId, "redraw-initial");
    await db.query("select app_private.redraw_card_offer($1, 'redraw-next')", [
      offerId,
    ]);
    const overlap = await db.query<{
      count: number;
    }>(`select count(*)::integer as count
      from app_private.offered_cards initial
      join app_private.offered_cards redraw using (offer_id, card_id)
      where initial.offer_id = '${offerId}' and initial.phase = 'initial' and redraw.phase = 'redraw'`);
    expect(overlap.rows).toEqual([{ count: 0 }]);
    await expect(
      db.query("select app_private.redraw_card_offer($1, 'again')", [offerId]),
    ).rejects.toThrow("initial Card offer required");
  });

  it("caps and deduplicates backlog, pauses safely, expires once, and reoffers original obligation", async () => {
    const db = await database();
    const obligations = [];
    for (let n = 0; n < 6; n += 1) obligations.push(await addObligation(db));
    expect(
      (
        await db.query(`select count(*)::integer as count from app_private.consequence_obligations
        where membership_id = '${memberships[0]}' and status = 'open'`)
      ).rows,
    ).toEqual([{ count: 5 }]);
    expect(
      (
        await db.query(
          "select app_private.add_consequence_obligation($1, $2, 'missed_target', $3, '2026-03-11Z')",
          [randomUUID(), memberships[0], obligations[0]?.sourceId],
        )
      ).rows,
    ).toEqual([{ add_consequence_obligation: obligations[0]?.obligationId }]);

    await db.exec(`update app_private.consequence_obligations set status = 'completed', closed_at = '2026-03-10Z'
      where obligation_id <> '${obligations[0]?.obligationId}'`);
    const offerId = await offer(db, obligations[0]?.obligationId ?? "");
    const selected = (
      await db.query<{
        card_id: string;
      }>(`select card_id from app_private.offered_cards
        where offer_id = '${offerId}' and phase = 'initial' order by position limit 1`)
    ).rows[0]?.card_id;
    const attemptId = randomUUID();
    await db.query(
      "select app_private.select_consequence_card($1, $2, $3, '2026-03-10Z')",
      [attemptId, offerId, selected],
    );
    await db.query(
      "select app_private.pause_consequence_for_safety($1, $2, '2026-03-10T01:00Z')",
      [randomUUID(), attemptId],
    );
    expect(
      (
        await db.query(
          "select app_private.expire_consequence_attempt($1, $2, '2026-03-20Z')",
          [attemptId, randomUUID()],
        )
      ).rows,
    ).toEqual([{ expire_consequence_attempt: null }]);
    await db.query(
      "select app_private.resume_consequence_from_safety($1, '2026-03-20Z')",
      [attemptId],
    );
    const replacementOffer = await offer(
      db,
      obligations[0]?.obligationId ?? "",
    );
    const replacementCard = (
      await db.query<{
        card_id: string;
      }>(`select card_id from app_private.offered_cards
        where offer_id = '${replacementOffer}' order by position limit 1`)
    ).rows[0]?.card_id;
    const replacementAttempt = randomUUID();
    const expiryObligation = randomUUID();
    await db.query(
      "select app_private.select_consequence_card($1, $2, $3, '2026-03-20Z')",
      [replacementAttempt, replacementOffer, replacementCard],
    );
    await db.query(
      "select app_private.expire_consequence_attempt($1, $2, '2026-03-22Z')",
      [replacementAttempt, expiryObligation],
    );
    await db.query(
      "select app_private.expire_consequence_attempt($1, $2, '2026-03-23Z')",
      [replacementAttempt, randomUUID()],
    );
    expect(
      (
        await db.query(`select count(*)::integer as count from app_private.consequence_obligations
        where membership_id = '${memberships[0]}' and status = 'open'`)
      ).rows,
    ).toEqual([{ count: 2 }]);
  });

  it("approves at threshold exactly once; rejection, timeout, and departure keep no extra obligation effect", async () => {
    const db = await database();
    const { obligationId } = await addObligation(db);
    const offerId = await offer(db, obligationId);
    const card = (
      await db.query<{
        card_id: string;
      }>(`select card_id from app_private.offered_cards
        where offer_id = '${offerId}' order by position limit 1`)
    ).rows[0]?.card_id;
    const attemptId = randomUUID();
    const claimId = randomUUID();
    await db.query(
      "select app_private.select_consequence_card($1, $2, $3, '2026-03-10Z')",
      [attemptId, offerId, card],
    );
    await db.query(
      "select app_private.submit_consequence_claim($1, $2, '2026-03-10T01:00Z', true, '2026-03-10T02:00Z')",
      [claimId, attemptId],
    );
    expect(
      (
        await db.query(
          "select app_private.respond_to_consequence_claim($1, $2, $3, 'approve', '2026-03-10T03:00Z')",
          [randomUUID(), claimId, memberships[1]],
        )
      ).rows,
    ).toEqual([{ respond_to_consequence_claim: "pending" }]);
    expect(
      (
        await db.query(
          "select app_private.respond_to_consequence_claim($1, $2, $3, 'approve', '2026-03-10T04:00Z')",
          [randomUUID(), claimId, memberships[2]],
        )
      ).rows,
    ).toEqual([{ respond_to_consequence_claim: "approved" }]);
    expect(
      (
        await db.query(
          "select app_private.finalize_consequence_claim($1, '2026-03-20Z')",
          [claimId],
        )
      ).rows,
    ).toEqual([{ finalize_consequence_claim: "approved" }]);
    expect(
      (
        await db.query(`select status from app_private.consequence_obligations
        where obligation_id = '${obligationId}'`)
      ).rows,
    ).toEqual([{ status: "completed" }]);

    const next = await addObligation(db, memberships[3]);
    const nextOffer = await offer(db, next.obligationId);
    const nextCard = (
      await db.query<{
        card_id: string;
      }>(`select card_id from app_private.offered_cards
        where offer_id = '${nextOffer}' order by position limit 1`)
    ).rows[0]?.card_id;
    const nextAttempt = randomUUID();
    const nextClaim = randomUUID();
    await db.query(
      "select app_private.select_consequence_card($1, $2, $3, '2026-03-10Z')",
      [nextAttempt, nextOffer, nextCard],
    );
    await db.query(
      "select app_private.submit_consequence_claim($1, $2, '2026-03-10T01:00Z', true, '2026-03-10T02:00Z')",
      [nextClaim, nextAttempt],
    );
    expect(
      (
        await db.query(
          "select app_private.finalize_consequence_claim($1, '2026-03-12T02:00Z')",
          [nextClaim],
        )
      ).rows,
    ).toEqual([{ finalize_consequence_claim: "timed_out" }]);
    expect(
      (
        await db.query(`select count(*)::integer as count from app_private.consequence_obligations
        where membership_id = '${memberships[3]}' and status = 'open'`)
      ).rows,
    ).toEqual([{ count: 1 }]);
    await db.exec(`update app_private.memberships set ended_at = '2026-03-13Z', end_reason = 'left'
      where membership_id = '${memberships[3]}'`);
    expect(
      (
        await db.query(`select status from app_private.consequence_obligations
        where obligation_id = '${next.obligationId}'`)
      ).rows,
    ).toEqual([{ status: "closed_on_departure" }]);
  });

  it("contains no Consequence media, video, description, or free-text column", async () => {
    const db = await database();
    const forbidden = await db.query(`select table_name, column_name
      from information_schema.columns where table_schema = 'app_private'
        and table_name like '%consequence%'
        and (column_name like '%video%' or column_name like '%media%'
          or column_name like '%description%' or column_name like '%text%')`);
    expect(forbidden.rows).toEqual([]);
    await db.exec("set role authenticated");
    await expect(
      db.query(
        "select app_private.add_consequence_obligation($1, $2, 'missed_target', $3, '2026-03-10Z')",
        [randomUUID(), memberships[0], randomUUID()],
      ),
    ).rejects.toThrow("permission denied");
  });
});
