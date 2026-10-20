import emojiData from "emoji-picker-element-data/en/emojibase/data.json?url";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ReactionCount, type Reactor, reactionLimit } from "./proof";
import { Sheet } from "./Sheet";

// Quick picks drawn from the gym floor; the full picker below searches every emoji.
export const quickPicks = [
  "💪",
  "🔥",
  "👏",
  "🏋️",
  "😤",
  "🫡",
  "⚡",
  "👑",
  "🦍",
  "🐐",
  "🥵",
  "💯",
];

// Line icons replace the picker's color-emoji category tabs; keyed by emojibase group id.
const categoryIcons: Record<number, string> = {
  0: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5a5 5 0 0 0 8 0M9 9.5v.5M15 9.5v.5"/>',
  1: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  3: '<path d="M12 21c-5 0-8-4-8-9 4 0 8 3 8 9Zm0 0c5 0 8-4 8-9-4 0-8 3-8 9Zm0 0V9"/><path d="M9 4.5 12 7l3-2.5"/>',
  4: '<path d="M12 7c-2-1.5-7-1-7 5 0 5 3 9 5 9 1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-4 5-9 0-6-5-6.5-7-5Zm0 0c0-2 1-4 3-4"/>',
  5: '<path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5"/>',
  6: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5c5 1 12 1 17 0M3.5 14.5c5-1 12-1 17 0M12 3c-3 5-3 13 0 18"/>',
  7: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.4.4.5.9.5 1.4V16h6v-.7c0-.5.1-1 .5-1.4A6 6 0 0 0 12 3Z"/>',
  8: '<path d="M10 3 8 21M16 3l-2 18M4 8.5h16M3.5 15.5h16"/>',
  9: '<path d="M5 21V4m0 0h12l-2.5 4 2.5 4H5"/>',
};
const iconMask = (paths: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
  )}")`;
// The picker exposes no hook for tab icons or touch gestures, so a small style goes into its shadow root.
const pickerStyle = `
.nav-button { color: var(--muted); }
.nav-button[aria-selected="true"] { color: var(--ink); }
.nav-emoji { display: none; }
.nav-button::before {
  content: "";
  width: var(--total-category-emoji-size);
  height: var(--total-category-emoji-size);
  background: currentColor;
  mask: center / 1.25rem no-repeat;
}
${Object.entries(categoryIcons)
  .map(
    ([id, paths]) =>
      `.nav-button[data-group-id="${id}"]::before { mask-image: ${iconMask(paths)}; }`,
  )
  .join("\n")}
.tabpanel { touch-action: pan-y; }`;
// A mostly-horizontal drag across the grid moves one category tab, like tapping it.
const swipeDistance = 48;
function swipeCategories(picker: HTMLElement) {
  let start: { x: number; y: number } | undefined;
  picker.addEventListener("pointerdown", (event) => {
    const overGrid = event
      .composedPath()
      .some((node) => node instanceof Element && node.matches(".tabpanel"));
    start = overGrid ? { x: event.clientX, y: event.clientY } : undefined;
  });
  picker.addEventListener("pointercancel", () => {
    start = undefined;
  });
  picker.addEventListener("pointerup", (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) < swipeDistance || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const tabs = [
      ...(picker.shadowRoot?.querySelectorAll<HTMLElement>(".nav-button") ??
        []),
    ];
    // No tab is selected while search results show.
    const current = tabs.findIndex(
      (tab) => tab.getAttribute("aria-selected") === "true",
    );
    if (current < 0) return;
    tabs[current + (dx < 0 ? 1 : -1)]?.click();
  });
}

type Props = {
  reactions: ReactionCount[];
  mine: string[];
  // The author sees counts only.
  readOnly: boolean;
  onToggle: (emoji: string, on: boolean) => void;
  loadReactors: () => Promise<Reactor[]>;
  cachedReactors: () => Reactor[] | undefined;
};

type Who =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: Reactor[] };

