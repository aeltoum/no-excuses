import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "../packages/contracts/src/runtime.js";

describe("baseline wire compatibility", () => {
  it("publishes the versioned health entrypoint while retaining the baseline entrypoint", async () => {
    const source = await readFile(
      new URL("../packages/contracts/openapi.yaml", import.meta.url),
      "utf8",
    );
    expect(source).toContain("  /health:");
    expect(source).toContain("  /v1/health:");
  });

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
