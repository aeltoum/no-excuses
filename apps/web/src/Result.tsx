import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

type Notice = {
  kind: "success" | "error";
  text: string;
  persistent?: boolean;
} | null;

export function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    // Errors stay until the member dismisses them or the next notice replaces them.
    if (!notice || notice.persistent || notice.kind === "error") return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

export function Result({ notice }: { notice: Notice }) {
  // Chosen after commit, so a sheet closing in the same update is no longer the target.
  const [target, setTarget] = useState<Element | null>(null);
  const [dismissed, setDismissed] = useState<Notice>(null);
  useLayoutEffect(() => {
    void notice;
    // The innermost open dialog, e.g. a sheet over a full-screen post.
    const dialogs = document.querySelectorAll('[role="dialog"]');
    setTarget(dialogs[dialogs.length - 1] ?? document.body);
  }, [notice]);
  if (!notice || dismissed === notice) return null;
  const message = (
    <p
      className={`result ${notice.kind}${notice.persistent ? "" : " event-notice"}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}
      {notice.kind === "error" && !notice.persistent && (
        <button
          type="button"
          className="result-dismiss"
          aria-label="Dismiss"
          onClick={() => setDismissed(notice)}
        />
      )}
    </p>
  );
  return notice.persistent
    ? message
    : target
      ? createPortal(message, target)
      : null;
}
