import { createClient } from "@supabase/supabase-js";
import { Component, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { fetchAuth } from "./auth";
import { readPublicEnvironment } from "./env";
import "./styles.css";

// A render crash would otherwise leave a blank page. Show what broke and offer a
// reset that drops this device's cached screens (sign-in is kept).
class CrashScreen extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main>
        <section className="hero">
          <h1>Something broke.</h1>
          <p className="lead" role="alert">
            Reset clears saved screens on this device and reloads. You stay
            signed in.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                for (const key of Object.keys(localStorage))
                  if (key.startsWith("no-excuses:cache:"))
                    localStorage.removeItem(key);
              } catch {}
              window.location.reload();
            }}
          >
            Reset and reload
          </button>
          <pre className="crash-detail">
            {`${error.name}: ${error.message}\n${error.stack ?? ""}`.slice(
              0,
              1200,
            )}
          </pre>
        </section>
      </main>
    );
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing application root");
const root = createRoot(rootElement);

try {
  const environment = readPublicEnvironment(import.meta.env);
  const auth = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      global: { fetch: fetchAuth },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  );
  root.render(
    <StrictMode>
      <CrashScreen>
        <App auth={auth} apiBaseUrl={environment.apiBaseUrl} />
      </CrashScreen>
    </StrictMode>,
  );
} catch {
  root.render(
    <main>
      <section className="hero">
        <p className="eyebrow">Configuration unavailable</p>
        <h1>Cannot start safely.</h1>
        <p className="lead" role="alert">
          Required public client configuration is missing or invalid. Check
          local setup and try again.
        </p>
      </section>
    </main>,
  );
}
