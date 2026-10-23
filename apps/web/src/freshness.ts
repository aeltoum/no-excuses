import { useSyncExternalStore } from "react";

// A counter that moves when screens should reload in the background: the app
// comes back to the foreground or online, or a minute passes on screen. Loaders
// list it as a dependency, so friends' activity shows up without a reload.
export const pollMs = 60_000;
// Focus and online can fire in bursts; one reload covers them.
const settleMs = 10_000;

let tick = 0;
let last = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();

// The minute restarts at every reload, so a focus just before it never stretches the gap.
const schedule = () => {
  window.clearInterval(timer);
  timer = window.setInterval(onWake, pollMs);
};
const bump = () => {
  last = Date.now();
  schedule();
  tick++;
  for (const listener of listeners) listener();
};
const visible = () => document.visibilityState === "visible";
const onVisibility = () => {
  // Returning from the background always reloads; the phone may have slept for hours.
  if (visible()) bump();
};
const onWake = () => {
  if (visible() && Date.now() - last >= settleMs) bump();
};

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    last = Date.now();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    schedule();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
    window.clearInterval(timer);
  };
}

export const useFreshness = () => useSyncExternalStore(subscribe, () => tick);
