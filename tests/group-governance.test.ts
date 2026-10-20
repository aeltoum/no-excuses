import { describe, expect, it } from "vitest";
import {
  as,
  data,
  database,
  group,
  memberships,
  rejects,
} from "./support/pwa-db.js";

type Settings = {
  name: string;
  timeZone: string;
  weekStarts: number;
  pendingTimeZone: string | null;
  pendingWeekStarts: number | null;
  admin: boolean;
};
type Activity = Array<{ kind: string; name: string; actor: string | null }>;

describe("Group governance", { timeout: 30_000 }, () => {
  it("lets a Group admin rename the Group and records it once", async () => {
    const db = await database();
    const renamed = await data<Settings>(
      db,
      0,
      "select app_private.rename_group('  Dawn Patrol ', '2026-03-03Z') as data",
    );
    expect(renamed).toMatchObject({ name: "Dawn Patrol", admin: true });
    await data(
      db,
      0,
      "select app_private.rename_group('Dawn Patrol', '2026-03-03T01:00Z') as data",
    );
    const activity = await data<Activity>(
      db,
      1,
      "select app_private.group_activity('2026-03-04Z') as data",
    );
    expect(activity.filter((event) => event.kind === "renamed")).toHaveLength(
      1,
    );
    await as(db, 1);
    expect(
      await rejects(
        db.query("select app_private.rename_group('Mine', '2026-03-03Z')"),
      ),
    ).toBe("42501");
    await as(db, 0);
    expect(
      await rejects(
        db.query("select app_private.rename_group('   ', '2026-03-03Z')"),
      ),
    ).toBe("22023");
  });

  it("promotes and demotes admins but always keeps one", async () => {
    const db = await database();
    await as(db, 0);
    await db.query(
      "select app_private.set_group_admin($1, true, '2026-03-03Z')",
      [memberships[1]],
    );
    // A second admin lets the first one leave; demoting yourself is not allowed.
    expect(
      await rejects(
        db.query(
          "select app_private.set_group_admin($1, false, '2026-03-03Z')",
          [memberships[0]],
        ),
      ),
    ).toBe("42501");
    await as(db, 1);
    await db.query(
      "select app_private.set_group_admin($1, false, '2026-03-03T01:00Z')",
      [memberships[0]],
    );
    const admins = await db.query<{ membership_id: string }>(
      "select membership_id from app_private.group_admins",
    );
    expect(admins.rows.map((row) => row.membership_id)).toEqual([
      memberships[1],
    ]);
    const activity = await data<Activity>(
      db,
      2,
      "select app_private.group_activity('2026-03-04Z') as data",
    );
    expect(activity.slice(0, 2)).toMatchObject([
      { kind: "admin_revoked", name: "Alex", actor: "Blair" },
      { kind: "admin_granted", name: "Blair", actor: "Alex" },
    ]);
  });

  it("applies a new start day and time zone when the current week closes", async () => {
    const db = await database();
    const pending = await data<Settings>(
      db,
      0,
      "select app_private.set_group_settings('America/Chicago', 3::smallint, '2026-03-04Z') as data",
    );
    expect(pending).toMatchObject({
      timeZone: "UTC",
      weekStarts: 1,
      pendingTimeZone: "America/Chicago",
      pendingWeekStarts: 3,
    });
    await db.query(
      "select app_private.advance_true_mvp_weeks('2026-03-09T01:00Z')",
    );
    const weeks = await db.query<{ starts_at: string; ends_at: string }>(
      "select starts_at::text, ends_at::text from app_private.accountability_weeks where group_id = $1 order by starts_at",
      [group],
    );
    // Mon Mar 9 to Wed Mar 11 is under three days, so the first week runs to Wed Mar 18.
    expect(weeks.rows.at(-1)).toEqual({
      starts_at: "2026-03-09 00:00:00+00",
      ends_at: "2026-03-18 05:00:00+00",
    });
    const applied = await data<Settings>(
      db,
      1,
      "select app_private.group_settings('2026-03-10Z') as data",
    );
    expect(applied).toMatchObject({
      timeZone: "America/Chicago",
      weekStarts: 3,
      pendingTimeZone: null,
      admin: false,
    });
  });

  it("shows only events from the viewer's own membership onward", async () => {
    const db = await database();
    await as(db, 0);
    await db.query("select app_private.rename_group('Early', '2026-03-03Z')");
    await db.query(
      "update app_private.memberships set joined_at = '2026-03-03T12:00Z' where membership_id = $1",
      [memberships[2]],
    );
    await as(db, 1);
    await db.query("select app_private.leave_group('2026-03-04Z')");
    const activity = await data<Activity>(
      db,
      2,
      "select app_private.group_activity('2026-03-05Z') as data",
    );
    expect(activity.map((event) => event.kind)).toEqual(["left", "joined"]);
  });
});
