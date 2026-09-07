import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("synthetic fixture vocabulary", () => {
  it("contains synthetic-only actors and stable scenario categories", async () => {
    const fixtureUrl = new URL("../fixtures/vocabulary.json", import.meta.url);
    const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")) as {
      dataPolicy: string;
      personas: Array<{ id: string }>;
      scenarioKinds: string[];
    };

    expect(fixtures.dataPolicy).toBe("synthetic-only");
    expect(fixtures.personas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fixtures.personas.map(({ id }) => id)).size).toBe(
      fixtures.personas.length,
    );
    expect(fixtures.scenarioKinds).toEqual(
      expect.arrayContaining([
        "happy-path",
        "boundary",
        "failure",
        "authorization",
      ]),
    );
  });
});