// Like Discord: tabs per emoji, then who reacted with the chosen one.
function ReactorsSheet({
  reactions,
  mine,
  readOnly,
  selected,
  onSelect,
  onToggle,
  loadReactors,
  cachedReactors,
  onDismiss,
}: Props & {
  selected: string | null;
  onSelect: (emoji: string) => void;
  onDismiss: () => void;
}) {
  const [who, setWho] = useState<Who>({ status: "loading" });
  const request = useRef(0);
  const loadRef = useRef(loadReactors);
  loadRef.current = loadReactors;
  const cacheRef = useRef(cachedReactors);
  cacheRef.current = cachedReactors;
  const open = selected !== null;
  // Cached names show at once and refresh quietly; only the latest request may settle the list.
  const load = useCallback(() => {
    const id = ++request.current;
    const cached = cacheRef.current();
    setWho(cached ? { status: "ready", rows: cached } : { status: "loading" });
    loadRef.current().then(
      (rows) => {
        if (request.current === id) setWho({ status: "ready", rows });
      },
      () => {
        if (request.current === id && !cached) setWho({ status: "error" });
      },
    );
  }, []);
  useEffect(() => {
    if (!open) return;
    load();
    return () => {
      request.current++;
    };
  }, [open, load]);
  // The chosen tab stays while empty, so a removal (or its rollback) happens in place.
  const tabList =
    selected === null || reactions.some((entry) => entry.emoji === selected)
      ? reactions
      : [...reactions, { emoji: selected, count: 0 }];

  const tabs = useRef<HTMLDivElement>(null);
  const onTabKey = (event: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = tabList.findIndex((entry) => entry.emoji === selected);
    const next =
      tabList[(index + step + tabList.length) % tabList.length]?.emoji;
    if (!next) return;
    onSelect(next);
    requestAnimationFrame(() =>
      tabs.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus(),
    );
  };
  // Toggling swaps the focused button for its counterpart; keep focus on that control.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && document.activeElement === document.body)
      panel.current
        ?.querySelector<HTMLElement>(".reactor-action:not(:disabled)")
        ?.focus();
  });
  // The viewer's row follows the optimistic chip state, so a failed save rolls it back too.
  const reacted = selected !== null && mine.includes(selected);
  const rows = [
    ...(reacted ? [{ emoji: selected, name: "You", mine: true }] : []),
    ...(who.status === "ready"
      ? who.rows.filter((row) => row.emoji === selected && !row.mine)
      : []),
  ];
  // Placeholder rows hold the names' space so nothing above them moves when they arrive.
  const pending =
    who.status === "loading"
      ? Math.max(
          0,
          (tabList.find((entry) => entry.emoji === selected)?.count ?? 0) -
            (reacted ? 1 : 0),
        )
      : 0;
  return (
    <Sheet open={open} title="Reactions" onDismiss={onDismiss}>
      <div
        className="reactor-tabs"
        role="tablist"
        aria-label="Emoji"
        ref={tabs}
        onKeyDown={onTabKey}
      >
        {tabList.map(({ emoji, count }) => (
          <button
            key={emoji}
            type="button"
            role="tab"
            aria-selected={emoji === selected}
            aria-label={`${emoji}, ${count}`}
            tabIndex={emoji === selected ? 0 : -1}
            onClick={() => onSelect(emoji)}
          >
            <span aria-hidden="true">{emoji}</span>
            <span className="proof-reaction-count" aria-hidden="true">
              {count}
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" ref={panel} aria-label={`Reacted ${selected ?? ""}`}>
        {/* Your own controls come from local state and sit above the names, which load in later. */}
        {!readOnly && selected && !reacted && (
          <button
            type="button"
            className="reactor-action reactor-add"
            disabled={mine.length >= reactionLimit}
            onClick={() => onToggle(selected, true)}
          >
            {mine.length >= reactionLimit
              ? `Up to ${reactionLimit} reactions`
              : `React with ${selected}`}
          </button>
        )}
        {rows.length + pending > 0 && (
          <ul className="reactor-list">
            {rows.map((row, index) => (
              <li
                key={row.mine ? "you" : `${row.name}-${index}`}
                className={row.mine ? "reactor-mine" : undefined}
              >
                <span className="reactor-name">
                  {row.mine ? "You" : row.name}
                </span>
                {row.mine && !readOnly && (
                  <button
                    type="button"
                    className="reactor-action"
                    aria-label={`Remove your ${row.emoji}`}
                    onClick={() => onToggle(row.emoji, false)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: pending }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
              <li key={index} className="reactor-placeholder">
                {index === 0 && <span role="status">Loading names…</span>}
              </li>
            ))}
          </ul>
        )}
        {who.status === "error" && (
          <div className="reactor-error" role="alert">
            <p className="sheet-hint">Couldn’t load reactions.</p>
            <button type="button" className="reactor-action" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {who.status !== "error" && rows.length + pending === 0 && (
          <p className="sheet-hint">No reactions yet.</p>
        )}
      </div>
    </Sheet>
  );
}

// The full picker loads on first open and reads emoji data served from our own origin.
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    let picker: HTMLElement | undefined;
    let cancelled = false;
    void import("emoji-picker-element").then(({ Picker }) => {
      if (cancelled || !holder.current) return;
      picker = new Picker({ dataSource: emojiData });
      picker.className = "dark";
      const style = document.createElement("style");
      style.textContent = pickerStyle;
      picker.shadowRoot?.append(style);
      swipeCategories(picker);
      picker.addEventListener("emoji-click", (event) => {
        const unicode = (event as CustomEvent<{ unicode?: string }>).detail
          .unicode;
        if (unicode) pickRef.current(unicode);
      });
      holder.current.append(picker);
    });
    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, []);
  return <div ref={holder} className="emoji-picker-holder" />;
}

export function Reactions({
  reactions,
  mine,
  readOnly,
  onToggle,
  loadReactors,
  cachedReactors,
}: Props) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to the chip; if that chip is gone, to Add reaction.
  const closeViewing = useCallback(() => {
    setViewing(null);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) addRef.current?.focus();
    });
  }, []);
  const full = mine.length >= reactionLimit;
  const pick = (emoji: string) => {
    if (mine.includes(emoji)) onToggle(emoji, false);
    else if (!full) onToggle(emoji, true);
    setOpen(false);
  };

  return (
    <>
      <fieldset className="proof-reactions" aria-label="Reactions">
        {reactions.map(({ emoji, count }) => (
          <button
            key={emoji}
            type="button"
            className="proof-reaction"
            aria-haspopup="dialog"
            aria-pressed={readOnly ? undefined : mine.includes(emoji)}
            aria-label={`${emoji}, ${count}`}
            // Names start loading on press, ahead of the click that opens the drawer.
            onPointerDown={() => void loadReactors().catch(() => {})}
            onClick={() => setViewing(emoji)}
          >
            <span aria-hidden="true">{emoji}</span>
            <span className="proof-reaction-count" aria-hidden="true">
              {count}
            </span>
          </button>
        ))}
        {!readOnly && (
          <button
            type="button"
            ref={addRef}
            className="proof-reaction proof-reaction-add"
            aria-haspopup="dialog"
            aria-label={full ? "Reaction limit reached" : "Add reaction"}
            disabled={full}
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <circle
                cx="9"
                cy="10"
                r="6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="6.8" cy="8.6" r="1" fill="currentColor" />
              <circle cx="11.2" cy="8.6" r="1" fill="currentColor" />
              <path
                d="M6.2 11.8a3.2 3.2 0 0 0 5.6 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M16.5 1.5v5M14 4h5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </fieldset>
      <Sheet open={open} title="React" onDismiss={() => setOpen(false)}>
        <fieldset className="reaction-quick" aria-label="Gym favorites">
          {quickPicks.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              aria-pressed={mine.includes(emoji)}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </fieldset>
        <EmojiPicker onPick={pick} />
      </Sheet>
      <ReactorsSheet
        reactions={reactions}
        mine={mine}
        readOnly={readOnly}
        selected={viewing}
        onSelect={setViewing}
        onToggle={onToggle}
        loadReactors={loadReactors}
        cachedReactors={cachedReactors}
        onDismiss={closeViewing}
      />
    </>
  );
}
