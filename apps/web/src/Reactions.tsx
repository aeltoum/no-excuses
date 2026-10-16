import { useEffect, useId, useRef, useState } from "react";
import { type ReactionCount, reactionLimit } from "./proof";

// Quick picks drawn from the gym floor; the field below takes any emoji.
const quickPicks = [
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
const firstEmoji =
  /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\u{FE0F}|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:\u{FE0F}|[\u{1F3FB}-\u{1F3FF}])*)*/u;

type Props = {
  reactions: ReactionCount[];
  mine: string[];
  // The author sees counts only.
  readOnly: boolean;
  onToggle: (emoji: string, on: boolean) => void;
};

export function Reactions({ reactions, mine, readOnly, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const trayId = useId();
  const addRef = useRef<HTMLButtonElement>(null);
  const trayRef = useRef<HTMLFieldSetElement>(null);
  const full = mine.length >= reactionLimit;

  useEffect(() => {
    if (!open) return;
    trayRef.current?.querySelector("button")?.focus();
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        (trayRef.current?.contains(event.target as Node) ||
          addRef.current?.contains(event.target as Node))
      )
        return;
      setOpen(false);
      if (event instanceof KeyboardEvent) addRef.current?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const pick = (emoji: string) => {
    onToggle(emoji, !mine.includes(emoji));
    setOpen(false);
    setCustom("");
    addRef.current?.focus();
  };
  const typed = custom.match(firstEmoji)?.[0];

  return (
    <div className="proof-reactions-wrap">
      <fieldset className="proof-reactions" aria-label="Reactions">
        {reactions.map(({ emoji, count }) =>
          readOnly ? (
            <span key={emoji} className="proof-reaction">
              <span aria-hidden="true">{emoji}</span>
              <span className="proof-reaction-count">{count}</span>
            </span>
          ) : (
            <button
              key={emoji}
              type="button"
              className="proof-reaction"
              aria-pressed={mine.includes(emoji)}
              aria-label={`${emoji}, ${count}`}
              disabled={full && !mine.includes(emoji)}
              onClick={() => onToggle(emoji, !mine.includes(emoji))}
            >
              <span aria-hidden="true">{emoji}</span>
              <span className="proof-reaction-count" aria-hidden="true">
                {count}
              </span>
            </button>
          ),
        )}
        {!readOnly && (
          <button
            ref={addRef}
            type="button"
            className="proof-reaction proof-reaction-add"
            aria-expanded={open}
            aria-controls={trayId}
            aria-label={full ? "Reaction limit reached" : "Add reaction"}
            disabled={full}
            onClick={() => setOpen((value) => !value)}
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
      {open && (
        <fieldset
          ref={trayRef}
          id={trayId}
          className="reaction-tray"
          aria-label="Pick a reaction"
        >
          <div className="reaction-tray-grid">
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
          </div>
          <form
            className="reaction-tray-custom"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed) pick(typed);
            }}
          >
            <label>
              <span>Any emoji</span>
              <input
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder="Open your emoji keyboard"
                autoComplete="off"
                enterKeyHint="send"
              />
            </label>
            <button type="submit" disabled={!typed}>
              React {typed ?? ""}
            </button>
          </form>
        </fieldset>
      )}
    </div>
  );
}
