import type { Locator, Page, Route } from "@playwright/test";

// Holds matching requests for `ms` before the earlier mocks answer them; resolves to an undo.
export async function delayRoute(page: Page, url: string, ms: number) {
  const handler = async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  };
  await page.route(url, handler);
  return () => page.unroute(url, handler);
}

type Probe = {
  start?: number;
  shown: WeakMap<Node, number>;
  stop: () => void;
};
declare global {
  interface Window {
    __timingProbe?: Probe;
  }
}

// Milliseconds, on the page clock, from the action's first trusted pointerdown or keydown to the
// next animation frame callback after `target`'s content entered the DOM. A page-side observer stamps
// each insertion at its next frame, so Playwright's polling and round trips are not counted.
export async function msUntilVisible(
  page: Page,
  action: () => Promise<unknown>,
  target: Locator,
) {
  await page.evaluate(() => {
    window.__timingProbe?.stop();
    const shown = new WeakMap<Node, number>();
    let batch: Node[] = [];
    const observer = new MutationObserver((records) => {
      if (batch.length === 0)
        requestAnimationFrame(() => {
          const frame = performance.now();
          for (const node of batch)
            if (!shown.has(node)) shown.set(node, frame);
          batch = [];
        });
      for (const record of records)
        batch.push(record.target, ...record.addedNodes);
    });
    const mark = (event: Event) => {
      if (event.isTrusted && probe.start === undefined)
        probe.start = event.timeStamp;
    };
    const probe: Probe = {
      shown,
      stop: () => {
        observer.disconnect();
        removeEventListener("pointerdown", mark, true);
        removeEventListener("keydown", mark, true);
      },
    };
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    addEventListener("pointerdown", mark, true);
    addEventListener("keydown", mark, true);
    window.__timingProbe = probe;
  });
  await action();
  await target.waitFor({ state: "visible" });
  // Wait one frame so the insertion's stamp is written, then read it.
  return target.evaluate(
    (element) =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const probe = window.__timingProbe;
          probe?.stop();
          if (probe?.start === undefined) return resolve(Number.NaN);
          // The latest stamp on the element, its nearest stamped ancestor, or its contents.
          let stamp: number | undefined;
          for (let node: Node | null = element; node; node = node.parentNode) {
            stamp = probe.shown.get(node);
            if (stamp !== undefined) break;
          }
          const walker = document.createTreeWalker(element);
          for (
            let node: Node | null = walker.nextNode();
            node;
            node = walker.nextNode()
          ) {
            const inner = probe.shown.get(node);
            if (inner !== undefined) stamp = Math.max(stamp ?? inner, inner);
          }
          resolve(stamp === undefined ? Number.NaN : stamp - probe.start);
        }),
      ),
  );
}
