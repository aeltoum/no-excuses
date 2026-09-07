import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const expectedRequirements = [
  "GOV-01",
  "GOV-02",
  "GOV-03",
  "GOV-04",
  "TIME-01",
  "TIME-02",
  "TARGET-01",
  "TARGET-02",
  "EXC-01",
  "WORK-01",
  "WORK-02",
  "WORK-03",
  "VERIFY-01",
  "VERIFY-02",
  "MISS-01",
  "CARD-01",
  "CARD-02",
  "CARD-03",
  "SAFE-01",
  "MEDIA-01",
  "MEDIA-02",
  "COMP-01",
  "COMP-02",
  "COMP-03",
  "SEASON-01",
  "SEASON-02",
  "SOCIAL-01",
  "NOTIFY-01",
  "NOTIFY-02",
  "ACCESS-01",
  "ACCESS-02",
  "ACCESS-03",
  "ACCESS-04",
  "OPS-01",
  "PILOT-01",
  "PILOT-02",
  "PILOT-03",
  "PILOT-04",
  "PILOT-05",
  "DIST-01",
];

describe("evidence ledger", () => {
  it("traces every requirement exactly once", async () => {
    const ledger = await readFile(
      new URL("../evidence/requirements.csv", import.meta.url),
      "utf8",
    );
    const ids = ledger
      .trim()
      .split("\n")
      .slice(1)
      .map((row) => row.split(",")[0]);
    expect(ids).toEqual(expectedRequirements);
    expect(new Set(ids).size).toBe(40);
  });
});
