import { describe, expect, it } from "vitest";
import {
  accounts,
  as,
  data,
  database,
  memberWeeks,
  rejects,
} from "./support/pwa-db.js";

type Recap = Array<{
  memberWeekId: string;
  name: string;
  mine: boolean;
  met: boolean;
  completed: number;
  target: number;
  reactions: Array<{ emoji: string; count: number }>;
  myReaction: string | null;
}>;

describe("Week recap", { timeout: 30_000 }, () => {
  it("shows settled weeks for one day with any single emoji per member", async () => {
    const db = await database([2, 1, 1]);
    await db.query(
      "update app_private.member_weeks set status = 'missed' where member_week_id = $1",
      [memberWeeks[0]],
    );
    await db.query(
      "update app_private.member_weeks set status = 'attained' where member_week_id = $1",
      [memberWeeks[1]],
    );
    await db.query(
      "insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth, created_at) values ('https://push.example.test/a', $1, 'k', 'a', '2026-03-01Z')",
      [accounts[0]],
    );
    const react = (member: number, emoji: string | null, week = 0) =>
      data<{ recap: Recap }>(
        db,
        member,
        "select app_private.react_to_recap($1, $2, '2026-03-09T10:00Z') as data",
        [memberWeeks[week], emoji],
      );
    await react(1, "🫂");
    await react(2, "🤡");
    await react(2, "🫂");
    await react(0, "🔥", 1);
    const own = await react(0, "💪");
    // Met weeks lead; Casey's week is still open, so it is not shown.
    expect(own.recap).toMatchObject([
      {
        memberWeekId: memberWeeks[1],
        name: "Blair",
        met: true,
        reactions: [{ emoji: "🔥", count: 1 }],
        myReaction: "🔥",
      },
      {
        memberWeekId: memberWeeks[0],
        name: "Alex",
        mine: true,
        met: false,
        completed: 0,
        target: 2,
        reactions: [
          { emoji: "🫂", count: 2 },
          { emoji: "💪", count: 1 },
        ],
        myReaction: "💪",
      },
    ]);
    // Text is never a reaction.
    await as(db, 1);
    expect(
      await rejects(
        db.query(
          "select app_private.react_to_recap($1, 'lol', '2026-03-09T10:00Z')",
          [memberWeeks[0]],
        ),
      ),
    ).toBe("23514");

    await db.query(
      "select app_private.enqueue_missed_response_push('2026-03-09T10:01Z')",
    );
    const pushes = await db.query<{ title: string }>(
      "select title from app_private.web_push_outbox where account_id = $1 order by title",
      [accounts[0]],
    );
    expect(pushes.rows.map((row) => row.title)).toEqual([
      "Blair reacted 🫂",
      "Casey reacted 🫂",
    ]);

    // Gone the day after.
    const later = await data<{ recap: Recap }>(
      db,
      1,
      "select app_private.home_extras('2026-03-10T00:00Z') as data",
    );
    expect(later.recap).toEqual([]);
    await as(db, 1);
    expect(
      await rejects(
        db.query(
          "select app_private.react_to_recap($1, '🔥', '2026-03-10T00:00Z')",
          [memberWeeks[0]],
        ),
      ),
    ).toBe("42501");
  });
});
