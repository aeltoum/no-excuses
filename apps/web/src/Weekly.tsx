import type {
  CurrentWeekProgressItem,
  FinalizedWeeklyHistoryItem,
} from "@no-excuses/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError, type createApiClient } from "./api-client";
import { Barbell } from "./Barbell";
import { Sheet } from "./Sheet";

type Api = ReturnType<typeof createApiClient>;
type Route = "/home" | "/target" | "/history";
type Notice = { kind: "success" | "error"; text: string } | null;

export function Weekly({
  route,
  api,
  token,
  membership,
  onRevoked,
}: {
  route: Route;
  api: Api;
  token: string;
  membership: { groupId: string; membershipId: string } | null;
  onRevoked: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [progress, setProgress] = useState<CurrentWeekProgressItem[]>([]);
  const [history, setHistory] = useState<FinalizedWeeklyHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState("");
  const [activityType, setActivityType] = useState<
    "strength" | "cardio" | "class" | "sport" | "mixed" | null
  >(null);
  const [duration, setDuration] = useState("");
  const [otherDuration, setOtherDuration] = useState(false);
  const [intensity, setIntensity] = useState<"low" | "moderate" | "high">(
    "moderate",
  );
  const [attested, setAttested] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logError, setLogError] = useState(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const revokeRef = useRef(onRevoked);
  revokeRef.current = onRevoked;
  const groupId = membership?.groupId;
  const draft = useRef<{
    signature: string;
    key: string;
    id: string;
    completedAt: string;
  } | null>(null);
  const targetDraft = useRef<{ signature: string; key: string } | null>(null);
  const updateError = (error: unknown) => {
    if (error instanceof ApiError && error.kind === "unauthorized") onRevoked();
    setNotice({
      kind: "error",
      text:
        error instanceof ApiError ? error.message : "Action failed. Try again.",
    });
  };
  useEffect(() => {
    if (notice) resultRef.current?.focus();
  }, [notice]);
  useEffect(() => {
    void retry;
    let active = true;
    setState("loading");
    if (!groupId) {
      setProgress([]);
      setHistory([]);
      setState("ready");
      return;
    }
    const load =
      route === "/history"
        ? api.history(token, groupId)
        : api.progress(token, groupId);
    void load
      .then((response) => {
        if (!active) return;
        if (route === "/history")
          setHistory(response.data as FinalizedWeeklyHistoryItem[]);
        else setProgress(response.data as CurrentWeekProgressItem[]);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setState("error");
        if (error instanceof ApiError && error.kind === "unauthorized")
          revokeRef.current();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Action failed. Try again.",
        });
      });
    return () => {
      active = false;
    };
  }, [api, token, groupId, route, retry]);
  const refresh = () => {
    setNotice(null);
    setRefreshWarning(false);
    setRetry((value) => value + 1);
  };
  const refreshCount = () => {
    if (!groupId || busy) return;
    setBusy(true);
    void api
      .progress(token, groupId)
      .then((response) => {
        setProgress(response.data);
        setRefreshWarning(false);
        setNotice({
          kind: "success",
          text:
            route === "/target"
              ? "Progress refreshed. Review current locked target above."
              : "Workout saved. Current count refreshed.",
        });
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setRefreshWarning(true);
      })
      .finally(() => setBusy(false));
  };
  const result = notice && (
    <p
      className={`result ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      tabIndex={-1}
      ref={resultRef}
    >
      {notice.text}
    </p>
  );
  if (!membership)
    return (
      <section className="hero">
        <p className="eyebrow">Private Group</p>
        <h1>Join a Group</h1>
        <p className="lead">
          Create or join a Group to start weekly accountability.
        </p>
        <a className="primary-action" href="/group">
          Go to Group
        </a>
      </section>
    );
  const own = progress.find(
    (item) => item.membershipId === membership.membershipId,
  );
  const home = route === "/home";
  const logReady =
    activityType !== null &&
    Number.isSafeInteger(Number(duration)) &&
    Number(duration) >= 1 &&
    attested;
  return (
    <section className={`hero${home ? " home" : ""}`}>
      {home ? (
        <header className="home-header">
          <h1>Our week</h1>
          <span>Self-reported</span>
        </header>
      ) : (
        <>
          <p className="eyebrow">True MVP · Self-reported</p>
          <h1>{route === "/target" ? "Weekly target" : "Your history"}</h1>
          <p className="lead">
            Workouts are self-reported. Friends see your count; nobody
            independently verifies check-ins.
          </p>
        </>
      )}
      {state === "loading" ? (
        home ? (
          <div
            className="home-skeleton"
            role="status"
            aria-label="Loading weekly progress"
          >
            <span className="skeleton skeleton-bar" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-button" />
            <span className="skeleton skeleton-row" />
            <span className="skeleton skeleton-row" />
          </div>
        ) : (
          <p role="status">
            Loading {route === "/history" ? "history" : "weekly progress"}…
          </p>
        )
      ) : state === "error" ? (
        home ? (
          <div className="home-load-error">
            <div role="alert">
              <strong>Couldn’t load this week.</strong>
              <span className="home-load-error-message">
                Check your connection, then try again.
              </span>
            </div>
            <button type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : (
          <div>
            {result}
            <button type="button" onClick={refresh}>
              Retry loading
            </button>
          </div>
        )
      ) : (
        <>
          {route === "/home" && (
            <>
              {own ? (
                <div className="own-progress">
                  <Barbell
                    count={own.completedWorkoutCount}
                    target={own.lockedTarget}
                    size="big"
                    activityTypes={own.activityTypes}
                  />
                  <p className="home-count">
                    {own.completedWorkoutCount} of {own.lockedTarget} this week
                  </p>
                  <ul className="activity-legend" aria-label="Activity colours">
                    {(
                      ["strength", "cardio", "class", "sport", "mixed"] as const
                    ).map((activity) => (
                      <li key={activity}>
                        <span
                          className={`activity-swatch activity-${activity}`}
                        />
                        {activity[0].toUpperCase() + activity.slice(1)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="solo-week">
                  <Barbell count={0} target={0} size="big" />
                  <h2>Waiting for a second member</h2>
                  <p>
                    Accountability and workouts begin once a second member joins
                    your Group.
                  </p>
                </div>
              )}
              {own && progress.length > 1 && (
                <ul className="friend-progress" aria-label="Friends this week">
                  {progress
                    .filter(
                      (item) => item.membershipId !== membership.membershipId,
                    )
                    .map((item) => (
                      <li key={item.membershipId}>
                        <strong>{item.displayName}</strong>
                        <Barbell
                          count={item.completedWorkoutCount}
                          target={item.lockedTarget}
                          size="mini"
                          activityTypes={item.activityTypes}
                        />
                        <span>
                          {item.completedWorkoutCount}/{item.lockedTarget}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {own && (
                <>
                  <button
                    className="home-log-button"
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setSheetOpen(true);
                    }}
                  >
                    Log workout
                  </button>
                  <Sheet
                    open={sheetOpen}
                    title="Log a workout"
                    dismissible={!busy}
                    onDismiss={() => setSheetOpen(false)}
                  >
                    <div className="sheet-preview">
                      <Barbell
                        count={
                          own.completedWorkoutCount + (activityType ? 1 : 0)
                        }
                        target={own.lockedTarget}
                        size="big"
                        activityTypes={
                          activityType
                            ? [...own.activityTypes, activityType]
                            : own.activityTypes
                        }
                      />
                      <p>
                        {activityType
                          ? `This one makes ${own.completedWorkoutCount + 1} of ${own.lockedTarget}.`
                          : "Pick what you did to load a plate."}
                      </p>
                    </div>
                    <form
                      className="log-sheet-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (busy || !logReady || !activityType) return;
                        const minutes = Number(duration);
                        const signature = `${membership.membershipId}:${activityType}:${minutes}:${intensity}`;
                        if (
                          !draft.current ||
                          draft.current.signature !== signature
                        )
                          draft.current = {
                            signature,
                            key: crypto.randomUUID(),
                            id: crypto.randomUUID(),
                            completedAt: new Date().toISOString(),
                          };
                        const current = draft.current;
                        setBusy(true);
                        setLogError(false);
                        void api
                          .checkIn(
                            token,
                            {
                              workoutCheckinId: current.id,
                              activityType,
                              completedAt: current.completedAt,
                              durationMinutes: minutes,
                              perceivedIntensity: intensity,
                              selfReportAttested: true,
                            },
                            current.key,
                          )
                          .then(async (response) => {
                            if (response.data.workoutCheckinId !== current.id)
                              throw new ApiError(
                                "failure",
                                "Check-in response did not match this workout.",
                              );
                            draft.current = null;
                            const loggedActivity = activityType;
                            setProgress((items) =>
                              items.map((item) =>
                                item.membershipId === membership.membershipId
                                  ? {
                                      ...item,
                                      completedWorkoutCount:
                                        response.data.currentWeekCount,
                                      activityTypes: [
                                        ...item.activityTypes,
                                        loggedActivity,
                                      ],
                                    }
                                  : item,
                              ),
                            );
                            setSheetOpen(false);
                            setActivityType(null);
                            setDuration("");
                            setOtherDuration(false);
                            setAttested(false);
                            setNotice({
                              kind: "success",
                              text: `Workout logged. ${response.data.currentWeekCount} of ${own.lockedTarget} this week.`,
                            });
                            try {
                              setProgress(
                                (await api.progress(token, membership.groupId))
                                  .data,
                              );
                              setRefreshWarning(false);
                            } catch (error) {
                              if (
                                error instanceof ApiError &&
                                error.kind === "unauthorized"
                              )
                                onRevoked();
                              setRefreshWarning(true);
                            }
                          })
                          .catch((error) => {
                            if (
                              error instanceof ApiError &&
                              error.kind === "unauthorized"
                            )
                              onRevoked();
                            setLogError(true);
                          })
                          .finally(() => setBusy(false));
                      }}
                    >
                      <fieldset>
                        <legend>What did you do?</legend>
                        <div className="activity-plates">
                          {(
                            [
                              "strength",
                              "cardio",
                              "class",
                              "sport",
                              "mixed",
                            ] as const
                          ).map((activity) => (
                            <button
                              type="button"
                              key={activity}
                              className={`activity-plate activity-${activity}`}
                              aria-pressed={activityType === activity}
                              disabled={busy}
                              onClick={() => setActivityType(activity)}
                            >
                              {activity[0].toUpperCase() + activity.slice(1)}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset>
                        <legend>How long?</legend>
                        <div className="choice-chips">
                          {[20, 30, 45, 60, 90].map((minutes) => (
                            <button
                              type="button"
                              key={minutes}
                              aria-pressed={
                                !otherDuration && duration === String(minutes)
                              }
                              disabled={busy}
                              onClick={() => {
                                setOtherDuration(false);
                                setDuration(String(minutes));
                              }}
                            >
                              {minutes} min
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-pressed={otherDuration}
                            disabled={busy}
                            onClick={() => {
                              setOtherDuration(true);
                              setDuration("");
                            }}
                          >
                            Other
                          </button>
                        </div>
                      </fieldset>
                      {otherDuration && (
                        <label>
                          Duration in minutes
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={duration}
                            disabled={busy}
                            onChange={(event) =>
                              setDuration(event.target.value)
                            }
                          />
                        </label>
                      )}
                      <fieldset>
                        <legend>How hard did it feel?</legend>
                        <div className="intensity-control">
                          {(["low", "moderate", "high"] as const).map(
                            (level) => (
                              <button
                                type="button"
                                key={level}
                                aria-pressed={intensity === level}
                                disabled={busy}
                                onClick={() => setIntensity(level)}
                              >
                                {level[0].toUpperCase() + level.slice(1)}
                              </button>
                            ),
                          )}
                        </div>
                      </fieldset>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={attested}
                          onChange={(event) =>
                            setAttested(event.target.checked)
                          }
                          disabled={busy}
                        />
                        I did this workout. It's my own self-report.
                      </label>
                      <button type="submit" disabled={busy || !logReady}>
                        {busy ? "Logging…" : "Log workout"}
                      </button>
                      {!logReady && (
                        <p className="sheet-hint">
                          Pick an activity and a time to log it.
                        </p>
                      )}
                      {logError && (
                        <p className="result error" role="alert">
                          Couldn't log it — the connection dropped. Your choices
                          are kept; try again.
                        </p>
                      )}
                    </form>
                  </Sheet>
                </>
              )}
              {refreshWarning && (
                <button type="button" onClick={refreshCount} disabled={busy}>
                  {busy ? "Refreshing…" : "Refresh count"}
                </button>
              )}
            </>
          )}
          {route === "/target" && (
            <>
              <p>
                Current locked target:{" "}
                <strong>
                  {own ? `${own.lockedTarget} workouts` : "No active week"}
                </strong>
                .
              </p>
              <p>
                Target changes are scheduled by Group rules. Current locked week
                may stay unchanged.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  const count = Number(target);
                  if (!Number.isSafeInteger(count) || count < 1) {
                    setNotice({
                      kind: "error",
                      text: "Enter a valid target of at least one workout.",
                    });
                    return;
                  }
                  const signature = `${membership.membershipId}:${count}`;
                  if (
                    !targetDraft.current ||
                    targetDraft.current.signature !== signature
                  )
                    targetDraft.current = {
                      signature,
                      key: crypto.randomUUID(),
                    };
                  setBusy(true);
                  setNotice(null);
                  void api
                    .setTarget(token, count, targetDraft.current.key)
                    .then(async (response) => {
                      if (
                        response.data.membershipId !== membership.membershipId
                      )
                        throw new ApiError(
                          "failure",
                          "Target response did not match this membership.",
                        );
                      targetDraft.current = null;
                      setNotice({
                        kind: "success",
                        text: `Weekly target set to ${response.data.weeklyTarget}. Current locked week may stay unchanged.`,
                      });
                      try {
                        setProgress(
                          (await api.progress(token, membership.groupId)).data,
                        );
                        setRefreshWarning(false);
                      } catch (error) {
                        if (
                          error instanceof ApiError &&
                          error.kind === "unauthorized"
                        )
                          onRevoked();
                        setRefreshWarning(true);
                        setNotice({
                          kind: "success",
                          text: `Weekly target set to ${response.data.weeklyTarget}. Current progress unavailable; refresh progress to see latest state.`,
                        });
                      }
                    })
                    .catch(updateError)
                    .finally(() => setBusy(false));
                }}
              >
                <h2>Set Weekly target</h2>
                <label>
                  Workouts per week
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save target"}
                </button>
              </form>
              {refreshWarning && (
                <button type="button" onClick={refreshCount} disabled={busy}>
                  {busy ? "Refreshing…" : "Refresh progress"}
                </button>
              )}
            </>
          )}
          {route === "/history" && (
            <>
              <h2>Finalized weeks</h2>
              {history.length ? (
                <ul className="progress-list">
                  {history.map((item) => (
                    <li key={`${item.membershipId}:${item.startsAt}`}>
                      <div>
                        <strong>
                          {item.membershipId === membership.membershipId
                            ? "You"
                            : item.displayName}
                        </strong>
                        <br />
                        <time dateTime={item.startsAt}>
                          {new Date(item.startsAt).toLocaleDateString()}
                        </time>{" "}
                        –{" "}
                        <time dateTime={item.endsAt}>
                          {new Date(item.endsAt).toLocaleDateString()}
                        </time>
                      </div>
                      <span>
                        {item.outcome === "attained" ? "Met" : "Missed"} ·{" "}
                        {item.completedWorkoutCount} / {item.lockedTarget}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No finalized weekly history yet. Results appear after a week
                  closes.
                </p>
              )}
            </>
          )}
          {result}
        </>
      )}
    </section>
  );
}
