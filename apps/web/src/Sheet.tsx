import { type ReactNode, useEffect, useId, useRef } from "react";

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
      if (!controls.includes(document.activeElement as HTMLElement)) {
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
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus();
    };
  }, [open]);

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
        <div className="sheet-grab" aria-hidden="true" />
        <header className="sheet-header">
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
          {dismissible && (
            <button type="button" aria-label="Close" onClick={onDismiss}>
              ×
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
