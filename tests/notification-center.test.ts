import { describe, expect, it } from "vitest";
import {
  accounts,
  as,
  data,
  database,
  memberships,
  submitProof,
} from "./support/pwa-db.js";

type Center = {
  items: Array<{ title: string; unread: boolean; kind: string }>;
  prefs: { socialPush: boolean; digest: boolean; digestHour: number };
};

describe("Notification center", { timeout: 30_000 }, () => {
  it("lists notifications without a device, tracks unread, and mutes social pushes only", async () => {
    const db = await database();
    await db.query(
      "update app_private.accounts set notifications_since = '2026-03-01Z'",
    );
    await submitProof(db, 1);
    await db.query(
      "select app_private.enqueue_push_notifications('2026-03-05T10:05Z')",
    );
    // Rows default to the real clock; put this one on the test's clock.
    await db.query(
      "update app_private.web_push_outbox set created_at = '2026-03-05T10:05Z'",
    );
    await as(db, 2);
    await db.query("select app_private.nudge_member($1, '2026-03-05T11:00Z')", [
      memberships[0],
    ]);
    await db.query(
      "select app_private.enqueue_social_push('2026-03-05T11:01Z')",
    );

    const center = await data<Center>(
      db,
      0,
      "select app_private.notification_center('2026-03-05T12:00Z') as data",
    );
    expect(
      center.items.map(({ title, unread, kind }) => ({ title, unread, kind })),
    ).toEqual([
      { title: "Casey nudged you", unread: true, kind: "social" },
      { title: "Blair logged a workout", unread: true, kind: "workout" },
    ]);
    expect(center.prefs).toEqual({
      socialPush: true,
      digest: true,
      digestHour: 19,
    });
    await data(
      db,
      0,
      "select app_private.mark_notifications_seen('2026-03-05T12:00Z') as data",
    );
    const extras = await data<{ unreadNotifications: number }>(
      db,
      0,
      "select app_private.home_extras('2026-03-05T12:30Z') as data",
    );
    expect(extras.unreadNotifications).toBe(0);

    // Muted: the device skips social items; the app keeps them.
    await db.query(
      "insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth, created_at) values ('https://push.example.test/a', $1, 'k', 'a', '2026-03-01Z')",
      [accounts[0]],
    );
    await data(
      db,
      0,
      "select app_private.set_notification_prefs(false, null, null) as data",
    );
    const pending = await db.query<{ title: string; muted: boolean }>(
      "select title, muted from app_private.pending_push(10) order by outbox_id",
    );
    expect(pending.rows).toEqual([
      { title: "Blair logged a workout", muted: false },
      { title: "Casey nudged you", muted: true },
    ]);
  });

  it("sends one digest at the chosen local hour when something happened", async () => {
    const db = await database();
    await submitProof(db, 1, "2026-03-05T10:00Z");
    await as(db, 0);
    await db.query(
      "select app_private.set_notification_prefs(null, true, 18::smallint)",
    );
    for (const at of [
      "2026-03-05T17:30Z",
      "2026-03-05T18:10Z",
      "2026-03-05T18:50Z",
    ])
      await db.query("select app_private.enqueue_digest($1)", [at]);
    const digests = await db.query<{
      account_id: string;
      title: string;
      body: string;
    }>(
      "select account_id, title, body from app_private.web_push_outbox where dedupe_key like 'digest:%' order by account_id",
    );
    // Blair's own post is not news to Blair; Casey's hour (19) has not come yet.
    expect(digests.rows).toEqual([
      {
        account_id: accounts[0],
        title: "Today in Friends",
        body: "1 workout from your crew",
      },
    ]);
  });
});
