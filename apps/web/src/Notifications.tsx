import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { onClearPersisted, persistentMap } from "./persist";
import { call } from "./proof";
import { Sheet } from "./Sheet";

type Item = {
  id: number;
  title: string;
  body: string;
  at: string;
  unread: boolean;
  kind: string;
};
type Prefs = { socialPush: boolean; digest: boolean; digestHour: number };
type Center = { items: Item[]; prefs: Prefs };

// The last list is kept across launches and refreshed ahead of the tap, so the
// sheet opens with it already in place.
const saved = persistentMap<Center>("notifications");
let centerCache: Center | null = saved.get("center") ?? null;
const keep = (center: Center | null) => {
  centerCache = center;
  if (center) saved.set("center", center);
  else saved.delete("center");
};
onClearPersisted(() => {
  centerCache = null;
});

const ago = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const loadCenter = (apiBaseUrl: string, token: string) =>
  call<Center>(apiBaseUrl, token, "/v1/notifications", { method: "GET" }).then(
    (center) => {
      if (!Array.isArray(center?.items) || !center.prefs)
        throw new ApiError("failure", "Unexpected notifications response.");
      keep(center);
      return center;
    },
  );

// Masthead bell: unread count from Home, the list on tap.
export function NotificationBell({
  apiBaseUrl,
  token,
  unread,
  onSeen,
  onRevoked,
}: {
  apiBaseUrl: string;
  token: string;
  unread: number;
  onSeen: () => void;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [center, setCenter] = useState<Center | null>(centerCache);
  const [failed, setFailed] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;
  // New activity refreshes the list in the background before the bell is tapped.
  useEffect(() => {
    if (unread === 0) return;
    let active = true;
    loadCenter(apiBaseUrl, token)
      .then((next) => {
        if (active) setCenter(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [unread, apiBaseUrl, token]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setFailed(false);
    loadCenter(apiBaseUrl, token)
      .then((next) => {
        if (!active) return;
        setCenter(next);
        // Opening the list counts as seeing it.
        void call(apiBaseUrl, token, "/v1/notifications/seen", {
          method: "POST",
          body: {},
        }).catch(() => undefined);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized")
          revoked.current();
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, apiBaseUrl, token]);
  return (
    <>
      <button
        type="button"
        className="masthead-bell"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        onClick={() => {
          setOpen(true);
          onSeen();
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span className="tab-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <Sheet open={open} title="Notifications" onDismiss={() => setOpen(false)}>
        {center === null ? (
          failed ? (
            <p role="alert">Couldn’t load notifications. Try again later.</p>
          ) : (
            <ul className="notification-list" aria-busy="true">
              <li className="skeleton skeleton-row" />
              <li className="skeleton skeleton-row" />
              <li className="skeleton skeleton-row" />
            </ul>
          )
        ) : center.items.length === 0 ? (
          <p className="hint">
            Nothing yet. Activity from your crew shows here.
          </p>
        ) : (
          <>
            <ul className="notification-list">
              {center.items.map((item) => (
                <li
                  key={item.id}
                  className={item.unread ? "unread" : undefined}
                >
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <time dateTime={item.at}>{ago(item.at)}</time>
                </li>
              ))}
            </ul>
            {clearFailed && (
              <p className="result error" role="alert">
                Couldn’t clear notifications. Try again.
              </p>
            )}
            <button
              type="button"
              className="secondary-button notification-clear"
              onClick={() => {
                // Optimistic: the list empties now; a failure brings it back.
                const previous = center;
                setClearFailed(false);
                const cleared = { ...center, items: [] };
                setCenter(cleared);
                keep(cleared);
                call(apiBaseUrl, token, "/v1/notifications/clear", {
                  method: "POST",
                  body: {},
                }).catch(() => {
                  setCenter(previous);
                  keep(previous);
                  setClearFailed(true);
                });
              }}
            >
              Clear all
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(
    new Date(2026, 0, 1, hour),
  );

// Account: social pushes and the daily digest, saved optimistically.
export function NotificationSettings({
  apiBaseUrl,
  token,
  onNotice,
}: {
  apiBaseUrl: string;
  token: string;
  onNotice: (notice: { kind: "success" | "error"; text: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(centerCache?.prefs ?? null);
  // A load that lands after the member changed something must not undo it.
  const edited = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    edited.current = false;
    loadCenter(apiBaseUrl, token)
      .then((center) => {
        if (active && !edited.current) setPrefs(center.prefs);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open, apiBaseUrl, token]);
  const save = (patch: Partial<Prefs>) => {
    if (!prefs) return;
    edited.current = true;
    const previous = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (centerCache) keep({ ...centerCache, prefs: next });
    call<Prefs>(apiBaseUrl, token, "/v1/notifications/prefs", {
      method: "POST",
      body: patch,
    }).catch((error) => {
      setPrefs(previous);
      if (centerCache) keep({ ...centerCache, prefs: previous });
      onNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Couldn’t save. Try again.",
      });
    });
  };
  return (
    <>
      <button
        className="account-row"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span>Notification settings</span>
        <span>→</span>
      </button>
      <Sheet
        open={open}
        title="Notification settings"
        onDismiss={() => setOpen(false)}
      >
        {prefs === null ? (
          <div className="notification-prefs" aria-busy="true">
            <span className="skeleton skeleton-row" />
            <span className="skeleton skeleton-row" />
          </div>
        ) : (
          <div className="notification-prefs">
            <label className="switch-label">
              <input
                type="checkbox"
                role="switch"
                aria-checked={prefs.socialPush}
                checked={prefs.socialPush}
                onChange={(event) => save({ socialPush: event.target.checked })}
              />
              Push reactions, nudges, and cheers right away
            </label>
            <label className="switch-label">
              <input
                type="checkbox"
                role="switch"
                aria-checked={prefs.digest}
                checked={prefs.digest}
                onChange={(event) => save({ digest: event.target.checked })}
              />
              Daily digest of crew activity
            </label>
            <label>
              Digest time
              <select
                value={prefs.digestHour}
                disabled={!prefs.digest}
                onChange={(event) =>
                  save({ digestHour: Number(event.target.value) })
                }
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              Everything still shows under the bell. Digest time uses your
              crew’s time zone.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
