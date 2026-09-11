import {
  type NotificationCenterResult,
  notificationCenterResultSchema,
} from "@no-excuses/contracts";

export type NotificationCacheStorage = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>;

type CachedNotifications = Readonly<{
  cachedAt: string;
  value: NotificationCenterResult;
}>;

function cacheKey(accountId: string): string {
  return `no-excuses:notifications:${accountId}`;
}

export async function readCachedNotifications(
  storage: NotificationCacheStorage,
  accountId: string,
): Promise<CachedNotifications | undefined> {
  const key = cacheKey(accountId);
  try {
    const serialized = await storage.getItem(key);
    if (serialized === null) return undefined;
    const candidate: unknown = JSON.parse(serialized);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("cachedAt" in candidate) ||
      typeof candidate.cachedAt !== "string" ||
      !("value" in candidate)
    ) {
      throw new Error("invalid_notification_cache");
    }
    const value = notificationCenterResultSchema.safeParse(candidate.value);
    if (!value.success || Number.isNaN(Date.parse(candidate.cachedAt))) {
      throw new Error("invalid_notification_cache");
    }
    return { cachedAt: candidate.cachedAt, value: value.data };
  } catch {
    await storage.removeItem(key).catch(() => undefined);
    return undefined;
  }
}

export async function writeCachedNotifications(
  storage: NotificationCacheStorage,
  accountId: string,
  value: NotificationCenterResult,
  cachedAt: string,
): Promise<void> {
  await storage.setItem(
    cacheKey(accountId),
    JSON.stringify({ cachedAt, value }),
  );
}
