import { useCallback, useRef, useState } from "react";
import { Sheet } from "./Sheet";

type Request = {
  title: string;
  body: string;
  confirm: string;
  tone?: "danger";
};

// In-app replacement for window.confirm: `ask` resolves true only on the confirm button.
export function useConfirm() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<(value: boolean) => void>(() => {});

  const ask = useCallback(
    (next: Request) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );
  const finish = (value: boolean) => {
    setRequest(null);
    resolver.current(value);
  };

  const element = (
    <Sheet
      open={request !== null}
      title={request?.title ?? ""}
      onDismiss={() => finish(false)}
    >
      <p className="confirm-body">{request?.body}</p>
      <div className="confirm-actions">
        <button
          type="button"
          className={request?.tone === "danger" ? "confirm-danger" : undefined}
          onClick={() => finish(true)}
        >
          {request?.confirm}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => finish(false)}
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
  return [element, ask] as const;
}
