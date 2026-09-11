import { describe, expect, it } from "vitest";
import {
  readCachedNotifications,
  writeCachedNotifications,
} from "../apps/mobile/src/notification-cache.js";

function memoryStorage(initial?: Readonly<Record<string, string>>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
}

const emptyCenter = { unread: [], read: [] };

describe("notification offline cache", () => {
  it("round-trips contract-valid data in an account-scoped key", async () => {
    const storage = memoryStorage();
    await writeCachedNotifications(
      storage,
      "account-a",
      emptyCenter,
      "2026-09-10T12:00:00.000Z",
    );

    await expect(
      readCachedNotifications(storage, "account-a"),
    ).resolves.toEqual({
      cachedAt: "2026-09-10T12:00:00.000Z",
      value: emptyCenter,
    });
    await expect(
      readCachedNotifications(storage, "account-b"),
    ).resolves.toBeUndefined();
  });

  it("removes malformed or contract-invalid cache entries", async () => {
    const key = "no-excuses:notifications:account-a";
    const storage = memoryStorage({
      [key]: JSON.stringify({
        cachedAt: "not-an-instant",
        value: { unread: "private payload", read: [] },
      }),
    });

    await expect(
      readCachedNotifications(storage, "account-a"),
    ).resolves.toBeUndefined();
    expect(storage.values.has(key)).toBe(false);
  });

  it("treats unavailable device storage as a cache miss", async () => {
    const storage = {
      getItem: async (_key: string): Promise<string | null> => {
        throw new Error("storage unavailable");
      },
      setItem: async (_key: string, _value: string) => undefined,
      removeItem: async (_key: string) => {
        throw new Error("storage unavailable");
      },
    };

    await expect(
      readCachedNotifications(storage, "account-a"),
    ).resolves.toBeUndefined();
  });
});
