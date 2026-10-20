import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { as, data, database, rejects, submitProof } from "./support/pwa-db.js";

describe("Timed Workout sessions", { timeout: 30_000 }, () => {
  it("starts one session, shows it on Home, ends it, and links one post", async () => {
    const db = await database();
    const id = randomUUID();
    const started = await data<{ id: string; startedAt: string }>(
      db,
      0,
      "select app_private.start_my_session($1, '2026-03-05T09:00Z') as data",
      [id],
    );
    expect(started.id).toBe(id);
    // A retry returns the same session; a second one is refused.
    await data(
      db,
      0,
      "select app_private.start_my_session($1, '2026-03-05T09:01Z') as data",
      [id],
    );
    expect(
      await rejects(
        db.query(
          "select app_private.start_my_session($1, '2026-03-05T09:02Z')",
          [randomUUID()],
        ),
      ),
    ).toBe("23505");
    const home = await data<{ session: { id: string } | null }>(
      db,
      0,
      "select app_private.home_extras('2026-03-05T09:30Z') as data",
    );
    expect(home.session?.id).toBe(id);
    const ended = await data<{ status: string }>(
      db,
      0,
      "select app_private.end_my_session($1, '2026-03-05T09:50Z') as data",
      [id],
    );
    expect(ended.status).toBe("ended");
    const post = await submitProof(db, 0, "2026-03-05T09:55Z");
    await as(db, 0);
    await db.query(
      "select app_private.link_session_checkin($1, $2, '2026-03-05T09:56Z')",
      [id, post],
    );
    const other = await submitProof(db, 0, "2026-03-05T10:00Z");
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.link_session_checkin($1, $2, '2026-03-05T10:01Z')",
          [id, other],
        ),
      ),
    ).toBe("23505");
  });

  it("ends sessions after 12 hours", async () => {
    const db = await database();
    const id = randomUUID();
    await data(
      db,
      0,
      "select app_private.start_my_session($1, '2026-03-05T09:00Z') as data",
      [id],
    );
    const home = await data<{ session: unknown }>(
      db,
      0,
      "select app_private.home_extras('2026-03-05T21:30Z') as data",
    );
    expect(home.session).toBeNull();
    const ended = await data<{ status: string }>(
      db,
      0,
      "select app_private.end_my_session($1, '2026-03-05T22:00Z') as data",
      [id],
    );
    expect(ended.status).toBe("expired");
  });
});
