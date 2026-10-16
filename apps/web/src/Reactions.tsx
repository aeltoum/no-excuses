import emojiData from "emoji-picker-element-data/en/emojibase/data.json?url";
import { useEffect, useRef, useState } from "react";
import { type ReactionCount, reactionLimit } from "./proof";
import { Sheet } from "./Sheet";

// Quick picks drawn from the gym floor; the full picker below searches every emoji.
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

type Props = {
  reactions: ReactionCount[];
  mine: string[];
  // The author sees counts only.
  readOnly: boolean;
  onToggle: (emoji: string, on: boolean) => void;
};

// The full picker loads on first open and reads emoji data served from our own origin.
function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
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

export function Reactions({ reactions, mine, readOnly, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const full = mine.length >= reactionLimit;
  const pick = (emoji: string) => {
    if (mine.includes(emoji)) onToggle(emoji, false);
    else if (!full) onToggle(emoji, true);
    setOpen(false);
  };

  return (
    <>
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
            type="button"
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
    </>
  );
}
