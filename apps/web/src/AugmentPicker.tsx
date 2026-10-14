import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Card = {
  cardId: string;
  title: string;
  instructions: string;
  unlockedByFriend: boolean;
};

// Short heavy buzzes as each card lands; skipped when motion is reduced or vibration
// is unsupported (iPhone Safari has no Vibration API).
const buzz = (pattern: number | number[]) => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {}
};

const focusable = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Full-screen three-card pick in the style of TFT augments: cards deal in, one lifts when
// chosen, and the whole hand can be rerolled once.
export function AugmentPicker({
  cards,
  canReroll,
  busy,
  owed,
  onLock,
  onReroll,
  onClose,
}: {
  cards: Card[];
  canReroll: boolean;
  busy: boolean;
  owed: number;
  onLock: (cardId: string) => void;
  onReroll: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const hand = cards.map((card) => card.cardId).join();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A new hand (first deal or reroll) clears the choice and replays the deal.
  useEffect(() => {
    void hand;
    setChosen(null);
    buzz([60, 80, 60, 80, 140]);
  }, [hand]);

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.querySelector<HTMLElement>("h2")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(focusable),
      ];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div className="augment-layer">
      <div
        ref={dialogRef}
        className="augment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="augment-close"
          aria-label="Decide later"
          onClick={onClose}
        >
          ×
        </button>
        <p className="augment-kicker">
          Penalty due · {owed} owed · 48 hours to finish
        </p>
        <h2 id={titleId} tabIndex={-1}>
          Choose your punishment
        </h2>
        <div className="augment-hand" key={hand}>
          {cards.map((card) => (
            <button
              type="button"
              key={card.cardId}
              className={`augment-card${card.unlockedByFriend ? " tier-gold" : ""}`}
              aria-pressed={chosen === card.cardId}
              disabled={busy}
              onClick={() => {
                setChosen(card.cardId);
                buzz(35);
              }}
            >
              <span className="augment-head">
                {chosen === card.cardId ? (
                  <span className="augment-stamp" aria-hidden="true">
                    Yours
                  </span>
                ) : (
                  <span className="augment-tier">
                    {card.unlockedByFriend ? "From a friend" : "Penalty"}
                  </span>
                )}
              </span>
              <strong className="augment-title">{card.title}</strong>
              <span className="augment-rule" aria-hidden="true" />
              <span className="augment-text">{card.instructions}</span>
            </button>
          ))}
        </div>
        <div className="augment-footer">
          <button
            type="button"
            className="augment-reroll"
            disabled={busy || !canReroll}
            onClick={onReroll}
          >
            <span aria-hidden="true">⟳</span>{" "}
            {canReroll ? "Reroll all (1 left)" : "No rerolls left"}
          </button>
          <button
            type="button"
            className="augment-lock"
            disabled={busy || !chosen}
            onClick={() => chosen && onLock(chosen)}
          >
            {busy ? "Locking…" : "Accept penalty"}
          </button>
        </div>
        <p className="augment-hint">
          The 48-hour clock starts when you accept. Miss it and you owe another.
          Two friends sign off when it’s done.
        </p>
      </div>
    </div>,
    document.body,
  );
}
