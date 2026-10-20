import { useEffect, useState } from "react";

// The app's own entry script, as the running page and the server's page name it.
const entry = (html: string) =>
  /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] ?? null;
const running = () =>
  document.querySelector('script[type="module"][src]')?.getAttribute("src") ??
  null;

// Offers a reload when a new version is deployed, checked on return to the app and hourly.
export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const response = await fetch("/", {
          cache: "no-store",
          headers: { accept: "text/html" },
        });
        const latest = response.ok ? entry(await response.text()) : null;
        const current = running();
        if (latest && current && latest !== current) setReady(true);
      } catch {
        // Offline: try again next time.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), 60 * 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="update-prompt" role="status">
      <span>A new version of No Excuses is ready.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
