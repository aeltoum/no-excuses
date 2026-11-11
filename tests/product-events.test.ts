import { describe, expect, it } from "vitest";
import { as, data, database, rejects } from "./support/pwa-db.js";

describe("Product events", { timeout: 30_000 }, () => {
  it("records allowed events, refuses unknown names, exports, and erases on deletion", async () => {
    const db = await database();
    const added = await data<number>(
      db,
      0,
      "select app_private.record_product_events($1::jsonb, '2026-03-04T10:00Z') as data",
      [
        JSON.stringify([
          { name: "app_opened", payload: { standalone: true } },
          { name: "log_submitted" },
        ]),
      ],
    );
    expect(added).toBe(2);
    await as(db, 0);
    expect(
      await rejects(
        db.query(
          "select app_private.record_product_events('[{\"name\":\"read_messages\"}]'::jsonb, '2026-03-04T10:00Z')",
        ),
      ),
    ).toBe("23514");
    const exported = await data<{ productEvents: Array<{ name: string }> }>(
      db,
      0,
      "select app_private.account_export('2026-03-04T11:00Z') as data",
    );
    expect(exported.productEvents.map((event) => event.name)).toEqual([
      "app_opened",
      "log_submitted",
    ]);
    await db.query(
      "update app_private.accounts set status = 'deleted' where account_id = (select account_id from app_private.product_events limit 1)",
    );
    const left = await db.query("select 1 from app_private.product_events");
    expect(left.rows).toHaveLength(0);
  });
});
