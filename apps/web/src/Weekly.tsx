import type {
  CurrentWeekProgressItem,
  FinalizedWeeklyHistoryItem,
  WeeklyTargetContext,
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
  const [targetContext, setTargetContext] =
    useState<WeeklyTargetContext | null>(null);
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
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(12);
  const [logError, setLogError] = useState(false);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
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
    if (route === "/history") setHistoryLimit(12);
    const load =
      route === "/history"
        ? Promise.all([api.history(token, groupId), api.target(token)])
        : route === "/target"
          ? Promise.all([api.progress(token, groupId), api.target(token)])
          : api.progress(token, groupId);
    void load
      .then((response) => {
        if (!active) return;
        if (route === "/history") {
          const [historyResponse, targetResponse] = response as [
            Awaited<ReturnType<Api["history"]>>,
            Awaited<ReturnType<Api["target"]>>,
          ];
          setHistory(historyResponse.data as FinalizedWeeklyHistoryItem[]);
          setTargetContext(targetResponse.data as WeeklyTargetContext);
        } else if (route === "/target") {
          const [progressResponse, targetResponse] = response as [
            Awaited<ReturnType<Api["progress"]>>,
            Awaited<ReturnType<Api["target"]>>,
          ];
          setProgress(progressResponse.data);
          setTargetContext(targetResponse.data as WeeklyTargetContext);
          setTarget(
            String(
              (targetResponse.data as WeeklyTargetContext).recurringTarget,
            ),
          );
        } else
          setProgress(
            (response as Awaited<ReturnType<Api["progress"]>>)
              .data as CurrentWeekProgressItem[],
          );
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
  const boundary = targetContext?.nextWeekStartsAt
    ? new Date(targetContext.nextWeekStartsAt)
    : null;
  const boundaryDate =
    boundary && targetContext
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: targetContext.timeZone,
          month: "short",
          day: "numeric",
        }).format(boundary)
      : null;
  const boundaryWithWeekday =
    boundary && targetContext && boundaryDate
      ? `${new Intl.DateTimeFormat("en-US", {
          timeZone: targetContext.timeZone,
          weekday: "short",
        }).format(boundary)} ${boundaryDate}`
      : null;
  const targetCount = Number(target);
  const targetWarning =
    Number.isSafeInteger(targetCount) &&
    targetContext &&
    (targetCount >= 10 || targetCount >= targetContext.recurringTarget + 3);
  const savedTargetText = (weeklyTarget: number) =>
    boundaryDate
      ? `Saved. From ${boundaryDate} your target is ${weeklyTarget}.`
      : "Saved. This becomes your first target.";
  const historyWeeks = [...new Set(history.map((item) => item.startsAt))].sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  );
  const selectedHistory = selectedWeek
    ? history.filter((item) => item.startsAt === selectedWeek)
    : [];
  const ownHistory = (startsAt: string) =>
    history.find(
      (item) =>
        item.startsAt === startsAt &&
        item.membershipId === membership.membershipId,
    );
  const historyRange = (item: FinalizedWeeklyHistoryItem) => {
    const timeZone = targetContext?.timeZone;
    const start = new Date(item.startsAt);
    const end = new Date(Date.parse(item.endsAt) - 1);
    const startMonth = new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone,
    }).format(start);
    const endMonth = new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone,
    }).format(end);
    const startDay = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      timeZone,
    }).format(start);
    const endDay = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      timeZone,
    }).format(end);
    return startMonth === endMonth
      ? `${startMonth} ${startDay} – ${endDay}`
      : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
  };
  const nextWeekBoundary = targetContext?.nextWeekStartsAt
    ? new Date(targetContext.nextWeekStartsAt)
    : null;
  const emptyHistoryClose =
    nextWeekBoundary && targetContext
      ? `${new Intl.DateTimeFormat("en-US", {
          timeZone: targetContext.timeZone,
          weekday: "long",
        }).format(new Date(nextWeekBoundary.getTime() - 1))} at ${(() => {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: targetContext.timeZone,
            hour: "numeric",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(nextWeekBoundary);
          const hour = parts.find((part) => part.type === "hour")?.value;
          const minute = parts.find((part) => part.type === "minute")?.value;
          return hour === "00" && minute === "00"
            ? "midnight"
            : new Intl.DateTimeFormat("en-US", {
                timeZone: targetContext.timeZone,
                hour: "numeric",
                minute: "2-digit",
              }).format(nextWeekBoundary);
        })()}`
      : null;
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
        ) : route === "/history" ? (
          <div
            className="history-skeleton"
            role="status"
            aria-label="Loading history"
          >
            {[
              "one",
              "two",
              "three",
              "four",
              "five",
              "six",
              "seven",
              "eight",
            ].map((key) => (
              <span className="skeleton" key={key} />
            ))}
          </div>
        ) : (
          <p role="status">Loading weekly progress…</p>
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
        ) : route === "/history" ? (
          <div className="history-load-error">
            <p role="alert">Couldn&apos;t load your history.</p>
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
                  <a
                    className="own-target-link"
                    href="/target"
                    aria-label={`${own.completedWorkoutCount} of ${own.lockedTarget} workouts. Change weekly target.`}
                  >
                    <Barbell
                      count={own.completedWorkoutCount}
                      target={own.lockedTarget}
                      size="big"
                      activityTypes={own.activityTypes}
                    />
                  </a>
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
              <p className="target-lock-copy">
                {targetContext?.memberCount === 1
                  ? "Your week starts when a friend joins. This becomes your first target."
                  : targetContext && boundaryWithWeekday
                    ? `This week is locked at ${targetContext.lockedTarget}. Changes start next week, ${boundaryWithWeekday}.`
                    : "Your target timing is unavailable."}
              </p>
              <form
                className="target-form"
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
                        text: savedTargetText(response.data.weeklyTarget),
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
                          text: savedTargetText(response.data.weeklyTarget),
                        });
                      }
                    })
                    .catch(updateError)
                    .finally(() => setBusy(false));
                }}
              >
                <fieldset className="target-control">
                  <legend>Weekly target</legend>
                  <button
                    className="target-adjust"
                    type="button"
                    aria-label="Decrease weekly target"
                    disabled={busy || targetCount <= 1}
                    onClick={() =>
                      setTarget(String(Math.max(1, targetCount - 1)))
                    }
                  >
                    −
                  </button>
                  <output aria-live="polite">
                    <strong>{target}</strong>
                    <span>workouts a week</span>
                  </output>
                  <button
                    className="target-adjust"
                    type="button"
                    aria-label="Increase weekly target"
                    disabled={busy}
                    onClick={() => setTarget(String(targetCount + 1))}
                  >
                    +
                  </button>
                </fieldset>
                {targetWarning && (
                  <p className="target-warning" role="status">
                    This is an unusually high target or a sharp jump. Choose
                    what feels sustainable; you can lower it for any future
                    week.
                  </p>
                )}
                <button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save for next week"}
                </button>
                <p className="target-guidance">
                  We suggest at least 2. There’s no reward for a higher number.
                </p>
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
              <h2>The rack</h2>
              {historyWeeks.length ? (
                <>
                  <ul className="history-rack" aria-label="Finalized weeks">
                    {historyWeeks.slice(0, historyLimit).map((startsAt) => {
                      const item = ownHistory(startsAt);
                      if (!item) return null;
                      const met = item.outcome === "attained";
                      const range = historyRange(item);
                      return (
                        <li key={startsAt}>
                          <button
                            type="button"
                            className={`history-plate${met ? " met" : " missed"}`}
                            aria-label={`${range}: ${item.completedWorkoutCount}/${item.lockedTarget}, ${met ? "Met" : "Missed"}`}
                            onClick={(event) => {
                              historyOpenerRef.current = event.currentTarget;
                              setSelectedWeek(startsAt);
                            }}
                          >
                            <span
                              className="history-plate-hole"
                              aria-hidden="true"
                            />
                            <strong>
                              {item.completedWorkoutCount}/{item.lockedTarget}
                            </strong>
                          </button>
                          <span className="history-caption">
                            {range}
                            <strong className="history-outcome">
                              {met ? "Met" : "Missed"}
                            </strong>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {historyLimit < historyWeeks.length && (
                    <button
                      type="button"
                      className="history-older"
                      onClick={() => setHistoryLimit((limit) => limit + 12)}
                    >
                      Show older weeks
                    </button>
                  )}
                  <Sheet
                    open={Boolean(selectedHistory[0])}
                    title={
                      selectedHistory[0] ? historyRange(selectedHistory[0]) : ""
                    }
                    onDismiss={() => {
                      setSelectedWeek(null);
                      requestAnimationFrame(() =>
                        historyOpenerRef.current?.focus(),
                      );
                    }}
                  >
                    {selectedHistory[0] && (
                      <>
                        {(() => {
                          const item = selectedHistory.find(
                            (week) =>
                              week.membershipId === membership.membershipId,
                          );
                          return item ? (
                            <p className="history-own-outcome">
                              You{" "}
                              {item.outcome === "attained"
                                ? "met it"
                                : "missed it"}
                              : {item.completedWorkoutCount} of{" "}
                              {item.lockedTarget}.
                            </p>
                          ) : null;
                        })()}
                        <ul className="history-detail">
                          {selectedHistory.map((item) => (
                            <li key={item.membershipId}>
                              <span>{item.displayName}</span>
                              <span>
                                {item.completedWorkoutCount}/{item.lockedTarget}{" "}
                                ·{" "}
                                {item.outcome === "attained" ? "Met" : "Missed"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Sheet>
                </>
              ) : (
                <div className="history-empty">
                  <h3>Nothing on the rack yet.</h3>
                  <p>
                    Your first week lands here when it closes
                    {emptyHistoryClose ? ` on ${emptyHistoryClose}` : ""}.
                  </p>
                </div>
              )}
            </>
          )}
          {result}
        </>
      )}
    </section>
  );
}
