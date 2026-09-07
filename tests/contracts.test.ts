import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "../packages/contracts/src/runtime.js";

describe("baseline wire compatibility", () => {
  it.each([0, 1])(
    "accepts supported contract version %i",
    (contractVersion) => {
      expect(
        healthResponseSchema.parse({ contractVersion, status: "ok" }),
      ).toEqual({
        contractVersion,
        status: "ok",
      });
    },
  );

  it("rejects an unknown future contract and extra data", () => {
    expect(() =>
      healthResponseSchema.parse({ contractVersion: 2, status: "ok" }),
    ).toThrow();
    expect(() =>
      healthResponseSchema.parse({
        contractVersion: 1,
        status: "ok",
        secret: "x",
      }),
    ).toThrow();
  });
});
