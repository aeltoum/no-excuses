import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readPublicEnvironment } from "./env";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing application root");
const root = createRoot(rootElement);

try {
  readPublicEnvironment(import.meta.env);
  root.render(
    <StrictMode>
      <App />
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
