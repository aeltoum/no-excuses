import { useState } from "react";

const dismissedKey = "no-excuses:install-prompt-dismissed";

// iPhone Safari only delivers push to Home Screen apps, so nudge until installed.
function shouldShow() {
  if (typeof navigator === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  if (!ios || standalone) return false;
  try {
    return window.localStorage.getItem(dismissedKey) !== "1";
  } catch {
    return true;
  }
}

export function InstallPrompt() {
  const [visible, setVisible] = useState(shouldShow);
  if (!visible) return null;
  return (
    <aside className="install-prompt" aria-label="Install the app">
      <div>
        <strong>Add No Excuses to your Home Screen</strong>
        <p>
          iPhone only sends workout and card notifications to installed apps.
          Tap{" "}
          <span className="install-share" aria-hidden="true">
            ⬆︎
          </span>{" "}
          Share, then <b>Add to Home Screen</b>, and open it from there.
        </p>
      </div>
      <button
        type="button"
        className="install-dismiss"
        aria-label="Dismiss install tip"
        onClick={() => {
          try {
            window.localStorage.setItem(dismissedKey, "1");
          } catch {}
          setVisible(false);
        }}
      >
        ×
      </button>
    </aside>
  );
}
