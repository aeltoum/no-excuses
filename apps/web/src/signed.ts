// Storage signed URLs expire (a day for proof and profile photos). An expired
// URL only gets a 400 from storage, so it is never requested.

// Expiry of a signed URL, read from its token; 0 when unknown.
export const urlExpiry = (url: string | null | undefined) => {
  try {
    const token = new URL(url ?? "").searchParams.get("token") ?? "";
    const payload = token.split(".")[1] ?? "";
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
};

// Valid for at least five more minutes.
export const usable = (url: string | null | undefined): url is string =>
  !!url && urlExpiry(url) > Date.now() + 5 * 60_000;

const path = (url: string) => url.split("?")[0];

// Asks the service worker for its cached copy only; it never goes to storage.
const cacheOnly = "cache-only";
const isCacheOnly = (url: string) => new URL(url).searchParams.has(cacheOnly);

// URLs whose image failed to load; the next fresh URL replaces them.
const failed = new Set<string>();
export const markFailed = (url: string) => failed.add(url);

// Each load re-signs URLs. A still-valid URL for the same file is kept so the
// browser reuses its cached image; otherwise the fresh one wins.
export const keepSigned = (
  old: string | null | undefined,
  fresh: string | null,
) =>
  old &&
  fresh &&
  path(old) === path(fresh) &&
  usable(old) &&
  !isCacheOnly(old) &&
  !failed.has(old)
    ? old
    : fresh;

// A saved URL shown before the fresh one arrives. Expired, it may still be in
// the service worker's photo cache: ask the cache alone, never storage. With
// no service worker in control, there is nothing to show until a fresh URL.
export const savedSigned = (url: string | null | undefined) => {
  if (!url || !url.includes("token=") || usable(url)) return url ?? null;
  if (!navigator.serviceWorker?.controller) return null;
  const next = new URL(url);
  next.searchParams.set(cacheOnly, "1");
  return next.toString();
};
