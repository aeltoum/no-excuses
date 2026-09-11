import {
  type MemberHomeResult,
  memberHomeResultSchema,
} from "@no-excuses/contracts";

export type HomeCacheStorage = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>;

type CachedHome = Readonly<{
  cachedAt: string;
  value: MemberHomeResult;
}>;

function cacheKey(accountId: string): string {
  return `no-excuses:home:${accountId}`;
}

export async function readCachedHome(
  storage: HomeCacheStorage,
  accountId: string,
): Promise<CachedHome | undefined> {
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
      throw new Error("invalid_home_cache");
    }
    const value = memberHomeResultSchema.safeParse(candidate.value);
    const cachedTime = Date.parse(candidate.cachedAt);
    if (
      !value.success ||
      Number.isNaN(cachedTime) ||
      new Date(cachedTime).toISOString() !== candidate.cachedAt
    ) {
      throw new Error("invalid_home_cache");
    }
    return { cachedAt: candidate.cachedAt, value: value.data };
  } catch {
    await storage.removeItem(key).catch(() => undefined);
    return undefined;
  }
}

export async function writeCachedHome(
  storage: HomeCacheStorage,
  accountId: string,
  value: MemberHomeResult,
  cachedAt: string,
): Promise<void> {
  await storage.setItem(
    cacheKey(accountId),
    JSON.stringify({ cachedAt, value }),
  );
}
