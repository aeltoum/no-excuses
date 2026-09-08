import { describe, expect, it } from "vitest";
import {
  aggregateVersion,
  groupZoneFact,
  opaqueId,
  utcInstant,
} from "../packages/shared-kernel/src/index.js";

describe("shared kernel primitives", () => {
  it("validates opaque identifiers, UTC instants, and persisted Group zones", () => {
    expect(
      opaqueId("group", "018f63c2-7d33-7f54-9fa7-9f55d735ae35"),
    ).toBeTruthy();
    expect(() => opaqueId("group", "group-1")).toThrow("UUID");

    const recordedAt = utcInstant("2026-09-07T12:34:56.000Z");
    expect(groupZoneFact("America/Chicago", recordedAt)).toEqual({
      timeZone: "America/Chicago",
      recordedAt,
    });
    expect(() => utcInstant("2026-09-07T12:34:56-05:00")).toThrow(
      "ending in Z",
    );
    expect(() => groupZoneFact("Central-ish", recordedAt)).toThrow("IANA");
  });

  it("accepts only non-negative safe aggregate versions", () => {
    expect(aggregateVersion(0)).toBe(0);
    expect(() => aggregateVersion(-1)).toThrow();
    expect(() => aggregateVersion(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
