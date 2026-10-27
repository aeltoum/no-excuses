import { type ReactNode, useEffect, useId, useRef } from "react";

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Phone Back closes the sheet before it leaves the page: an open sheet owns
// one history entry, popped by Back or unwound when the sheet closes itself.
const unwinding = new Map<string, number>();

export function Sheet({
  children,
  dismissible = true,
  onDismiss,
  open,
  title,
}: {
  children: ReactNode;
  dismissible?: boolean;
  onDismiss: () => void;
  open: boolean;
  title: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  const dismissibleRef = useRef(dismissible);
  dismissRef.current = onDismiss;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("h2")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dismissibleRef.current) {
          event.preventDefault();
          dismissRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(focusable),
      ];
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1);
      // Widgets with their own shadow DOM (the emoji picker) keep focus inside the sheet.
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Lock the page behind the sheet; the sheet and picker keep their own scrolling.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus();
    };
  }, [open]);

  // Runs once per opening: a re-run would unwind and re-push mid-navigation.
  useEffect(() => {
    if (!open) return;
    // A sheet reopening in the same tick (StrictMode, a quick swap) takes over
    // the entry a closing sheet was about to unwind.
    const current = window.history.state?.sheet;
    const adopted = typeof current === "string" && unwinding.get(current);
    let id: string;
    if (adopted) {
      window.clearTimeout(adopted);
      unwinding.delete(current);
      id = current;
    } else {
      id = crypto.randomUUID();
      window.history.pushState(
        { ...window.history.state, sheet: id },
        "",
        window.location.href,
      );
    }
    let popped = false;
    const onPopState = () => {
      if (window.history.state?.sheet === id) return;
      if (!dismissibleRef.current) {
        // A sheet that cannot close keeps its entry.
        window.history.pushState(
          { ...window.history.state, sheet: id },
          "",
          window.location.href,
        );
        return;
      }
      popped = true;
      dismissRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (popped || window.history.state?.sheet !== id) return;
      unwinding.set(
        id,
        window.setTimeout(() => {
          if (!unwinding.delete(id)) return;
          if (window.history.state?.sheet === id) window.history.back();
        }, 0),
      );
    };
  }, [open]);

  // Dragging the handle or header down moves the sheet; a long or quick pull closes it.
  const drag = useRef<{ y: number; at: number; dy: number } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dismissible || (event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, at: event.timeStamp, dy: 0 };
    if (dialogRef.current) dialogRef.current.style.transition = "none";
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !dialogRef.current) return;
    drag.current.dy = Math.max(0, event.clientY - drag.current.y);
    dialogRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const sheet = dialogRef.current;
    drag.current = null;
    if (!state || !sheet) return;
    const speed = state.dy / Math.max(1, event.timeStamp - state.at);
    sheet.style.transition = "";
    if (state.dy > Math.min(140, sheet.offsetHeight / 3) || speed > 0.6) {
      sheet.style.transform = "translateY(100%)";
      window.setTimeout(() => dismissRef.current(), 160);
    } else sheet.style.transform = "";
  };

  if (!open) return null;
  return (
    <div className="sheet-layer">
      <button
        className="sheet-scrim"
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        disabled={!dismissible}
        onClick={() => {
          if (dismissible) onDismiss();
        }}
      />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div
          className="sheet-drag"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="sheet-grab" aria-hidden="true" />
          <header className="sheet-header">
            <h2 id={titleId} tabIndex={-1}>
              {title}
            </h2>
            {dismissible && (
              <button
                type="button"
                className="sheet-close"
                aria-label="Close"
                onClick={onDismiss}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </header>
        </div>
        {children}
      </div>
    </div>
  );
}
