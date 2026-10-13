import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Card = {
  cardId: string;
  title: string;
  instructions: string;
  unlockedByFriend: boolean;
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
          You owe {owed} {owed === 1 ? "card" : "cards"}
        </p>
        <h2 id={titleId} tabIndex={-1}>
          Choose your Consequence
        </h2>
        <div className="augment-hand" key={hand}>
          {cards.map((card, index) => (
            <button
              type="button"
              key={card.cardId}
              className={`augment-card${card.unlockedByFriend ? " tier-gold" : ""}`}
              style={{ animationDelay: `${index * 110}ms` }}
              aria-pressed={chosen === card.cardId}
              disabled={busy}
              onClick={() => setChosen(card.cardId)}
            >
              <span className="augment-tier">
                {card.unlockedByFriend ? "Friend unlock" : "Standard"}
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
            {busy ? "Locking…" : "Lock it in"}
          </button>
        </div>
        <p className="augment-hint">
          48 hours starts when you lock it in. Two friends approve when you’re
          done.
        </p>
      </div>
    </div>,
    document.body,
  );
}
