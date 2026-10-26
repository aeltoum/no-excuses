import { describe, expect, it } from "vitest";
import { accounts, as, data, database, memberships } from "./support/pwa-db.js";

const at = "2026-03-05T10:00Z";

describe("Profile photos", { timeout: 30_000 }, () => {
  it("sets a photo from an owned avatar upload, shows it to the Group, and sweeps replaced ones", async () => {
    const db = await database();
    const first = await data<string>(
      db,
      0,
      "select app_private.create_proof_upload('avatar', $1) as data",
      [at],
    );
    await data(db, 0, "select app_private.set_avatar($1, $2) as data", [
      first,
      at,
    ]);
    // Another member can't claim someone else's upload.
    await expect(
      data(db, 1, "select app_private.set_avatar($1, $2) as data", [first, at]),
    ).rejects.toThrow("avatar upload unavailable");

    await as(db, 1);
    const seen = await db.query<{ membership_id: string; avatar_path: string }>(
      "select * from app_private.group_avatars($1)",
      [at],
    );
    expect(seen.rows).toEqual([
      { membership_id: memberships[0], avatar_path: first },
    ]);

    const second = await data<string>(
      db,
      0,
      "select app_private.create_proof_upload('avatar', $1) as data",
      [at],
    );
    await data(db, 0, "select app_private.set_avatar($1, $2) as data", [
      second,
      at,
    ]);
    const due = await db.query<{ path: string }>(
      "select path from app_private.proof_media_due('2026-03-07T00:00Z')",
    );
    expect(due.rows.map((row) => row.path)).toEqual([first]);

    // A deleted account's photo goes too.
    await db.query(
      "update app_private.accounts set status = 'deleted' where account_id = $1",
      [accounts[0]],
    );
    const afterDeletion = await db.query<{ path: string }>(
      "select path from app_private.proof_media_due('2026-03-07T00:00Z') order by path",
    );
    expect(afterDeletion.rows.map((row) => row.path).sort()).toEqual(
      [first, second].sort(),
    );
  });

  it("clears the notification list without changing delivery", async () => {
    const db = await database();
    await db.query(
      "insert into app_private.web_push_outbox (account_id, dedupe_key, title, body, created_at) values ($1, 'social:test', 'Hi', 'There', '2026-03-05T09:00Z')",
      [accounts[0]],
    );
    await data(db, 0, "select app_private.clear_notifications($1) as data", [
      at,
    ]);
    const center = await data<{ items: unknown[] }>(
      db,
      0,
      "select app_private.notification_center('2026-03-05T11:00Z') as data",
    );
    expect(center.items).toEqual([]);
  });
});
