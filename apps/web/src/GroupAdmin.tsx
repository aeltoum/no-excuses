import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { onClearPersisted } from "./persist";
import { call } from "./proof";

export type GroupSettings = {
  name: string;
  timeZone: string;
  weekStarts: number;
  pendingTimeZone: string | null;
  pendingWeekStarts: number | null;
  admin: boolean;
  changesAt: string | null;
};
type GroupEvent = {
  kind: string;
  at: string;
  name: string | null;
  actor: string | null;
  detail: string | null;
};

export const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const zones = (() => {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(local) ? all : [local, ...all];
  } catch {
    return [local, "UTC"];
  }
})();

// Settings and recent activity stay for the session so reopening is instant.
let settingsCache: GroupSettings | null = null;
let activityCache: GroupEvent[] | null = null;
onClearPersisted(() => {
  settingsCache = null;
  activityCache = null;
});

export const renameGroup = (baseUrl: string, token: string, name: string) =>
  call<GroupSettings>(baseUrl, token, "/v1/group/rename", {
    method: "POST",
    body: { name },
  });

export const setGroupAdmin = (
  baseUrl: string,
  token: string,
  membershipId: string,
  admin: boolean,
) =>
  call<{ admin: boolean }>(baseUrl, token, "/v1/group/admin", {
    method: "POST",
    body: { membershipId, admin },
  });

const describe = (event: GroupEvent) => {
  const who = event.name ?? "A member";
  switch (event.kind) {
    case "joined":
      return `${who} joined`;
    case "left":
      return `${who} left`;
    case "removed":
      return `${who} was removed by an admin`;
    case "service_terminated":
      return `${who}’s membership was ended by the service`;
    case "account_deleted":
      return `${who} left`;
    case "renamed":
      return `${event.actor ?? "An admin"} renamed the crew “${event.detail}”`;
    case "admin_granted":
      return `${who} became an admin`;
    case "admin_revoked":
      return `${who} is no longer an admin`;
    case "settings_changed":
      return `${event.actor ?? "An admin"} set weeks to ${event.detail}`;
    default:
      return who;
  }
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

// Crew schedule (admins) and the Membership event log (everyone) on the Group screen.
export function GroupAdmin({
  apiBaseUrl,
  token,
  manage,
  revision,
  onNotice,
  onRevoked,
}: {
  apiBaseUrl: string;
  token: string;
  manage: boolean;
  revision: number;
  onNotice: (notice: { kind: "success" | "error"; text: string }) => void;
  onRevoked: () => void;
}) {
  const [settings, setSettings] = useState<GroupSettings | null>(settingsCache);
  const [activity, setActivity] = useState<GroupEvent[] | null>(activityCache);
  const [activityOpen, setActivityOpen] = useState(false);
  const [zone, setZone] = useState("");
  const [start, setStart] = useState(1);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  useEffect(() => {
    void revision;
    if (!manage) return;
    let active = true;
    call<GroupSettings>(apiBaseUrl, token, "/v1/group/settings", {
      method: "GET",
    })
      .then((next) => {
        if (!active) return;
        settingsCache = next;
        setSettings(next);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "unauthorized")
          revoked.current();
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, revision, manage]);
  useEffect(() => {
    if (!settings) return;
    setZone(settings.pendingTimeZone ?? settings.timeZone);
    setStart(settings.pendingWeekStarts ?? settings.weekStarts);
  }, [settings]);
  useEffect(() => {
    void revision;
    if (!activityOpen) return;
    let active = true;
    call<GroupEvent[]>(apiBaseUrl, token, "/v1/group/activity", {
      method: "GET",
    })
      .then((next) => {
        if (!active) return;
        activityCache = next;
        setActivity(next);
      })
      .catch(() => {
        if (active && !activityCache) setActivity([]);
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, revision, activityOpen]);

  const saveSchedule = (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    const previous = settings;
    // Optimistic: the new schedule shows as pending at once.
    const next = {
      ...settings,
      pendingTimeZone: zone,
      pendingWeekStarts: start,
    };
    setSettings(next);
    settingsCache = next;
    onNotice({
      kind: "success",
      text: "Saved. New weeks follow this schedule after this week ends.",
    });
    call<GroupSettings>(apiBaseUrl, token, "/v1/group/settings", {
      method: "POST",
      body: { timeZone: zone, weekStarts: start },
    })
      .then((saved) => {
        settingsCache = saved;
        setSettings(saved);
      })
      .catch((error) => {
        settingsCache = previous;
        setSettings(previous);
        if (error instanceof ApiError && error.kind === "unauthorized")
          revoked.current();
        onNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Couldn’t save the schedule.",
        });
      });
  };

  const current = settings
    ? `${days[settings.weekStarts - 1]} · ${settings.timeZone}`
    : null;
  const pending =
    settings?.pendingTimeZone && settings.pendingWeekStarts
      ? `${days[settings.pendingWeekStarts - 1]} · ${settings.pendingTimeZone}`
      : null;

  return (
    <>
      {manage && (
        <form className="group-schedule" onSubmit={saveSchedule}>
          <h3>Week schedule</h3>
          <p className="hint">
            {current ? `Weeks start ${current}.` : "Loading schedule…"}
            {pending
              ? ` From ${settings?.changesAt ? when(settings.changesAt) : "next week"}: ${pending}.`
              : ""}
          </p>
          <div className="group-schedule-fields">
            <label>
              Start day
              <select
                value={start}
                disabled={!settings}
                onChange={(event) => setStart(Number(event.target.value))}
              >
                {days.map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Time zone
              <select
                value={zone}
                disabled={!settings}
                onChange={(event) => setZone(event.target.value)}
              >
                {(zones.includes(zone) || !zone ? zones : [zone, ...zones]).map(
                  (name) => (
                    <option key={name} value={name}>
                      {name.replace(/_/g, " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="secondary-button"
            disabled={
              !settings ||
              (zone === (settings.pendingTimeZone ?? settings.timeZone) &&
                start === (settings.pendingWeekStarts ?? settings.weekStarts))
            }
          >
            Save schedule
          </button>
        </form>
      )}
      <details
        className="group-activity"
        onToggle={(event) => setActivityOpen(event.currentTarget.open)}
      >
        <summary>Crew activity</summary>
        {activity === null ? (
          <ul className="group-activity-list" aria-busy="true">
            <li className="skeleton skeleton-line" />
            <li className="skeleton skeleton-line" />
          </ul>
        ) : activity.length === 0 ? (
          <p className="hint">Nothing yet.</p>
        ) : (
          <ul className="group-activity-list">
            {activity.map((event) => (
              <li key={`${event.kind}:${event.at}:${event.name}`}>
                <span>{describe(event)}</span>
                <time dateTime={event.at}>{when(event.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
