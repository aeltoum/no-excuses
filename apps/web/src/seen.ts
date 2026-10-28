// Seen posts: a post the member has looked at for 1s with its photo loaded. Marks show at
// once, wait in a persisted queue, and flush every few seconds and when the page hides.
// A failed flush keeps the queue for the next one; a mark never rolls back.
import { useEffect, useSyncExternalStore } from "react";
import { onClearPersisted, persistentMap } from "./persist";
import { currentToken } from "./proof";

const queue = persistentMap<string[]>("seen-queue");
// Marks already sent this session, so a feed loaded before the server stored them stays seen.
const sent = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
onClearPersisted(() => {
  sent.clear();
  version += 1;
  for (const listener of listeners) listener();
});

export const flushMs = 3_000;
export const dwellMs = 1_000;
const batch = 100;

export function isSeen(
  cacheKey: string,
  item: { workoutCheckinId: string; mine: boolean; seen?: boolean },
) {
  const id = item.workoutCheckinId;
  return (
    item.mine ||
    item.seen === true ||
    sent.has(`${cacheKey}:${id}`) ||
    (queue.get(cacheKey)?.includes(id) ?? false)
  );
}

export function markSeen(cacheKey: string, id: string) {
  const pending = queue.get(cacheKey) ?? [];
  if (pending.includes(id) || sent.has(`${cacheKey}:${id}`)) return;
  queue.set(cacheKey, [...pending, id]);
  version += 1;
  for (const listener of listeners) listener();
}

// Re-renders the caller whenever a mark is added.
export const useSeenVersion = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );

const flying = new Set<string>();
async function flush(apiBaseUrl: string, token: string, cacheKey: string) {
  const ids = (queue.get(cacheKey) ?? []).slice(0, batch);
  if (ids.length === 0 || flying.has(cacheKey)) return;
  flying.add(cacheKey);
  try {
    const response = await fetch(`${apiBaseUrl}/v1/proof/seen`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await currentToken(token)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids }),
      // Lets a flush started on pagehide finish after the page goes.
      keepalive: true,
    });
    if (!response.ok) return;
    for (const id of ids) sent.add(`${cacheKey}:${id}`);
    const rest = (queue.get(cacheKey) ?? []).filter((id) => !ids.includes(id));
    if (rest.length > 0) queue.set(cacheKey, rest);
    else queue.delete(cacheKey);
  } catch {
    // Offline or failed: the queue waits for the next flush.
  } finally {
    flying.delete(cacheKey);
  }
}

export function useSeenFlush(
  apiBaseUrl: string,
  token: string,
  cacheKey: string,
) {
  useEffect(() => {
    const send = () => void flush(apiBaseUrl, token, cacheKey);
    const onHide = () => {
      if (document.visibilityState === "hidden") send();
    };
    const timer = setInterval(send, flushMs);
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", send);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", send);
    };
  }, [apiBaseUrl, token, cacheKey]);
}

// Watches elements carrying data-unseen. One counts as seen once at least half of it has
// been on screen for dwellMs with its photo loaded; scrolling past sooner restarts the wait.
export function useSeenWatch(onSeen: (id: string) => void) {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const watched = new Map<
      Element,
      { visible: boolean; timer?: ReturnType<typeof setTimeout> }
    >();
    const photoReady = (node: Element) => {
      const image = node.querySelector("img");
      return image ? image.complete && image.naturalWidth > 0 : false;
    };
    // Only a shown page counts, and while a modal is open only posts inside the top one:
    // the observer ignores overlays covering the tiles behind them.
    const allowed = (node: Element) => {
      if (document.visibilityState !== "visible") return false;
      // The topmost modal (viewer, sheet, any aria-modal dialog) decides; DOM order is
      // stacking order here, since modals render after the content they cover.
      const top = [
        ...document.querySelectorAll(
          '.post-viewer, .sheet-layer, [aria-modal="true"]',
        ),
      ].at(-1);
      return !top || top.contains(node);
    };
    const check = (node: Element) => {
      const state = watched.get(node);
      if (!state) return;
      if (!state.visible || !photoReady(node) || !allowed(node)) {
        clearTimeout(state.timer);
        state.timer = undefined;
        return;
      }
      state.timer ??= setTimeout(() => {
        const id = (node as HTMLElement).dataset.unseen;
        if (
          node.isConnected &&
          state.visible &&
          photoReady(node) &&
          allowed(node) &&
          id
        ) {
          release(node);
          onSeen(id);
        }
      }, dwellMs);
    };
    const onLoad = (event: Event) => {
      const node = (event.target as Element).closest("[data-unseen]");
      if (node) check(node);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const state = watched.get(entry.target);
          if (!state) continue;
          state.visible = entry.isIntersecting;
          check(entry.target);
        }
      },
      { threshold: 0.5 },
    );
    const release = (node: Element) => {
      clearTimeout(watched.get(node)?.timer);
      watched.delete(node);
      observer.unobserve(node);
      node.removeEventListener("load", onLoad, true);
    };
    const scan = () => {
      for (const node of watched.keys())
        if (!node.isConnected || !(node as HTMLElement).dataset.unseen)
          release(node);
      for (const node of document.querySelectorAll("[data-unseen]")) {
        if (watched.has(node)) continue;
        watched.set(node, { visible: false });
        node.addEventListener("load", onLoad, true);
        observer.observe(node);
      }
      // The viewer opening or closing changes which posts may count.
      for (const node of watched.keys()) check(node);
    };
    const recheck = () => {
      for (const node of watched.keys()) check(node);
    };
    document.addEventListener("visibilitychange", recheck);
    scan();
    const mutations = new MutationObserver(scan);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-unseen"],
    });
    return () => {
      mutations.disconnect();
      document.removeEventListener("visibilitychange", recheck);
      observer.disconnect();
      for (const node of [...watched.keys()]) release(node);
    };
  }, [onSeen]);
}
