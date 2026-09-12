import { createClient } from "@supabase/supabase-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readPublicEnvironment } from "./env";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing application root");
const root = createRoot(rootElement);

try {
  const environment = readPublicEnvironment(import.meta.env);
  const auth = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  );
  root.render(
    <StrictMode>
      <App auth={auth} apiBaseUrl={environment.apiBaseUrl} />
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
