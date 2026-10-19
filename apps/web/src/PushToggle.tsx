import { useEffect, useRef, useState } from "react";
import { requestTimeoutMs, wakeTimeoutMs } from "./api-client";

type State =
  | "checking"
  | "unsupported"
  | "install"
  | "unavailable"
  | "blocked"
  | "off"
  | "on"
  | "working";

const supported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

// The VAPID key rarely changes; keep it so the toggle works before the API wakes.
const keyStorage = "no-excuses:push-key";
const readKey = () => {
  try {
    return localStorage.getItem(keyStorage);
  } catch {
    return null;
  }
};
const writeKey = (key: string | null) => {
  try {
    if (key) localStorage.setItem(keyStorage, key);
    else localStorage.removeItem(keyStorage);
  } catch {
    // Storage unavailable: fetch the key again next time.
  }
};

const base64Key = (value: string) => {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

export function PushToggle({
  apiBaseUrl,
  accessToken,
}: {
  apiBaseUrl: string;
  accessToken: () => string;
}) {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Session tokens refresh; read the latest without re-running the status check.
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!supported()) {
        if (live) setState(ios() ? "install" : "unsupported");
        return;
      }
      // On/off/blocked are device facts: show them without waiting on the API.
      try {
        if (Notification.permission === "denied") {
          if (live) setState("blocked");
        } else {
          const registration =
            await navigator.serviceWorker.getRegistration("/");
          const subscription =
            await registration?.pushManager.getSubscription();
          if (live) setState(subscription ? "on" : "off");
        }
      } catch {
        if (live) setState("off");
      }
      const cached = readKey();
      if (cached && live) setPublicKey(cached);
      // A sleeping API host can hang; time out and retry once while it wakes.
      for (const timeout of [requestTimeoutMs, wakeTimeoutMs]) {
        try {
          const response = await fetch(`${apiBaseUrl}/v1/push`, {
            headers: { authorization: `Bearer ${tokenRef.current()}` },
            signal: AbortSignal.timeout(timeout),
          });
          const key = (
            (await response.json()) as { data?: { publicKey?: string } }
          ).data?.publicKey;
          if (!live) return;
          writeKey(key ?? null);
          setPublicKey(key ?? null);
          if (!key) setState((now) => (now === "on" ? now : "unavailable"));
          return;
        } catch {
          if (!live) return;
        }
      }
      if (!cached) setState((now) => (now === "off" ? "unavailable" : now));
    })();
    return () => {
      live = false;
    };
  }, [apiBaseUrl]);

  const send = (method: "POST" | "DELETE", subscription: PushSubscription) =>
    fetch(`${apiBaseUrl}/v1/push`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(subscription.toJSON()),
    }).then((response) => {
      if (!response.ok) throw new Error("Request failed");
    });

  const toggle = async () => {
    const turningOn = state === "off";
    if (turningOn && !publicKey) return;
    setState("working");
    setError("");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (turningOn) {
        if ((await Notification.requestPermission()) !== "granted")
          return setState("blocked");
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64Key(publicKey as string),
          }));
        await send("POST", subscription);
        setState("on");
      } else {
        if (existing) {
          await send("DELETE", existing);
          await existing.unsubscribe();
        }
        setState("off");
      }
    } catch {
      setError("Couldn’t update notifications. Try again.");
      setState(turningOn ? "off" : "on");
    }
  };

  const status: Record<State, string> = {
    checking: "Checking…",
    unsupported: "Not supported in this browser",
    install: "Install to home screen first",
    unavailable: "Unavailable right now",
    blocked: "Blocked in phone settings",
    off: "Off",
    on: "On",
    working: "Updating…",
  };
  const actionable = state === "on" || (state === "off" && !!publicKey);

  return (
    <>
      <button
        className="account-row"
        type="button"
        onClick={() => void toggle()}
        disabled={!actionable}
        aria-pressed={state === "on"}
      >
        <span>Notifications</span>
        <span>{status[state]}</span>
      </button>
      {error && (
        <p className="account-load-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// On sign-out the device stops receiving; the server prunes the endpoint on its next 410.
export async function unsubscribePush() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  } catch {}
}
