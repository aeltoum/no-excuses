import { describe, expect, it } from "vitest";
import { FakeActivityAggregateSource } from "../apps/mobile/src/activity-source.js";

describe("activity aggregate source", () => {
  it("returns immutable exact-interval aggregates deterministically", async () => {
    const interval = {
      startsAt: "2026-03-02T12:00:00Z",
      endsAt: "2026-03-09T00:00:00Z",
    };
    const source = new FakeActivityAggregateSource("healthkit", "granted", [
      {
        platform: "healthkit",
        permission: "granted",
        sourceState: "connected",
        interval,
        completeness: "complete",
        aggregate: { kind: "steps", steps: 12_349 },
      },
    ]);

    expect(await source.permission()).toBe("granted");
    expect(await source.read(interval)).toEqual(
      await source.read({ ...interval }),
    );
    expect(Object.isFrozen(await source.read(interval))).toBe(true);
  });

  it("represents absent data as partial and null, never zero", async () => {
    const source = new FakeActivityAggregateSource(
      "health_connect",
      "limited",
      [],
    );
    expect(
      await source.read({
        startsAt: "2026-03-02T00:00:00Z",
        endsAt: "2026-03-09T00:00:00Z",
      }),
    ).toMatchObject({
      permission: "limited",
      completeness: "partial",
      aggregate: null,
    });
  });

  it.each([
    ["not_requested", "disconnected"],
    ["denied", "disconnected"],
    ["granted", "changed"],
  ] as const)(
    "preserves %s permission and %s source state",
    async (permission, sourceState) => {
      const interval = {
        startsAt: "2026-03-02T00:00:00Z",
        endsAt: "2026-03-09T00:00:00Z",
      };
      const source = new FakeActivityAggregateSource("healthkit", permission, [
        {
          platform: "healthkit",
          permission,
          sourceState,
          interval,
          completeness: "partial",
          aggregate: null,
        },
      ]);
      expect(await source.read(interval)).toMatchObject({
        permission,
        sourceState,
      });
    },
  );
});
