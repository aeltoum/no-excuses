import type {
  CurrentWeekProgressItem,
  FinalizedWeeklyHistoryItem,
  WeeklyTargetContext,
} from "@no-excuses/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type createApiClient } from "./api-client";
import { Barbell } from "./Barbell";
import { Consequences } from "./Consequences";
import { InstallPrompt } from "./InstallPrompt";
import { compressPhoto, type ProofItem, uploadProofPhoto } from "./proof";
import { Result, useNotice } from "./Result";
import { Sheet } from "./Sheet";
import { ProofFeed } from "./Wall";

type Api = ReturnType<typeof createApiClient>;
type Route = "/home" | "/target" | "/history";
export type WeeklySnapshot = {
  progress: CurrentWeekProgressItem[];
  history: FinalizedWeeklyHistoryItem[];
  targetContext: WeeklyTargetContext | null;
  syncedAt: number;
};

type ProofPhoto = { id: string; blob: Blob; url: string };

export function Weekly({
  apiBaseUrl,
  onNavigate,
  onAttention,
  route,
  api,
  token,
  membership,
  onRevoked,
  cache,
  cacheKey,
}: {
  apiBaseUrl: string;
  onAttention: (count: number) => void;
  onNavigate: (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => void;
  route: Route;
  api: Api;
  token: string;
  membership: { groupId: string; membershipId: string } | null;
  onRevoked: () => void;
  cache: Map<string, WeeklySnapshot>;
  cacheKey: string;
}) {
  const saved = cache.get(cacheKey);
  const [state, setState] = useState<"loading" | "ready" | "error">(
    saved ? "ready" : "loading",
  );
  const [progress, setProgress] = useState<CurrentWeekProgressItem[]>(
    saved?.progress ?? [],
  );
  const [history, setHistory] = useState<FinalizedWeeklyHistoryItem[]>(
    saved?.history ?? [],
  );
  const [stale, setStale] = useState(false);
  const [changed, setChanged] = useState(false);
  const changedTimer = useRef<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useNotice();
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState(
    saved?.targetContext ? String(saved.targetContext.recurringTarget) : "",
  );
  const [targetContext, setTargetContext] =
    useState<WeeklyTargetContext | null>(saved?.targetContext ?? null);
  const [activityType, setActivityType] = useState<
    "strength" | "cardio" | "class" | "sport" | "mixed" | null
  >(null);
  const [duration, setDuration] = useState("");
  const [otherDuration, setOtherDuration] = useState(false);
  const [intensity, setIntensity] = useState<"low" | "moderate" | "high">(
    "moderate",
  );
  const [attested, setAttested] = useState(false);
  const [photos, setPhotos] = useState<{
    activity?: ProofPhoto;
    presence?: ProofPhoto;
  }>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const uploaded = useRef(new Map<string, string>());
  const [feedRevision, setFeedRevision] = useState(0);
  const [awaitingReview, setAwaitingReview] = useState<Set<string>>(
    () => new Set(),
  );
  const [docked, setDocked] = useState(false);
  const [groupOwed, setGroupOwed] = useState<Record<string, number>>({});
  const [feedAttention, setFeedAttention] = useState(0);
  const [cardAttention, setCardAttention] = useState(0);
  useEffect(() => {
    if (route === "/home") onAttention(feedAttention + cardAttention);
  }, [route, feedAttention, cardAttention, onAttention]);
  const heroRef = useRef<HTMLDivElement>(null);
  const feedRevoked = useCallback(() => revokeRef.current(), []);
  const feedItems = useCallback((items: ProofItem[]) => {
    setFeedAttention(
      items.filter((item) => item.canReview || item.canVote).length,
    );
    setAwaitingReview(
      new Set(
        items
          .filter((item) => item.canReview || item.canVote)
          .map((item) => item.authorMembershipId),
      ),
    );
  }, []);
  // The big barbell docks into a slim header once it scrolls out of view.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setDocked(!entry?.isIntersecting),
    );
    observer.observe(hero);
    return () => observer.disconnect();
  });
  const choosePhoto =
    (kind: "activity" | "presence") =>
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setPhotoError(null);
      try {
        const blob = await compressPhoto(file);
        setPhotos((current) => {
          if (current[kind]) URL.revokeObjectURL(current[kind].url);
          return {
            ...current,
            [kind]: {
              id: crypto.randomUUID(),
              blob,
              url: URL.createObjectURL(blob),
            },
          };
        });
      } catch {
        setPhotoError("Couldn’t use that photo. Take another one.");
      }
    };
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(12);
  const [logError, setLogError] = useState<string | null>(null);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef(onRevoked);
  revokeRef.current = onRevoked;
  const groupId = membership?.groupId;
  const draft = useRef<{
    signature: string;
    key: string;
    id: string;
  } | null>(null);
  const targetDraft = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    if (state !== "ready") return;
    const current = cache.get(cacheKey);
    if (current)
      cache.set(cacheKey, { ...current, progress, history, targetContext });
  }, [cache, cacheKey, state, progress, history, targetContext]);
  const updateError = (error: unknown) => {
    if (error instanceof ApiError && error.kind === "unauthorized") onRevoked();
    setNotice({
      kind: "error",
      text:
        error instanceof ApiError ? error.message : "Action failed. Try again.",
    });
  };
  useEffect(() => {
    void retry;
    let active = true;
    const previous = cache.get(cacheKey);
    if (!previous) setState("loading");
    if (!groupId) {
      setProgress([]);
      setHistory([]);
      setState("ready");
      return;
    }
    if (!previous && route === "/history") setHistoryLimit(12);
    const early = previous ? undefined : inflight.get(cacheKey);
    inflight.delete(cacheKey);
    void (
      early?.token === token
        ? early.load
        : loadWeekly(api, token, groupId, route, previous)
    )
      .then((next) => {
        if (!active) return;
        const differs =
          !previous ||
          JSON.stringify({ ...previous, syncedAt: 0 }) !==
            JSON.stringify({ ...next, syncedAt: 0 });
        cache.set(cacheKey, next);
        if (differs) {
          setProgress(next.progress);
          setHistory(next.history);
          setTargetContext(next.targetContext);
          if (route === "/target" && next.targetContext)
            setTarget((current) =>
              !previous ||
              current === String(previous.targetContext?.recurringTarget ?? "")
                ? String(next.targetContext?.recurringTarget ?? "")
                : current,
            );
          if (previous) {
            setChanged(true);
            window.clearTimeout(changedTimer.current);
            changedTimer.current = window.setTimeout(
              () => setChanged(false),
              180,
            );
          }
        }
        setStale(false);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (previous) {
          setStale(true);
        } else setState("error");
        if (error instanceof ApiError && error.kind === "unauthorized")
          revokeRef.current();
        if (!previous)
          setNotice({
            persistent: true,
            kind: "error",
            text:
              error instanceof ApiError
                ? error.message
                : "Action failed. Try again.",
          });
      });
    return () => {
      active = false;
      window.clearTimeout(changedTimer.current);
    };
  }, [api, token, groupId, route, retry, cache, cacheKey, setNotice]);
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
  const result = <Result notice={notice} />;
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
    photos.activity !== undefined &&
    photos.presence !== undefined &&
    attested;
  return (
    <section
      className={`hero${home ? " home" : ""}${saved ? " data-cached" : ""}${changed ? " data-updated" : ""}`}
    >
      {home ? (
        <header className="home-header">
          <h1>Our week</h1>
          <span>Proof required</span>
        </header>
      ) : (
        <>
          <p className="eyebrow">Proof required</p>
          <h1>{route === "/target" ? "Weekly target" : "Your history"}</h1>
          <p className="lead">
            Every workout needs proof photos. Only workouts your friends verify,
            or that go unquestioned for 24 hours, count.
          </p>
        </>
      )}
      {state === "ready" && stale && (
        <div className="data-freshness">
          <span>Showing saved data</span>
          <button className="data-retry" type="button" onClick={refresh}>
            Try again
          </button>
        </div>
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
              <InstallPrompt />
              {own && (
                <div
                  className={`week-dock${docked ? " on" : ""}`}
                  aria-hidden="true"
                >
                  <Barbell
                    count={own.completedWorkoutCount}
                    target={own.lockedTarget}
                    size="mini"
                    activityTypes={own.activityTypes}
                  />
                  <strong>
                    {own.completedWorkoutCount} of {own.lockedTarget}
                  </strong>
                </div>
              )}
              {own ? (
                <div className="own-progress" ref={heroRef}>
                  <a
                    className="own-target-link"
                    href="/target"
                    onClick={(event) => onNavigate(event, "/target")}
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
                  <a
                    className="home-target-link"
                    href="/target"
                    onClick={(event) => onNavigate(event, "/target")}
                  >
                    Change target
                  </a>
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
                  <a
                    className="home-target-link"
                    href="/target"
                    onClick={(event) => onNavigate(event, "/target")}
                  >
                    Change target
                  </a>
                </div>
              )}
              {own && (
                <Consequences
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  onRevoked={feedRevoked}
                  onGroupOwed={setGroupOwed}
                  onAttention={setCardAttention}
                />
              )}
              {own && progress.length > 1 && (
                <ul className="friend-cards" aria-label="Friends this week">
                  {progress
                    .filter(
                      (item) => item.membershipId !== membership.membershipId,
                    )
                    .map((item) => (
                      <li
                        key={item.membershipId}
                        className={
                          awaitingReview.has(item.membershipId)
                            ? "awaiting-review"
                            : undefined
                        }
                      >
                        <strong className="friend-card-name">
                          {item.displayName}
                        </strong>
                        <Barbell
                          count={item.completedWorkoutCount}
                          target={item.lockedTarget}
                          size="mini"
                          activityTypes={item.activityTypes}
                        />
                        <span>
                          {item.completedWorkoutCount}/{item.lockedTarget}
                          {groupOwed[item.membershipId]
                            ? ` · owes ${groupOwed[item.membershipId]}`
                            : ""}
                          {awaitingReview.has(item.membershipId) && " · review"}
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
                    aria-label="Log workout"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setSheetOpen(true);
                    }}
                  >
                    <span className="log-plus" aria-hidden="true">
                      +
                    </span>{" "}
                    Log
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
                        if (
                          busy ||
                          !logReady ||
                          !activityType ||
                          !photos.activity ||
                          !photos.presence
                        )
                          return;
                        const minutes = Number(duration);
                        const activityPhoto = photos.activity;
                        const presencePhoto = photos.presence;
                        const signature = `${membership.membershipId}:${activityType}:${minutes}:${intensity}:${activityPhoto.id}:${presencePhoto.id}`;
                        if (
                          !draft.current ||
                          draft.current.signature !== signature
                        )
                          draft.current = {
                            signature,
                            key: crypto.randomUUID(),
                            id: crypto.randomUUID(),
                          };
                        const current = draft.current;
                        setBusy(true);
                        setLogError(null);
                        // Uploaded paths are reused on retry so a failed submit never re-uploads.
                        const upload = async (
                          kind: "activity" | "presence",
                          photo: ProofPhoto,
                        ) => {
                          const known = uploaded.current.get(photo.id);
                          if (known) return known;
                          const path = await uploadProofPhoto(
                            apiBaseUrl,
                            token,
                            kind,
                            photo.blob,
                          );
                          uploaded.current.set(photo.id, path);
                          return path;
                        };
                        void Promise.all([
                          upload("activity", activityPhoto),
                          upload("presence", presencePhoto),
                        ])
                          .then(([activityPhotoPath, presencePhotoPath]) =>
                            api.checkIn(
                              token,
                              {
                                workoutCheckinId: current.id,
                                activityType,
                                durationMinutes: minutes,
                                perceivedIntensity: intensity,
                                selfReportAttested: true,
                                activityPhotoPath,
                                presencePhotoPath,
                                mediaConsent: true,
                              },
                              current.key,
                            ),
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
                            URL.revokeObjectURL(activityPhoto.url);
                            URL.revokeObjectURL(presencePhoto.url);
                            setPhotos({});
                            setFeedRevision((value) => value + 1);
                            setNotice({
                              kind: "success",
                              text: `Workout logged. ${response.data.currentWeekCount} of ${own.lockedTarget} this week. It counts once a friend verifies it or 24 hours pass.`,
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
                            setLogError(
                              error instanceof ApiError
                                ? error.message
                                : "Workout could not be logged.",
                            );
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
                      <fieldset>
                        <legend>Proof photos</legend>
                        <div className="proof-capture">
                          {(
                            [
                              [
                                "activity",
                                "Activity photo",
                                "environment",
                                "Your equipment, trail, class, or machine.",
                              ],
                              [
                                "presence",
                                "You at the workout",
                                "user",
                                "Any part of you. Your call how much.",
                              ],
                            ] as const
                          ).map(([kind, title, facing, hint]) => (
                            <label className="proof-capture-slot" key={kind}>
                              {photos[kind] ? (
                                <img
                                  src={photos[kind].url}
                                  alt={
                                    kind === "activity"
                                      ? "Activity preview"
                                      : "Your presence preview"
                                  }
                                />
                              ) : (
                                <span
                                  className="proof-capture-plus"
                                  aria-hidden="true"
                                >
                                  +
                                </span>
                              )}
                              <strong>
                                {photos[kind]
                                  ? `Retake ${title.toLowerCase()}`
                                  : title}
                              </strong>
                              <small>{hint}</small>
                              <input
                                type="file"
                                accept="image/*"
                                capture={facing}
                                disabled={busy}
                                onChange={(event) =>
                                  void choosePhoto(kind)(event)
                                }
                              />
                            </label>
                          ))}
                        </div>
                        {photoError && (
                          <p className="result error" role="alert">
                            {photoError}
                          </p>
                        )}
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
                        I did this workout. My Group can review these photos,
                        and verified ones stay on the Wall for 90 days.
                      </label>
                      <button type="submit" disabled={busy || !logReady}>
                        {busy ? "Logging…" : "Log workout"}
                      </button>
                      {!logReady && (
                        <p className="sheet-hint">
                          Pick an activity and a time, take both photos, and
                          confirm.
                        </p>
                      )}
                      {logError && (
                        <p className="result error" role="alert">
                          {logError} Your choices are kept; try again.
                        </p>
                      )}
                    </form>
                  </Sheet>
                </>
              )}
              {refreshWarning && (
                <button
                  className="secondary-button home-refresh-button"
                  type="button"
                  onClick={refreshCount}
                  disabled={busy}
                >
                  {busy ? "Refreshing…" : "Refresh count"}
                </button>
              )}
              {own && (
                <ProofFeed
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  revision={feedRevision}
                  onRevoked={feedRevoked}
                  onItems={feedItems}
                />
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
                  {busy
                    ? "Saving…"
                    : targetContext?.memberCount === 1
                      ? "Save first target"
                      : "Save for next week"}
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

export async function loadWeekly(
  api: Api,
  token: string,
  groupId: string,
  route: Route,
  previous?: WeeklySnapshot,
): Promise<WeeklySnapshot> {
  const next: WeeklySnapshot = {
    progress: previous?.progress ?? [],
    history: previous?.history ?? [],
    targetContext: previous?.targetContext ?? null,
    syncedAt: Date.now(),
  };
  if (route === "/history") {
    const [historyResponse, targetResponse] = await Promise.all([
      api.history(token, groupId),
      api.target(token),
    ]);
    next.history = historyResponse.data as FinalizedWeeklyHistoryItem[];
    next.targetContext = targetResponse.data as WeeklyTargetContext;
  } else if (route === "/target") {
    const [progressResponse, targetResponse] = await Promise.all([
      api.progress(token, groupId),
      api.target(token),
    ]);
    next.progress = progressResponse.data;
    next.targetContext = targetResponse.data as WeeklyTargetContext;
  } else
    next.progress = (await api.progress(token, groupId))
      .data as CurrentWeekProgressItem[];
  return next;
}

const inflight = new Map<
  string,
  { token: string; load: Promise<WeeklySnapshot> }
>();

// Starts a first load early; the tab adopts it on mount instead of refetching.
export function prefetchWeekly(
  api: Api,
  token: string,
  groupId: string,
  route: Route,
  cache: Map<string, WeeklySnapshot>,
  cacheKey: string,
) {
  if (cache.has(cacheKey) || inflight.get(cacheKey)?.token === token) return;
  const load = loadWeekly(api, token, groupId, route);
  inflight.set(cacheKey, { token, load });
  const settle = () => {
    if (inflight.get(cacheKey)?.load === load) inflight.delete(cacheKey);
  };
  load.then(settle, settle);
}
