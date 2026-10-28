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
import { Consequences, type LogBlock, useCardSummary } from "./Consequences";
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
import { ProofFeed, useFeedItems } from "./Wall";
import { WeekRecap } from "./WeekRecap";

// Snapshots cached before streaks shipped lack the fields; hide until refreshed.
const hasStreaks = (item: { targetStreak?: number }) =>
  item.targetStreak !== undefined;

const weekStreakText = (weeks: number) => `${weeks}-week streak`;

const streakText = (item: CurrentWeekProgressItem) =>
  `${weekStreakText(item.targetStreak)} · ${item.workoutStreak} workout${item.workoutStreak === 1 ? "" : "s"} since last miss`;

const utcDay = () => new Date().toISOString().slice(0, 10);

const intensityLevels = ["low", "moderate", "high"] as const;
const intensityLabels = {
  low: { emoji: "😌", text: "Easy" },
  moderate: { emoji: "😅", text: "Solid" },
  high: { emoji: "🥵", text: "Brutal" },
};

// Time left before the week closes, as the Home title, ticking each second.
function WeekCountdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return <h1>Our week</h1>;
  const seconds = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  // The server rolls the week over within a minute or so.
  if (seconds === 0)
    return <h1 className="week-countdown-title is-close">Week closing</h1>;
  const pad = (value: number) => String(value).padStart(2, "0");
  // Days:hours:minutes:seconds.
  const text = `${Math.floor(seconds / 86_400)}:${pad(Math.floor((seconds % 86_400) / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return (
    <h1
      className={`week-countdown-title${seconds < 86_400 ? " is-close" : ""}`}
      title={new Date(endsAt).toLocaleString()}
    >
      <span className="visually-hidden">Week ends in </span>
      <time dateTime={endsAt}>{text}</time>
    </h1>
  );
}

type Api = ReturnType<typeof createApiClient>;
type Route = "/home" | "/week" | "/target" | "/history";
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
type LogDraft = {
  membershipId: string;
  activities: Activity[];
  duration: string;
  otherDuration: boolean;
  intensity: "low" | "moderate" | "high";
  photos: { activity?: ProofPhoto; presence?: ProofPhoto };
  details: DetailsDraft;
};
let logDraft: LogDraft | null = null;
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
  logDraft = null;
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
    event: React.MouseEvent<HTMLElement>,
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
  // Week cards and feed exist only once this member has a bar.
  const hasOwn = progress.some(
    (item) => item.membershipId === membership?.membershipId,
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
  // Nudges reset each UTC day, like the server; each entry keeps its day so a
  // long-open app or a failed refresh never shows yesterday's nudge.
  const [nudgedOn, setNudgedOn] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const nudged = new Set(
    [...nudgedOn].filter(([, day]) => day === utcDay()).map(([id]) => id),
  );
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [retry, setRetry] = useState(0);
  const fresh = useFreshness();
  const [target, setTarget] = useState(
    saved?.targetContext ? String(saved.targetContext.recurringTarget) : "",
  );
  const [targetContext, setTargetContext] =
    useState<WeeklyTargetContext | null>(saved?.targetContext ?? null);
  // An unsent workout survives tab switches and sheet closes for this member.
  const draft =
    logDraft?.membershipId === membership?.membershipId ? logDraft : null;
  const [activities, setActivities] = useState<Activity[]>(
    draft?.activities ?? [],
  );
  // Picking several activities logs one mixed workout.
  const activityType: Activity | null =
    activities.length === 0
      ? null
      : activities.length === 1
        ? activities[0]
        : "mixed";
  const [duration, setDuration] = useState(draft?.duration ?? "");
  const [otherDuration, setOtherDuration] = useState(
    draft?.otherDuration ?? false,
  );
  const [intensity, setIntensity] = useState<"low" | "moderate" | "high">(
    draft?.intensity ?? "moderate",
  );
  const [photos, setPhotos] = useState<{
    activity?: ProofPhoto;
    presence?: ProofPhoto;
  }>(draft?.photos ?? {});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft>(
    draft?.details ?? emptyDraft,
  );
  const draftStarted =
    activities.length > 0 ||
    duration !== "" ||
    photos.activity !== undefined ||
    photos.presence !== undefined;
  useEffect(() => {
    logDraft =
      membership && draftStarted
        ? {
            membershipId: membership.membershipId,
            activities,
            duration,
            otherDuration,
            intensity,
            photos,
            details: detailsDraft,
          }
        : null;
  }, [
    membership,
    draftStarted,
    activities,
    duration,
    otherDuration,
    intensity,
    photos,
    detailsDraft,
  ]);
  const resetDraft = () => {
    setActivities([]);
    setDuration("");
    setOtherDuration(false);
    setIntensity("moderate");
    setPhotos({});
    setDetailsDraft(emptyDraft());
    logDraft = null;
  };
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
  const [feedTasks, setFeedTasks] = useState({ votes: 0 });
  const [ownQuestioned, setOwnQuestioned] = useState(0);
  const [cardAttention, setCardAttention] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);
  const feedRevoked = useCallback(() => revokeRef.current(), []);
  const [extras, applyExtras, reloadExtras] = useHomeExtras(
    apiBaseUrl,
    token,
    cacheKey,
    (route === "/home" || route === "/week" || route === "/history") &&
      Boolean(membership),
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
    // Only a Group decision waits on the member; questioning is optional.
    const waiting = items.filter((item) => item.canVote && !item.myVote);
    setFeedAttention(waiting.length);
    setFeedTasks({ votes: waiting.length });
    setOwnQuestioned(
      items.filter((item) => item.mine && item.reviewStatus === "questioned")
        .length,
    );
    setAwaitingReview(new Set(waiting.map((item) => item.authorMembershipId)));
  }, []);
  useFeedItems(
    apiBaseUrl,
    token,
    cacheKey,
    route === "/week" && hasOwn,
    feedItems,
    feedRevoked,
  );
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [logBlock, setLogBlock] = useState<LogBlock>(null);
  // Cards live on Week; Home still counts them and honours the log gate.
  const cardSummary = useCardSummary(
    apiBaseUrl,
    token,
    cacheKey,
    route === "/home" && hasOwn,
    feedRevoked,
  );
  useEffect(() => {
    if (route !== "/home") return;
    setCardAttention(cardSummary.attention);
    setLogBlock(cardSummary.blocked ? { title: cardSummary.title } : null);
  }, [route, cardSummary.attention, cardSummary.blocked, cardSummary.title]);
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
      text: `Workout logged. ${last?.count} of ${target} this week. It counts now; friends can question it for 24 hours.`,
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
    if (route !== "/week" || !groupId || !nudgeable) return;
    let active = true;
    loadNudged(apiBaseUrl, token)
      .then(
        (ids) =>
          active && setNudgedOn(new Map(ids.map((id) => [id, utcDay()]))),
      )
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, route, groupId, nudgeable, fresh]);
  const nudge = async (membershipId: string) => {
    setNudgedOn((ids) => new Map(ids).set(membershipId, utcDay()));
    try {
      await nudgeMember(apiBaseUrl, token, membershipId);
      setNotice({ kind: "success", text: "Nudge sent." });
    } catch (error) {
      // Already nudged today (409) still counts as sent.
      if (error instanceof ApiError && error.kind === "conflict") return;
      setNudgedOn((ids) => {
        const next = new Map(ids);
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
  const uploading = counted.filter(
    (entry) => entry.status === "sending",
  ).length;
  const provisional = uploading + ownQuestioned;
  const settleLine = own
    ? [
        `${Math.max(0, own.completedWorkoutCount - provisional)} settled`,
        uploading > 0 && `${uploading} uploading`,
        ownQuestioned > 0 && `${ownQuestioned} questioned`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const needsYou = [
    cardAttention > 0 && {
      href: "/week#needs-consequences",
      text: `Consequence card${cardAttention === 1 ? "" : "s"} to settle`,
      count: cardAttention,
    },
    feedTasks.votes > 0 && {
      href: "#needs-review",
      text: `Disputed workout${feedTasks.votes === 1 ? "" : "s"} to vote on`,
      count: feedTasks.votes,
    },
    ballotAttention > 0 && {
      href: "#needs-ballots",
      text: `Week-off request${ballotAttention === 1 ? "" : "s"} to decide`,
      count: ballotAttention,
    },
  ].filter(Boolean) as { href: string; text: string; count: number }[];
  // Week shows the week's status; Home keeps the feed and logging.
  const week = route === "/week";
  const home = route === "/home" || week;
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
  const missingRequirement = !photos.activity
    ? "Add your activity photo."
    : !photos.presence
      ? "Add your presence photo."
      : activityType === null
        ? "Pick an activity."
        : "Pick how long you trained.";
  const sessionCard = (onStart?: () => void) => (
    <SessionCard
      onStart={onStart}
      apiBaseUrl={apiBaseUrl}
      token={token}
      extras={extras}
      apply={applyExtras}
      onNotice={setNotice}
      onFinish={(id, minutes) => {
        setSessionId(id);
        setDuration(String(minutes));
        setOtherDuration(![20, 30, 45, 60, 90].includes(minutes));
        if (logBlock) setLockOpen(true);
        else setSheetOpen(true);
      }}
    />
  );
  return (
    <section
      className={`hero${home ? " home" : ""}${saved ? " data-cached" : ""}${changed ? " data-updated" : ""}`}
    >
      {home ? (
        <header className="home-header">
          <WeekCountdown endsAt={targetContext?.nextWeekStartsAt ?? null} />
          {week && own && (
            <button
              type="button"
              className="week-tools-button"
              aria-haspopup="dialog"
              aria-label="Week options"
              onClick={() => setToolsOpen(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          )}
        </header>
      ) : (
        <>
          {route === "/target" && (
            <a
              className="back-home"
              href="/week"
              onClick={(event) => onNavigate(event, "/week")}
            >
              <span aria-hidden="true">←</span> Back to Week
            </a>
          )}
          <h1>{route === "/target" ? "Weekly target" : "Your history"}</h1>
          <p className="lead">
            {route === "/target"
              ? "Every workout needs proof photos. A workout counts once it’s posted; friends can question it for 24 hours."
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
          {home && (
            <>
              {!week && <InstallPrompt />}
              {week && own && (
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
              {week && own ? (
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
                      provisional={provisional}
                    />
                  </a>
                  <p className="home-count">
                    {own.completedWorkoutCount} of {own.lockedTarget} this week
                  </p>
                  {provisional > 0 && (
                    <p className="home-settle">{settleLine}</p>
                  )}
                  <div className="home-meta">
                    {hasStreaks(own) && (
                      <span className="home-streaks">{streakText(own)}</span>
                    )}
                    <SeasonChip
                      season={extras.season}
                      onOpen={(event) => onNavigate(event, "/history")}
                    />
                  </div>
                  <UnlockNote unlocks={extras.unlocks} />
                  <div className="home-actions">
                    <Exceptions
                      part="own-status"
                      apiBaseUrl={apiBaseUrl}
                      token={token}
                      extras={extras}
                      apply={applyExtras}
                      reload={reloadExtras}
                      onNotice={setNotice}
                      onRevoked={feedRevoked}
                    />
                  </div>
                  <Sheet
                    open={toolsOpen}
                    title="This week"
                    onDismiss={() => setToolsOpen(false)}
                  >
                    <div className="week-tools">
                      <a
                        href="/target"
                        onClick={(event) => {
                          setToolsOpen(false);
                          onNavigate(event, "/target");
                        }}
                      >
                        <strong>Change target</strong>
                        <span>
                          {own.lockedTarget} a week now. Changes start next
                          week.
                        </span>
                      </a>
                      <div className="week-tools-row">
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
                        <span>Ask your Group to excuse a week.</span>
                      </div>
                    </div>
                  </Sheet>
                </div>
              ) : own ? null : (
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
              {week && own && progress.length > 1 && (
                <ul
                  className="friend-cards"
                  aria-label="Friends this week"
                  // Scrolls sideways; keyboard users reach it even when every nudge is spent.
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region.
                  tabIndex={0}
                >
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
                        <span className="friend-card-body">
                          <strong className="friend-card-name">
                            {item.displayName}
                          </strong>
                          <span className="friend-card-count">
                            {item.completedWorkoutCount} of {item.lockedTarget}{" "}
                            workouts
                          </span>
                          {(() => {
                            // One urgent status at most; the rest lives in member detail.
                            const status = groupOwed[item.membershipId]
                              ? `Owes ${groupOwed[item.membershipId]} card${groupOwed[item.membershipId] === 1 ? "" : "s"}`
                              : awaitingReview.has(item.membershipId)
                                ? "Needs your vote"
                                : weekOffPending.has(item.membershipId)
                                  ? "Week off requested"
                                  : excused.has(item.membershipId)
                                    ? "Excused this week"
                                    : null;
                            return status ? (
                              <span className="friend-card-status">
                                {status}
                              </span>
                            ) : null;
                          })()}
                        </span>
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
              {week && own && (
                <div id="needs-consequences" className="needs-anchor">
                  <Consequences
                    apiBaseUrl={apiBaseUrl}
                    token={token}
                    onRevoked={feedRevoked}
                    onGroupOwed={setGroupOwed}
                    onAttention={setCardAttention}
                    onLogBlock={setLogBlock}
                    cacheKey={cacheKey}
                  />
                </div>
              )}
              {!week && own && (
                <div className="home-tasks">
                  {needsYou.length > 0 && (
                    <nav className="needs-you" aria-label="Needs you">
                      <h2>Needs you</h2>
                      <ul>
                        {needsYou.map((task) => (
                          <li key={task.text}>
                            <a
                              href={task.href}
                              onClick={
                                task.href.startsWith("/week")
                                  ? (event) => {
                                      onNavigate(event, "/week");
                                      focusCards();
                                    }
                                  : undefined
                              }
                            >
                              <span>{task.text}</span>
                              <strong>{task.count}</strong>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  )}
                  {<div className="home-actions">{sessionCard()}</div>}
                </div>
              )}
              {!week && own && (
                <WeekRecap
                  apiBaseUrl={apiBaseUrl}
                  token={token}
                  extras={extras}
                  apply={applyExtras}
                  reload={reloadExtras}
                  onError={(text) => setNotice({ kind: "error", text })}
                  onRevoked={feedRevoked}
                  onHistory={(event) => onNavigate(event, "/history")}
                />
              )}
              {!week && own && (
                <div id="needs-ballots" className="needs-anchor">
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
                </div>
              )}
              {!week && own && (
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
                      // The editor opens first; the camera waits for a capture action.
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
                    Log workout
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
                        onClick={(event) => {
                          setLockOpen(false);
                          onNavigate(event, "/week");
                          focusCards();
                        }}
                      >
                        {logBlock?.title ? "Go to my card" : "Choose my card"}
                      </button>
                    </div>
                  </Sheet>
                  <Sheet
                    open={sheetOpen}
                    title="Log workout"
                    onDismiss={() => setSheetOpen(false)}
                  >
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
                        resetDraft();
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
                        <legend>Proof photos</legend>
                        <p className="sheet-hint proof-capture-rule">
                          Two photos required: the workout, and you at it. The
                          camera opens when you tap one.
                        </p>
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
                                "Presence photo",
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
                                    : `Take ${title.toLowerCase()}`}
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
                        <div className="duration-track">
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
                              {minutes}
                              <small> min</small>
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
                      <div className="log-sheet-footer">
                        {!logReady && (
                          <p className="sheet-hint">{missingRequirement}</p>
                        )}
                        <button type="submit" disabled={!logReady}>
                          Log workout
                        </button>
                        {draftStarted && (
                          <button
                            type="button"
                            className="log-discard"
                            onClick={() => {
                              resetDraft();
                              setSheetOpen(false);
                            }}
                          >
                            Discard draft
                          </button>
                        )}
                      </div>
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
              {!week && own && sending.length > 0 && (
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
              {!week && own && (
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
              {progress.length > 0 && (
                <section
                  className="group-bars"
                  aria-labelledby="group-bars-title"
                >
                  <h2 id="group-bars-title">The Group this week</h2>
                  <ul>
                    {progress.map((item) => (
                      <li key={item.membershipId}>
                        <span className="group-bars-head">
                          <Avatar
                            name={item.displayName}
                            url={avatars[item.membershipId]}
                            size="sm"
                          />
                          <strong>
                            {item.membershipId === membership.membershipId
                              ? "You"
                              : item.displayName}
                          </strong>
                          <span>
                            {item.completedWorkoutCount} of {item.lockedTarget}
                          </span>
                        </span>
                        <Barbell
                          count={item.completedWorkoutCount}
                          target={item.lockedTarget}
                          size="mini"
                          activityTypes={item.activityTypes}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
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

// Cards live on Week: once it renders them, bring them into view and focus.
function focusCards() {
  const until = Date.now() + 4000;
  const find = () => {
    const cards = document.getElementById("consequence-cards");
    if (!cards) {
      if (Date.now() < until) window.setTimeout(find, 100);
      return;
    }
    cards.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    cards.focus({ preventScroll: true });
  };
  requestAnimationFrame(find);
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
    // History also shows every member's bar for the current week.
    const [historyResponse, targetResponse, progressResponse] =
      await Promise.all([
        api.history(token, groupId),
        api.target(token),
        api.progress(token, groupId).catch(() => null),
      ]);
    next.history = historyResponse.data as FinalizedWeeklyHistoryItem[];
    if (progressResponse)
      next.progress = progressResponse.data as CurrentWeekProgressItem[];
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
