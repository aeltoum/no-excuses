import type {
  CurrentWeekProgressItem,
  FinalizedWeeklyHistoryItem,
  WeeklyTargetContext,
} from "@no-excuses/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiError, type createApiClient } from "./api-client";
import { Barbell } from "./Barbell";
import { Consequences, type LogBlock } from "./Consequences";
import {
  type DetailsDraft,
  DetailsFields,
  detailLine,
  draftDetails,
  emptyDraft,
  type WorkoutDetails,
} from "./details";
import { Exceptions } from "./Exceptions";
import { useHomeExtras } from "./extras";
import { InstallPrompt } from "./InstallPrompt";
import { MissedWeeks } from "./MissedWeeks";
import { onClearPersisted } from "./persist";
import {
  compressPhoto,
  loadNudged,
  nudgeMember,
  type ProofItem,
  setProofDetails,
  uploadProofPhoto,
} from "./proof";
import { Result, useNotice } from "./Result";
import { SeasonCard, SeasonChip } from "./Season";
import { Sheet } from "./Sheet";
import { ProofFeed } from "./Wall";

// Snapshots cached before streaks shipped lack the fields; hide until refreshed.
const hasStreaks = (item: { targetStreak?: number }) =>
  item.targetStreak !== undefined;

const weekStreakText = (weeks: number) => `${weeks}-week streak`;

const streakText = (item: CurrentWeekProgressItem) =>
  `${weekStreakText(item.targetStreak)} · ${item.workoutStreak} workout${item.workoutStreak === 1 ? "" : "s"} since last miss`;

type Api = ReturnType<typeof createApiClient>;
type Route = "/home" | "/target" | "/history";
export type WeeklySnapshot = {
  progress: CurrentWeekProgressItem[];
  history: FinalizedWeeklyHistoryItem[];
  targetContext: WeeklyTargetContext | null;
  syncedAt: number;
};

type ProofPhoto = { id: string; blob: Blob; url: string };
type Activity = "strength" | "cardio" | "class" | "sport" | "mixed";

// A workout logged on this device that the server has not confirmed yet. Its
// photos stay in memory for the session so Retry never asks for them again.
type Outgoing = {
  id: string;
  key: string;
  membershipId: string;
  activityType: Activity;
  minutes: number;
  intensity: "low" | "moderate" | "high";
  activity: ProofPhoto;
  presence: ProofPhoto;
  details: WorkoutDetails | null;
  paths: { activity?: string; presence?: string };
  status: "sending" | "failed" | "sent";
  error?: string;
  // The server answered with a definite rejection, so nothing was logged.
  rejected?: boolean;
  count?: number;
};
let outbox: Outgoing[] = [];
const outboxListeners = new Set<() => void>();
const setOutbox = (next: Outgoing[]) => {
  outbox = next;
  for (const listener of outboxListeners) listener();
};
const patchOutgoing = (id: string, patch: Partial<Outgoing>) =>
  setOutbox(
    outbox.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  );
const subscribeOutbox = (listener: () => void) => {
  outboxListeners.add(listener);
  return () => {
    outboxListeners.delete(listener);
  };
};
const dropOutgoing = (id: string) => {
  for (const entry of outbox.filter((item) => item.id === id)) {
    URL.revokeObjectURL(entry.activity.url);
    URL.revokeObjectURL(entry.presence.url);
  }
  setOutbox(outbox.filter((entry) => entry.id !== id));
};
onClearPersisted(() => {
  for (const entry of outbox) dropOutgoing(entry.id);
});

