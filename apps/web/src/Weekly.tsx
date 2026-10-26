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
import {
  ApiError,
  type createApiClient,
  overlappedWrite,
  writeMark,
} from "./api-client";
import { Avatar, useAvatars } from "./avatars";
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
import {
  clearWorkouts,
  forgetWorkout,
  loadWorkouts,
  saveWorkout,
} from "./durable";
import { Exceptions } from "./Exceptions";
import { useHomeExtras } from "./extras";
import { useFreshness } from "./freshness";
import { InstallPrompt } from "./InstallPrompt";
import { onClearPersisted } from "./persist";
import {
  call,
  compressPhoto,
  loadNudged,
  nudgeMember,
  type ProofItem,
  setProofDetails,
  uploadProofPhoto,
} from "./proof";
import { Result, useNotice } from "./Result";
import { SeasonCard, SeasonChip, UnlockList, UnlockNote } from "./Season";
import { clearCandidates, SessionCard, useCandidates } from "./Session";
import { Sheet } from "./Sheet";
import { ProofFeed } from "./Wall";
import { WeekRecap } from "./WeekRecap";

// Snapshots cached before streaks shipped lack the fields; hide until refreshed.
const hasStreaks = (item: { targetStreak?: number }) =>
  item.targetStreak !== undefined;

const weekStreakText = (weeks: number) => `${weeks}-week streak`;

const streakText = (item: CurrentWeekProgressItem) =>
  `${weekStreakText(item.targetStreak)} · ${item.workoutStreak} workout${item.workoutStreak === 1 ? "" : "s"} since last miss`;

const intensityLevels = ["low", "moderate", "high"] as const;
const intensityLabels = {
  low: { emoji: "😌", text: "Easy" },
  moderate: { emoji: "😅", text: "Solid" },
  high: { emoji: "🥵", text: "Brutal" },
};

// Flame and count, like a chat streak; the full sentence stays for screen readers.
function Streak({
  item,
  compact = false,
}: {
  item: CurrentWeekProgressItem;
  compact?: boolean;
}) {
  return (
    <span className={`streak${compact ? " streak-compact" : ""}`}>
      {item.targetStreak > 0 && (
        <span className="streak-flame" aria-hidden="true">
          🔥<b>{item.targetStreak}</b>
          {!compact && (
            <small>{item.targetStreak === 1 ? "week" : "weeks"}</small>
          )}
        </span>
      )}
      {!compact && item.workoutStreak > 0 && (
        <span className="streak-flame" aria-hidden="true">
          💪<b>{item.workoutStreak}</b>
          <small>in a row</small>
        </span>
      )}
      <span className="visually-hidden">{streakText(item)}</span>
    </span>
  );
}

