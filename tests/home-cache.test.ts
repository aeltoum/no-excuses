import { describe, expect, it } from "vitest";
import {
  readCachedHome,
  writeCachedHome,
} from "../apps/mobile/src/home-cache.js";
import type { MemberHomeResult } from "../packages/contracts/src/index.js";

const home: MemberHomeResult = {
  membershipId: "10000000-0000-4000-8000-000000000001",
  groupId: "20000000-0000-4000-8000-000000000001",
  accountabilityWeekId: null,
  weekStatus: null,
  lockedTarget: 3,
  completedWorkoutCount: 1,
  needsYouCount: 2,
  friendActivity: [],
  seasonStandings: [],
  rebuiltAt: "2026-09-11T12:00:00Z",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("M7 member Home cache", () => {
  it("round trips valid contract data within its Account", async () => {
    const storage = memoryStorage();
    await writeCachedHome(
      storage,
      "account-a",
      home,
      "2026-09-11T12:30:00.000Z",
    );

    await expect(readCachedHome(storage, "account-a")).resolves.toEqual({
      cachedAt: "2026-09-11T12:30:00.000Z",
      value: home,
    });
    await expect(readCachedHome(storage, "account-b")).resolves.toBeUndefined();
    expect([...storage.values.keys()]).toEqual(["no-excuses:home:account-a"]);
    expect(
      JSON.parse(storage.values.get("no-excuses:home:account-a") ?? ""),
    ).toEqual({ cachedAt: "2026-09-11T12:30:00.000Z", value: home });
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "invalid contract payload",
      JSON.stringify({ cachedAt: "2026-09-11T12:30:00.000Z", value: {} }),
    ],
    [
      "invalid saved instant",
      JSON.stringify({ cachedAt: "not-an-instant", value: home }),
    ],
    [
      "noncanonical parseable date",
      JSON.stringify({ cachedAt: "2026-09-11", value: home }),
    ],
    [
      "non-UTC parseable instant",
      JSON.stringify({ cachedAt: "2026-09-11T07:30:00-05:00", value: home }),
    ],
  ])("removes %s", async (_label, serialized) => {
    const storage = memoryStorage();
    storage.values.set("no-excuses:home:account-a", serialized);

    await expect(readCachedHome(storage, "account-a")).resolves.toBeUndefined();
    expect(storage.values.has("no-excuses:home:account-a")).toBe(false);
  });

  it("treats unavailable storage and cleanup failure as a cache miss", async () => {
    const storage = {
      async getItem() {
        throw new Error("storage unavailable");
      },
      async setItem() {
        throw new Error("storage unavailable");
      },
      async removeItem() {
        throw new Error("storage unavailable");
      },
    };

    await expect(readCachedHome(storage, "account-a")).resolves.toBeUndefined();
    await expect(
      writeCachedHome(storage, "account-a", home, "2026-09-11T12:30:00.000Z"),
    ).rejects.toThrow("storage unavailable");
  });
});
