import { describe, expect, it } from "vitest";
import {
  accounts,
  as,
  data,
  database,
  memberWeeks,
  rejects,
} from "./support/pwa-db.js";

type Missed = Array<{
  memberWeekId: string;
  name: string;
  mine: boolean;
  completed: number;
  target: number;
  responses: Array<{ response: string; count: number }>;
  myResponse: string | null;
}>;

describe("Missed-week responses", { timeout: 30_000 }, () => {
  it("shows a missed week to the crew for five days with changeable preset responses", async () => {
    const db = await database([2, 1, 1]);
    await db.query(
      "update app_private.member_weeks set status = 'missed' where member_week_id = $1",
      [memberWeeks[0]],
    );
    await db.query(
      "insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth, created_at) values ('https://push.example.test/a', $1, 'k', 'a', '2026-03-01Z')",
      [accounts[0]],
    );
    const respond = (member: number, response: string | null) =>
      data<{ missed: Missed }>(
        db,
        member,
        "select app_private.respond_to_missed_week($1, $2, '2026-03-09T10:00Z') as data",
        [memberWeeks[0], response],
      );
    await respond(1, "got_you");
    await respond(2, "no_excuses");
    await respond(2, "got_you");
    const own = await respond(0, "next_week");
    expect(own.missed).toMatchObject([
      {
        memberWeekId: memberWeeks[0],
        name: "Alex",
        mine: true,
        completed: 0,
        target: 2,
        responses: [
          { response: "got_you", count: 2 },
          { response: "next_week", count: 1 },
        ],
        myResponse: "next_week",
      },
    ]);
    await db.query(
      "select app_private.enqueue_missed_response_push('2026-03-09T10:01Z')",
    );
    const pushes = await db.query<{ title: string }>(
      "select title from app_private.web_push_outbox where account_id = $1 order by title",
      [accounts[0]],
    );
    expect(pushes.rows.map((row) => row.title)).toEqual([
      "Blair has your back",
      "Casey has your back",
    ]);

    const later = await data<{ missed: Missed }>(
      db,
      1,
      "select app_private.home_extras('2026-03-14T01:00Z') as data",
    );
    expect(later.missed).toEqual([]);
    await as(db, 1);
    expect(
      await rejects(
        db.query(
          "select app_private.respond_to_missed_week($1, 'got_you', '2026-03-14T01:00Z')",
          [memberWeeks[0]],
        ),
      ),
    ).toBe("42501");
  });
});