// Uploads both photos and submits the check-in in the background. A retry
// reuses the uploaded paths, workout ID and idempotency key, so it can never
// log the same workout twice.
function sendOutgoing(
  entry: Outgoing,
  api: Api,
  apiBaseUrl: string,
  token: string,
  onRevoked: () => void,
) {
  patchOutgoing(entry.id, { status: "sending", error: undefined });
  const upload = async (kind: "activity" | "presence") => {
    const known = entry.paths[kind];
    if (known) return known;
    const path = await uploadProofPhoto(
      apiBaseUrl,
      token,
      kind,
      entry[kind].blob,
    );
    entry.paths[kind] = path;
    return path;
  };
  void Promise.all([upload("activity"), upload("presence")])
    .then(([activityPhotoPath, presencePhotoPath]) =>
      api.checkIn(
        token,
        {
          workoutCheckinId: entry.id,
          activityType: entry.activityType,
          durationMinutes: entry.minutes,
          perceivedIntensity: entry.intensity,
          selfReportAttested: true,
          activityPhotoPath,
          presencePhotoPath,
          mediaConsent: true,
        },
        entry.key,
      ),
    )
    .then(async (response) => {
      if (response.data.workoutCheckinId !== entry.id)
        throw new ApiError(
          "failure",
          "Check-in response did not match this workout.",
        );
      // Details are extra: the workout counts even if they fail to save.
      if (entry.details)
        await setProofDetails(apiBaseUrl, token, entry.id, entry.details).catch(
          () => undefined,
        );
      patchOutgoing(entry.id, {
        status: "sent",
        count: response.data.currentWeekCount,
      });
    })
    .catch((error) => {
      if (error instanceof ApiError && error.kind === "unauthorized")
        onRevoked();
      patchOutgoing(entry.id, {
        status: "failed",
        rejected:
          error instanceof ApiError &&
          !error.retryable &&
          error.kind !== "unauthorized",
        error:
          error instanceof ApiError && error.kind === "denied"
            ? "Finish your Consequence card before logging workouts."
            : error instanceof ApiError
              ? error.message
              : "Workout could not be logged.",
      });
    });
}

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
  // Only the refresh buttons wait on a request; everything else is instant.
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useNotice();
  const [nudged, setNudged] = useState<ReadonlySet<string>>(new Set());
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [retry, setRetry] = useState(0);
  const [target, setTarget] = useState(
    saved?.targetContext ? String(saved.targetContext.recurringTarget) : "",
  );
  const [targetContext, setTargetContext] =
    useState<WeeklyTargetContext | null>(saved?.targetContext ?? null);
  const [activityType, setActivityType] = useState<Activity | null>(null);
  const [duration, setDuration] = useState("");
  const [otherDuration, setOtherDuration] = useState(false);
  const [intensity, setIntensity] = useState<"low" | "moderate" | "high">(
    "moderate",
  );
  const [photos, setPhotos] = useState<{
    activity?: ProofPhoto;
    presence?: ProofPhoto;
  }>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft>(emptyDraft);
  const sending = useSyncExternalStore(subscribeOutbox, () => outbox).filter(
    (entry) => entry.membershipId === membership?.membershipId,
  );
  const [feedRevision, setFeedRevision] = useState(0);
  const [awaitingReview, setAwaitingReview] = useState<Set<string>>(
    () => new Set(),
  );
  const [docked, setDocked] = useState(false);
  const [groupOwed, setGroupOwed] = useState<Record<string, number>>({});
  const [feedAttention, setFeedAttention] = useState(0);
  const [cardAttention, setCardAttention] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const feedRevoked = useCallback(() => revokeRef.current(), []);
  const [extras, applyExtras, reloadExtras] = useHomeExtras(
    apiBaseUrl,
    token,
    cacheKey,
    (route === "/home" || route === "/history") && Boolean(membership),
    feedRevoked,
  );
  const ballotAttention = extras.exceptions.toDecide.filter(
    (ballot) => !ballot.myResponse,
  ).length;
  useEffect(() => {
    if (route === "/home")
      onAttention(feedAttention + cardAttention + ballotAttention);
  }, [route, feedAttention, cardAttention, ballotAttention, onAttention]);
  const excused = new Set(extras.exceptions.excused);
  const weekOffPending = new Set(extras.exceptions.pending);
  const feedItems = useCallback((items: ProofItem[]) => {
    const waiting = items.filter(
      (item) => item.canReview || (item.canVote && !item.myVote),
    );
    setFeedAttention(waiting.length);
    setAwaitingReview(new Set(waiting.map((item) => item.authorMembershipId)));
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
  const [logBlock, setLogBlock] = useState<LogBlock>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(12);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef(onRevoked);
  revokeRef.current = onRevoked;
  const groupId = membership?.groupId;
  const targetDraft = useRef<{ signature: string; key: string } | null>(null);
  // The target count being saved, so the same save cannot run twice.
  const targetSaving = useRef<number | null>(null);
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
  // A confirmed check-in replaces its local entry with the server's count.
  const sent = sending.filter((entry) => entry.status === "sent");
  useEffect(() => {
    if (sent.length === 0 || !groupId || !membership) return;
    const last = sent[sent.length - 1];
    setProgress((items) =>
      items.map((item) =>
        item.membershipId === membership.membershipId
          ? {
              ...item,
              completedWorkoutCount: last?.count ?? item.completedWorkoutCount,
              activityTypes: [
                ...item.activityTypes,
                ...sent.map((entry) => entry.activityType),
              ],
            }
          : item,
      ),
    );
    for (const entry of sent) dropOutgoing(entry.id);
    setFeedRevision((value) => value + 1);
    const target = progress.find(
      (item) => item.membershipId === membership.membershipId,
    )?.lockedTarget;
    setNotice({
      kind: "success",
      text: `Workout logged. ${last?.count} of ${target} this week. It counts once a friend verifies it or 24 hours pass.`,
    });
    // Refresh in the background; the screen already shows the server count.
    void api
      .progress(token, groupId)
      .then((response) => {
        setProgress(response.data);
        setRefreshWarning(false);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "unauthorized")
          revokeRef.current();
        setRefreshWarning(true);
      });
  });
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
  // Only fetch who was nudged when some friend is still behind target.
  const nudgeable = progress.some(
    (item) =>
      item.membershipId !== membership?.membershipId &&
      item.completedWorkoutCount < item.lockedTarget,
  );
  useEffect(() => {
    if (route !== "/home" || !groupId || !nudgeable) return;
    let active = true;
    loadNudged(apiBaseUrl, token)
      .then((ids) => active && setNudged(new Set(ids)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, route, groupId, nudgeable]);
  const nudge = async (membershipId: string) => {
    setNudged((ids) => new Set(ids).add(membershipId));
    try {
      await nudgeMember(apiBaseUrl, token, membershipId);
      setNotice({ kind: "success", text: "Nudge sent." });
    } catch (error) {
      // Already nudged today (409) still counts as sent.
      if (error instanceof ApiError && error.kind === "conflict") return;
      setNudged((ids) => {
        const next = new Set(ids);
        next.delete(membershipId);
        return next;
      });
      if (error instanceof ApiError && error.kind === "unauthorized")
        onRevoked();
      setNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Couldn’t nudge. Try again.",
      });
    }
  };
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
        <h1>Join a Group</h1>
        <p className="lead">
          Create or join a Group to start weekly accountability.
        </p>
        <a className="primary-action" href="/group">
          Go to Group
        </a>
      </section>
    );
  // Workouts still sending count at once; a failed one drops back out.
  const ownSaved = progress.find(
    (item) => item.membershipId === membership.membershipId,
  );
  const counted = sending.filter((entry) => entry.status !== "failed");
  const own = ownSaved && {
    ...ownSaved,
    completedWorkoutCount: ownSaved.completedWorkoutCount + counted.length,
    activityTypes: [
      ...ownSaved.activityTypes,
      ...counted.map((entry) => entry.activityType),
    ],
  };
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
    photos.presence !== undefined;
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
          <h1>{route === "/target" ? "Weekly target" : "Your history"}</h1>
          <p className="lead">
            {route === "/target"
              ? "Every workout needs proof photos. Only workouts your friends verify, or that go unquestioned for 24 hours, count."
              : "Each plate is a finished week, marked met or missed."}
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
                  <SeasonChip
                    season={extras.season}
                    onOpen={(event) => onNavigate(event, "/history")}
                  />
                  {hasStreaks(own) && (
                    <p className="home-streaks">{streakText(own)}</p>
                  )}
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
                <Exceptions
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  extras={extras}
                  apply={applyExtras}
                  reload={reloadExtras}
                  onNotice={setNotice}
                  onRevoked={feedRevoked}
                />
              )}
              {own && (
                <Consequences
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  onRevoked={feedRevoked}
                  onGroupOwed={setGroupOwed}
                  onAttention={setCardAttention}
                  onLogBlock={setLogBlock}
                  cacheKey={cacheKey}
                />
              )}
              {own && (
                <MissedWeeks
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  extras={extras}
                  apply={applyExtras}
                  reload={reloadExtras}
                  onError={(text) => setNotice({ kind: "error", text })}
                  onRevoked={feedRevoked}
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
                          {excused.has(item.membershipId)
                            ? " · excused"
                            : weekOffPending.has(item.membershipId)
                              ? " · week off?"
                              : ""}
                        </span>
                        {hasStreaks(item) && (
                          <span className="friend-streaks">
                            <span aria-hidden="true">
                              {item.targetStreak} wk · {item.workoutStreak} in a
                              row
                            </span>
                            <span className="visually-hidden">
                              {streakText(item)}
                            </span>
                          </span>
                        )}
                        {item.completedWorkoutCount < item.lockedTarget &&
                          !excused.has(item.membershipId) && (
                            <button
                              type="button"
                              className="secondary-button friend-nudge"
                              disabled={nudged.has(item.membershipId)}
                              aria-label={
                                nudged.has(item.membershipId)
                                  ? `Nudged ${item.displayName} today`
                                  : `Nudge ${item.displayName}`
                              }
                              onClick={() => void nudge(item.membershipId)}
                            >
                              {nudged.has(item.membershipId)
                                ? "Nudged ✓"
                                : "Nudge"}
                            </button>
                          )}
                      </li>
                    ))}
                </ul>
              )}
              {own && (
                <>
                  <button
                    className={`home-log-button${logBlock ? " is-locked" : ""}`}
                    type="button"
                    aria-label={
                      logBlock
                        ? "Log workout, locked until your Consequence card is done"
                        : "Log workout"
                    }
                    onClick={(event) => {
                      event.currentTarget.focus();
                      if (logBlock) setLockOpen(true);
                      else setSheetOpen(true);
                    }}
                  >
                    {logBlock ? (
                      <span className="log-collar" aria-hidden="true" />
                    ) : (
                      <span className="log-plus" aria-hidden="true">
                        +
                      </span>
                    )}{" "}
                    Log
                  </button>
                  <Sheet
                    open={lockOpen}
                    title="Bar’s racked"
                    onDismiss={() => setLockOpen(false)}
                  >
                    <div className="log-lock">
                      <p className="log-lock-lede">
                        Pay your Consequence card before you log another
                        workout.
                      </p>
                      {logBlock?.title ? (
                        <p className="log-lock-card">{logBlock.title}</p>
                      ) : (
                        <p className="log-lock-card log-lock-card-empty">
                          Pick your card
                        </p>
                      )}
                      <p className="log-lock-note">
                        Tap “Record proof” and film a quick clip in the app.
                        Logging unlocks the moment you send it, so you’re not
                        stuck waiting on friends to approve.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setLockOpen(false);
                          requestAnimationFrame(() => {
                            const cards =
                              document.getElementById("consequence-cards");
                            cards?.scrollIntoView({
                              behavior: window.matchMedia(
                                "(prefers-reduced-motion: reduce)",
                              ).matches
                                ? "auto"
                                : "smooth",
                              block: "center",
                            });
                            cards?.focus({ preventScroll: true });
                          });
                        }}
                      >
                        {logBlock?.title ? "Go to my card" : "Choose my card"}
                      </button>
                    </div>
                  </Sheet>
                  <Sheet
                    open={sheetOpen}
                    title="Log a workout"
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
                          !logReady ||
                          !activityType ||
                          !photos.activity ||
                          !photos.presence
                        )
                          return;
                        const entry: Outgoing = {
                          id: crypto.randomUUID(),
                          key: crypto.randomUUID(),
                          membershipId: membership.membershipId,
                          activityType,
                          minutes: Number(duration),
                          intensity,
                          activity: photos.activity,
                          presence: photos.presence,
                          details: draftDetails(detailsDraft, activityType),
                          paths: {},
                          status: "sending",
                        };
                        // Optimistic: close the sheet and count it now; the
                        // upload and check-in finish in the background.
                        setOutbox([...outbox, entry]);
                        setSheetOpen(false);
                        setActivityType(null);
                        setDuration("");
                        setOtherDuration(false);
                        setPhotos({});
                        setDetailsDraft(emptyDraft());
                        sendOutgoing(entry, api, apiBaseUrl, token, () =>
                          revokeRef.current(),
                        );
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
                                onClick={() => setIntensity(level)}
                              >
                                {level[0].toUpperCase() + level.slice(1)}
                              </button>
                            ),
                          )}
                        </div>
                      </fieldset>
                      <DetailsFields
                        activity={activityType}
                        draft={detailsDraft}
                        onChange={setDetailsDraft}
                      />
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
                      <button type="submit" disabled={!logReady}>
                        Log workout
                      </button>
                      {!logReady && (
                        <p className="sheet-hint">
                          Pick an activity and a time, then take both photos.
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
              {own && sending.length > 0 && (
                <ul
                  className="proof-list proof-outbox"
                  aria-label="Your workouts sending"
                >
                  {sending.map((entry) => (
                    <li className="proof-post" key={entry.id}>
                      <header>
                        <span className="proof-avatar" aria-hidden="true">
                          YO
                        </span>
                        <strong>You</strong>
                        <span
                          className={`proof-status ${entry.status === "failed" ? "proof-questioned" : "proof-pending"}`}
                        >
                          {entry.status === "failed"
                            ? "Couldn’t upload"
                            : "Uploading…"}
                        </span>
                      </header>
                      <div className="proof-frame">
                        <img
                          className="proof-main"
                          src={entry.activity.url}
                          alt="Your workout activity"
                        />
                        <img
                          className="proof-inset"
                          src={entry.presence.url}
                          alt="You at the workout"
                        />
                        <span className="proof-tag">
                          <i
                            className={`activity-swatch activity-${entry.activityType}`}
                          />
                          {entry.activityType[0]?.toUpperCase()}
                          {entry.activityType.slice(1)} · {entry.minutes} min
                        </span>
                      </div>
                      {entry.details && (
                        <p className="proof-details">
                          {detailLine(entry.details)}
                        </p>
                      )}
                      {entry.status === "failed" && (
                        <>
                          <p className="result error" role="alert">
                            {entry.error}
                          </p>
                          <div className="proof-actions">
                            <button
                              type="button"
                              onClick={() =>
                                sendOutgoing(
                                  entry,
                                  api,
                                  apiBaseUrl,
                                  token,
                                  () => revokeRef.current(),
                                )
                              }
                            >
                              Retry
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => {
                                dropOutgoing(entry.id);
                                if (entry.rejected) return;
                                // A lost response may follow a logged workout.
                                setNotice({
                                  kind: "success",
                                  text: "Discarded here. It may already be logged; your count will update.",
                                });
                                void api
                                  .progress(token, membership.groupId)
                                  .then((response) =>
                                    setProgress(response.data),
                                  )
                                  .catch(() => setRefreshWarning(true));
                              }}
                            >
                              Discard
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {own && (
                <ProofFeed
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  revision={feedRevision}
                  cacheKey={cacheKey}
                  onRevoked={feedRevoked}
                  onItems={feedItems}
                  onDeleted={(count) => {
                    setProgress((items) =>
                      items.map((item) =>
                        item.membershipId === membership.membershipId
                          ? {
                              ...item,
                              completedWorkoutCount: count,
                              activityTypes: item.activityTypes.slice(0, count),
                            }
                          : item,
                      ),
                    );
                    // The exact plates and streaks follow from the server.
                    void api
                      .progress(token, membership.groupId)
                      .then((response) => setProgress(response.data))
                      .catch(() => setRefreshWarning(true));
                  }}
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
                  const count = Number(target);
                  if (targetSaving.current === count) return;
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
                  // Optimistic: the saved target shows now; a failure restores
                  // the previous one.
                  const previous = targetContext;
                  targetSaving.current = count;
                  setTargetContext(
                    (current) =>
                      current && { ...current, recurringTarget: count },
                  );
                  setNotice({ kind: "success", text: savedTargetText(count) });
                  void api
                    .setTarget(token, count, targetDraft.current.key)
                    .then((response) => {
                      if (
                        response.data.membershipId !== membership.membershipId
                      )
                        throw new ApiError(
                          "failure",
                          "Target response did not match this membership.",
                        );
                      targetDraft.current = null;
                      // Progress refreshes in the background.
                      void api
                        .progress(token, membership.groupId)
                        .then((progressResponse) => {
                          setProgress(progressResponse.data);
                          setRefreshWarning(false);
                        })
                        .catch((error) => {
                          if (
                            error instanceof ApiError &&
                            error.kind === "unauthorized"
                          )
                            onRevoked();
                          setRefreshWarning(true);
                        });
                    })
                    .catch((error) => {
                      setTargetContext((current) =>
                        current && previous
                          ? {
                              ...current,
                              recurringTarget: previous.recurringTarget,
                            }
                          : current,
                      );
                      updateError(error);
                    })
                    .finally(() => {
                      if (targetSaving.current === count)
                        targetSaving.current = null;
                    });
                }}
              >
                <fieldset className="target-control">
                  <legend>Weekly target</legend>
                  <button
                    className="target-adjust"
                    type="button"
                    aria-label="Decrease weekly target"
                    disabled={targetCount <= 1}
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
                <button type="submit">
                  {targetContext?.memberCount === 1
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
              <SeasonCard season={extras.season} />
              <h2>The rack</h2>
              {historyWeeks.length ? (
                <>
                  <ul className="history-rack" aria-label="Finalized weeks">
                    {historyWeeks.slice(0, historyLimit).map((startsAt) => {
                      const item = ownHistory(startsAt);
                      if (!item) return null;
                      const met = item.outcome === "attained";
                      const excusedWeek = item.outcome === "excepted";
                      const outcomeLabel = met
                        ? "Met"
                        : excusedWeek
                          ? "Excused"
                          : "Missed";
                      const range = historyRange(item);
                      return (
                        <li key={startsAt}>
                          <button
                            type="button"
                            className={`history-plate${met ? " met" : excusedWeek ? " excused" : " missed"}`}
                            aria-label={`${range}: ${item.completedWorkoutCount}/${item.lockedTarget}, ${met && hasStreaks(item) ? `Met, ${weekStreakText(item.targetStreak)}` : outcomeLabel}`}
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
                              {outcomeLabel}
                            </strong>
                            {met && hasStreaks(item) && (
                              <span className="history-streak">
                                {weekStreakText(item.targetStreak)}
                              </span>
                            )}
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
                                : item.outcome === "excepted"
                                  ? "were excused"
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
                                {item.outcome === "excepted"
                                  ? "Excused"
                                  : item.outcome !== "attained"
                                    ? "Missed"
                                    : hasStreaks(item)
                                      ? `Met · ${weekStreakText(item.targetStreak)}`
                                      : "Met"}
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