// Time left before the week closes, refreshed each minute.
function WeekCountdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!endsAt) return <span className="week-countdown" />;
  const minutes = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 60_000));
  // The server rolls the week over within a minute or so.
  if (minutes === 0)
    return <span className="week-countdown is-close">Week closing</span>;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const text =
    days > 0
      ? `${days}d ${hours}h`
      : hours > 0
        ? `${hours}h ${minutes % 60}m`
        : `${minutes}m`;
  return (
    <span
      className={`week-countdown${minutes < 1440 ? " is-close" : ""}`}
      title={new Date(endsAt).toLocaleString()}
    >
      <span className="visually-hidden">Week ends in </span>
      {text}
      <small aria-hidden="true"> left</small>
    </span>
  );
}

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
// photos stay on the device (memory and IndexedDB) so Retry never asks for them
// again, even after a reload.
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
  sessionId?: string;
  paths: { activity?: string; presence?: string };
  status: "sending" | "failed" | "sent";
  error?: string;
  // The server answered with a definite rejection, so nothing was logged.
  rejected?: boolean;
  count?: number;
};
let outbox: Outgoing[] = [];
const outboxListeners = new Set<() => void>();
// Mirrors the queue to IndexedDB: unsent workouts are kept, sent or refused ones go.
const persistOutbox = (previous: Outgoing[], next: Outgoing[]) => {
  const live = new Set<string>();
  for (const entry of next) {
    if (entry.status === "sent" || entry.rejected) continue;
    live.add(entry.id);
    void saveWorkout({
      id: entry.id,
      key: entry.key,
      membershipId: entry.membershipId,
      activityType: entry.activityType,
      minutes: entry.minutes,
      intensity: entry.intensity,
      activity: { id: entry.activity.id, blob: entry.activity.blob },
      presence: { id: entry.presence.id, blob: entry.presence.blob },
      details: entry.details,
      sessionId: entry.sessionId,
      paths: entry.paths,
    });
  }
  for (const entry of previous)
    if (!live.has(entry.id)) void forgetWorkout(entry.id);
};
const setOutbox = (next: Outgoing[]) => {
  const previous = outbox;
  outbox = next;
  persistOutbox(previous, next);
  for (const listener of outboxListeners) listener();
};
// Workouts saved by an earlier visit are picked up once per app start.
let restored = false;
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
  void clearWorkouts();
  restored = false;
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
      // The session link and details are extras: the workout counts either way.
      if (entry.sessionId)
        await call(apiBaseUrl, token, `/v1/sessions/${entry.sessionId}/link`, {
          method: "POST",
          body: { workoutCheckinId: entry.id },
        }).catch(() => undefined);
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
  onUnread,
  onOperator,
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
  onUnread?: (count: number) => void;
  onOperator?: (operator: boolean) => void;
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
  const fresh = useFreshness();
  const [target, setTarget] = useState(
    saved?.targetContext ? String(saved.targetContext.recurringTarget) : "",
  );
  const [targetContext, setTargetContext] =
    useState<WeeklyTargetContext | null>(saved?.targetContext ?? null);
  const [activities, setActivities] = useState<Activity[]>([]);
  // Picking several activities logs one mixed workout.
  const activityType: Activity | null =
    activities.length === 0
      ? null
      : activities.length === 1
        ? activities[0]
        : "mixed";
  const quickCamera = useRef<HTMLInputElement>(null);
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const shots = useCandidates();
  const avatars = useAvatars();
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
  useEffect(() => {
    onUnread?.(extras.unreadNotifications);
  }, [extras.unreadNotifications, onUnread]);
  useEffect(() => {
    onOperator?.(extras.safety.operator === true);
  }, [extras.safety.operator, onOperator]);
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
          // Session photos stay listed, so their previews stay alive.
          if (
            current[kind] &&
            !shots.some((shot) => shot.id === current[kind]?.id)
          )
            URL.revokeObjectURL(current[kind].url);
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
  // Resend workouts that a reload interrupted, and failed ones once back online.
  const membershipKey = membership?.membershipId;
  useEffect(() => {
    if (!membershipKey || restored) return;
    restored = true;
    void loadWorkouts().then((stored) => {
      for (const item of stored) {
        if (item.membershipId !== membershipKey) {
          void forgetWorkout(item.id);
          continue;
        }
        if (outbox.some((entry) => entry.id === item.id)) continue;
        const photo = (value: { id: string; blob: Blob }) => ({
          ...value,
          url: URL.createObjectURL(value.blob),
        });
        const entry: Outgoing = {
          ...item,
          activityType: item.activityType as Activity,
          intensity: item.intensity as Outgoing["intensity"],
          activity: photo(item.activity),
          presence: photo(item.presence),
          details: item.details as WorkoutDetails | null,
          status: "sending",
        };
        setOutbox([...outbox, entry]);
        sendOutgoing(entry, api, apiBaseUrl, token, () => revokeRef.current());
      }
    });
  }, [membershipKey, api, apiBaseUrl, token]);
  useEffect(() => {
    const resend = () => {
      for (const entry of outbox)
        if (entry.status === "failed" && !entry.rejected)
          sendOutgoing(entry, api, apiBaseUrl, token, () =>
            revokeRef.current(),
          );
    };
    window.addEventListener("online", resend);
    return () => window.removeEventListener("online", resend);
  }, [api, apiBaseUrl, token]);
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
    void fresh;
    let active = true;
    const mark = writeMark();
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
        // A reload that overlapped a save, or lands while a workout is still
        // sending, would count it twice or undo it; the save's own refresh follows.
        if (
          previous &&
          (overlappedWrite(mark) ||
            outbox.some((entry) => entry.status === "sending"))
        )
          return;
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
  }, [api, token, groupId, route, retry, fresh, cache, cacheKey, setNotice]);
  // Only fetch who was nudged when some friend is still behind target.
  const nudgeable = progress.some(
    (item) =>
      item.membershipId !== membership?.membershipId &&
      item.completedWorkoutCount < item.lockedTarget,
  );
  useEffect(() => {
    void fresh;
    if (route !== "/home" || !groupId || !nudgeable) return;
    let active = true;
    loadNudged(apiBaseUrl, token)
      .then((ids) => active && setNudged(new Set(ids)))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, route, groupId, nudgeable, fresh]);
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
          <WeekCountdown endsAt={targetContext?.nextWeekStartsAt ?? null} />
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
                  <div className="home-meta">
                    <p className="home-count">
                      <strong>
                        {own.completedWorkoutCount} of {own.lockedTarget}
                      </strong>{" "}
                      this week
                    </p>
                    {hasStreaks(own) && <Streak item={own} />}
                    <SeasonChip
                      season={extras.season}
                      onOpen={(event) => onNavigate(event, "/history")}
                    />
                  </div>
                  <UnlockNote unlocks={extras.unlocks} />
                  <div className="home-actions">
                    <a
                      className="home-target-link"
                      href="/target"
                      onClick={(event) => onNavigate(event, "/target")}
                    >
                      Change target
                    </a>
                    <SessionCard
                      apiBaseUrl={apiBaseUrl}
                      token={token}
                      extras={extras}
                      apply={applyExtras}
                      onNotice={setNotice}
                      onFinish={(id, minutes) => {
                        setSessionId(id);
                        setDuration(String(minutes));
                        setOtherDuration(
                          ![20, 30, 45, 60, 90].includes(minutes),
                        );
                        if (logBlock) setLockOpen(true);
                        else setSheetOpen(true);
                      }}
                    />
                    <Exceptions
                      part="own"
                      apiBaseUrl={apiBaseUrl}
                      token={token}
                      extras={extras}
                      apply={applyExtras}
                      reload={reloadExtras}
                      onNotice={setNotice}
                      onRevoked={feedRevoked}
                    />
                  </div>
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
                <WeekRecap
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
                        <Avatar
                          name={item.displayName}
                          url={avatars[item.membershipId]}
                          size="sm"
                        />
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
                        {hasStreaks(item) && <Streak item={item} compact />}
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
                <Exceptions
                  part="ballots"
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
                      else {
                        // The camera opens straight away over the sheet;
                        // details follow once the photo is in.
                        setSheetOpen(true);
                        if (!photos.activity) quickCamera.current?.click();
                      }
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
                  {!logBlock && (
                    <input
                      ref={quickCamera}
                      className="visually-hidden"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(event) => {
                        void choosePhoto("activity")(event);
                      }}
                    />
                  )}
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
                          sessionId: sessionId ?? undefined,
                          paths: {},
                          status: "sending",
                        };
                        // Optimistic: close the sheet and count it now; the
                        // upload and check-in finish in the background.
                        setOutbox([...outbox, entry]);
                        setSheetOpen(false);
                        setActivities([]);
                        setDuration("");
                        setOtherDuration(false);
                        setPhotos({});
                        setDetailsDraft(emptyDraft());
                        setSessionId(null);
                        clearCandidates([
                          photos.activity.id,
                          photos.presence.id,
                        ]);
                        sendOutgoing(entry, api, apiBaseUrl, token, () =>
                          revokeRef.current(),
                        );
                      }}
                    >
                      <fieldset>
                        <legend>
                          What did you do?{" "}
                          <span className="legend-hint">
                            Pick all that apply
                          </span>
                        </legend>
                        <div className="activity-plates">
                          {(
                            ["strength", "cardio", "class", "sport"] as const
                          ).map((activity) => (
                            <button
                              type="button"
                              key={activity}
                              className={`activity-plate activity-${activity}`}
                              aria-pressed={activities.includes(activity)}
                              onClick={() =>
                                setActivities((current) =>
                                  current.includes(activity)
                                    ? current.filter(
                                        (entry) => entry !== activity,
                                      )
                                    : [...current, activity],
                                )
                              }
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
                      <label className="intensity-slider">
                        <span className="intensity-title">
                          How hard did it feel?
                          <strong>{intensityLabels[intensity].text}</strong>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="1"
                          value={intensityLevels.indexOf(intensity)}
                          aria-valuetext={intensityLabels[intensity].text}
                          onChange={(event) =>
                            setIntensity(
                              intensityLevels[Number(event.target.value)] ??
                                "moderate",
                            )
                          }
                        />
                        <span className="intensity-marks" aria-hidden="true">
                          {intensityLevels.map((level) => (
                            <span
                              key={level}
                              className={
                                intensity === level ? "is-on" : undefined
                              }
                            >
                              {intensityLabels[level].emoji}
                            </span>
                          ))}
                        </span>
                      </label>
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
                            <div className="proof-capture-cell" key={kind}>
                              <label className="proof-capture-slot">
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
                              {shots.length > 0 && (
                                <fieldset
                                  className="session-pick"
                                  aria-label={`Use a session photo as ${title.toLowerCase()}`}
                                >
                                  {shots.map((shot, index) => (
                                    <button
                                      type="button"
                                      key={shot.id}
                                      aria-pressed={
                                        photos[kind]?.id === shot.id
                                      }
                                      aria-label={`Session photo ${index + 1}`}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        setPhotos((current) => ({
                                          ...current,
                                          [kind]: shot,
                                        }));
                                      }}
                                    >
                                      <img src={shot.url} alt="" />
                                    </button>
                                  ))}
                                </fieldset>
                              )}
                            </div>
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
                        <Avatar
                          name="You"
                          url={avatars[membership.membershipId]}
                        />
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
              <ul className="activity-legend" aria-label="Activity colours">
                {(
                  ["strength", "cardio", "class", "sport", "mixed"] as const
                ).map((activity) => (
                  <li key={activity}>
                    <span className={`activity-swatch activity-${activity}`} />
                    {activity[0].toUpperCase() + activity.slice(1)}
                  </li>
                ))}
              </ul>
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
              <UnlockList unlocks={extras.unlocks} />
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
  } else {
    // Home also reads the week's end for its countdown; that part may fail alone.
    const [progressResponse, targetResponse] = await Promise.all([
      api.progress(token, groupId),
      api.target(token).catch(() => null),
    ]);
    next.progress = progressResponse.data as CurrentWeekProgressItem[];
    if (targetResponse)
      next.targetContext = targetResponse.data as WeeklyTargetContext;
  }
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
