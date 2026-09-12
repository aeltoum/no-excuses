import { useEffect, useState } from "react";

const routes = {
  "/": [
    "Checking your access",
    "Session restore will route to your authorized destination.",
  ],
  "/sign-in": ["Sign in", "Email code sign-in arrives in next delivery slice."],
  "/group": [
    "Your Group",
    "Private Group setup and membership actions arrive next.",
  ],
  "/home": [
    "Every rep counts.",
    "Weekly accountability arrives in delivery slice three.",
  ],
  "/target": [
    "Weekly target",
    "Target setting arrives in delivery slice three.",
  ],
  "/history": [
    "Your history",
    "Finalized weekly outcomes arrive in delivery slice three.",
  ],
  "/account": ["Your account", "Sign out and Account deletion arrive next."],
} as const;
type Route = keyof typeof routes;
const memberRoutes: Array<[Route, string]> = [
  ["/home", "Home"],
  ["/group", "Group"],
  ["/target", "Target"],
  ["/history", "History"],
  ["/account", "Account"],
];
const currentPath = () => window.location.pathname.replace(/\/+$/, "") || "/";

export function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    window.history.pushState(null, "", destination);
    setPath(destination);
    window.scrollTo(0, 0);
  };
  const route = routes[path as Route];
  const activePath = route ? path : "";
  return (
    <div className="app-shell">
      <header className="masthead">
        <a
          className="wordmark"
          href="/"
          onClick={(event) => navigate(event, "/")}
        >
          No Excuses
        </a>
        <span className="status">
          <span aria-hidden="true" /> True MVP shell
        </span>
      </header>
      <main id="main-content">
        {route ? (
          <section className="hero" key={path}>
            <p className="eyebrow">Private friend-group accountability</p>
            <h1>{route[0]}</h1>
            <p className="lead">{route[1]}</p>
            {path === "/" && (
              <a
                className="primary-action"
                href="/sign-in"
                onClick={(event) => navigate(event, "/sign-in")}
              >
                Continue to sign in
              </a>
            )}
            <aside className="install-help" aria-labelledby="install-title">
              <h2 id="install-title">Install when ready</h2>
              <p>
                <strong>iPhone:</strong> In Safari, tap Share, then Add to Home
                Screen.
              </p>
              <p>
                <strong>Android:</strong> In Chrome, open menu, then tap Install
                app.
              </p>
              <p>Installation is optional. Every flow works in browser.</p>
            </aside>
          </section>
        ) : (
          <section className="hero">
            <p className="eyebrow">Route unavailable</p>
            <h1>Nothing shared here.</h1>
            <p className="lead">
              This address is not part of No Excuses. No Group or account
              details were loaded.
            </p>
            <a
              className="primary-action"
              href="/"
              onClick={(event) => navigate(event, "/")}
            >
              Return to start
            </a>
          </section>
        )}
      </main>
      <nav aria-label="Member destinations">
        {memberRoutes.map(([destination, label]) => (
          <a
            aria-current={activePath === destination ? "page" : undefined}
            href={destination}
            key={destination}
            onClick={(event) => navigate(event, destination)}
          >
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
