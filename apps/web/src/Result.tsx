import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Notice = {
  kind: "success" | "error";
  text: string;
  persistent?: boolean;
} | null;

export function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    if (!notice || notice.persistent) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

export function Result({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const message = (
    <p
      className={`result ${notice.kind}${notice.persistent ? "" : " event-notice"}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
  return notice.persistent
    ? message
    : createPortal(
        message,
        document.querySelector('[role="dialog"]') ?? document.body,
      );
}
