import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError, overlappedWrite, writeMark } from "./api-client";
import { Avatar, useAvatars } from "./avatars";
import { useConfirm } from "./Confirm";
import { detailLine } from "./details";
import { useFreshness } from "./freshness";
import { markViewed, viewedPost } from "./Notifications";
import { PostText } from "./PostText";
import { persistentMap } from "./persist";
import {
  actOnProof,
  cachedReactors,
  deleteProof,
  loadProofFeed,
  loadReactors,
  type ProofAction,
  type ProofItem,
  reactToProof,
  removeProofPhotos,
} from "./proof";
import { Reactions } from "./Reactions";
import { Result, useNotice } from "./Result";
import { useConduct } from "./Safety";

const feedCache = persistentMap<ProofItem[]>("feed");

// Expiry of a storage signed URL, read from its token; 0 when unknown.
const urlExpiry = (url: string | null) => {
  try {
    const token = new URL(url ?? "").searchParams.get("token") ?? "";
    const payload = token.split(".")[1] ?? "";
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    return typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
};
const usable = (url: string | null) =>
  url !== null && urlExpiry(url) > Date.now() + 5 * 60_000;
const photoPath = (url: string) => url.split("?")[0];

// Each feed load re-signs photo URLs. Keeping a still-valid URL for the same
// photo lets the browser reuse its cached image instead of downloading again.
export function keepPhotoUrls(previous: ProofItem[], next: ProofItem[]) {
  const known = new Map(previous.map((item) => [item.workoutCheckinId, item]));
  const keep = (old: string | null | undefined, fresh: string | null) =>
    old && fresh && photoPath(old) === photoPath(fresh) && usable(old)
      ? old
      : fresh;
  return next.map((item) => {
    const old = known.get(item.workoutCheckinId);
    return {
      ...item,
      activityPhotoUrl: keep(old?.activityPhotoUrl, item.activityPhotoUrl),
      presencePhotoUrl: keep(old?.presencePhotoUrl, item.presencePhotoUrl),
    };
  });
}

// With the service worker in control, an expired URL still finds the photo
// in its cache; without it, an expired URL would only show a broken image.
const cachedFeed = (cacheKey: string) => {
  const keep = (url: string | null) =>
    usable(url) || navigator.serviceWorker?.controller ? url : null;
  return feedCache.get(cacheKey)?.map((item) => ({
    ...item,
    activityPhotoUrl: keep(item.activityPhotoUrl),
    presencePhotoUrl: keep(item.presencePhotoUrl),
  }));
};

type PhotoState = "loaded" | "failed";

// Feeds cached before custom reactions held a preset-keyed object.
const reactionList = (item: ProofItem) =>
  Array.isArray(item.reactions) ? item.reactions : [];

const label = (value: string) => value[0]?.toUpperCase() + value.slice(1);
const remaining = (until: string | null) => {
  if (!until) return "";
  const hours = Math.max(
    0,
    Math.ceil((new Date(until).getTime() - Date.now()) / 3_600_000),
  );
  return hours <= 1 ? "under 1 hour left" : `${hours}h left`;
};
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
const dayLabel = (iso: string) => {
  const day = new Date(iso);
  const today = new Date();
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};

const weekMs = 7 * 86_400_000;
// Start of the previous accountability week, from the current week's end.
// A cached end that has passed rolls forward, so Home never shows a stale window.
export const feedWindowStart = (endsAt: string | null | undefined) => {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  if (Number.isNaN(end)) return null;
  const weeks = Math.max(0, Math.ceil((Date.now() - end + 1) / weekMs));
  return end + weeks * weekMs - 2 * weekMs;
};

const needsKey = "needs-you-collapsed";
const readNeedsOpen = () => {
  try {
    return localStorage.getItem(needsKey) !== "1";
  } catch {
    return true;
  }
};
const writeNeedsOpen = (open: boolean) => {
  try {
    if (open) localStorage.removeItem(needsKey);
    else localStorage.setItem(needsKey, "1");
  } catch {
    // Collapse state is a per-device convenience.
  }
};

// Referee lights: white accepts, red rejects, dark still to vote.
function Lights({ item }: { item: ProofItem }) {
  const voters = Math.max(
    item.eligibleVoters,
    item.acceptVotes + item.rejectVotes,
  );
  const left = voters - item.acceptVotes - item.rejectVotes;
  return (
    <span
      className="referee-lights"
      role="img"
      aria-label={`${item.acceptVotes} accept, ${item.rejectVotes} reject, ${left} still to vote`}
    >
      {Array.from({ length: voters }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: lights are positional.
          key={index}
          className={
            index < item.acceptVotes
              ? "is-white"
              : index < item.acceptVotes + item.rejectVotes
                ? "is-red"
                : undefined
          }
        />
      ))}
    </span>
  );
}

// The Wall feed rendered on Home: proof waiting on the viewer first, then everything by day.
// Feed state without the posts, for Week's review status and settle line.
export function useFeedItems(
  apiBaseUrl: string,
  token: string,
  cacheKey: string,
  enabled: boolean,
  onItems: (items: ProofItem[]) => void,
  onRevoked: () => void,
) {
  const fresh = useFreshness();
  useEffect(() => {
    void fresh;
    if (!enabled) return;
    let active = true;
    const previous = cachedFeed(cacheKey);
    if (previous) onItems(previous);
    loadProofFeed(apiBaseUrl, token)
      .then((loaded) => {
        if (!active) return;
        const next = keepPhotoUrls(feedCache.get(cacheKey) ?? [], loaded);
        feedCache.set(cacheKey, next);
        onItems(next);
      })
      .catch((error) => {
        if (
          active &&
          error instanceof ApiError &&
          error.kind === "unauthorized"
        )
          onRevoked();
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, cacheKey, enabled, onItems, onRevoked, fresh]);
}

export function ProofFeed({
  apiBaseUrl,
  token,
  revision,
  cacheKey,
  onRevoked,
  onItems,
  onDeleted,
  windowEndsAt,
  needsExtra,
  needsExtraCount = 0,
  needsExtraShown = false,
}: {
  apiBaseUrl: string;
  token: string;
  revision: number;
  cacheKey: string;
  onRevoked: () => void;
  onItems: (items: ProofItem[]) => void;
  onDeleted?: (currentWeekCount: number) => void;
  // End of the current accountability week; Home shows it and the week before.
  windowEndsAt?: string | null;
  // The member's own Needs you items beside questioned posts (cards, ballots).
  needsExtra?: ReactNode;
  // What in needsExtra waits on the viewer, and whether it shows at all.
  needsExtraCount?: number;
  needsExtraShown?: boolean;
}) {
  const [items, setItems] = useState<ProofItem[]>(
    () => cachedFeed(cacheKey) ?? [],
  );
  const [state, setState] = useState<"loading" | "ready" | "error">(() =>
    feedCache.has(cacheKey) ? "ready" : "loading",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const fresh = useFreshness();
  // Posts the viewer just acted on; their buttons hide before the refetch lands.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useNotice();
  // Per-photo load state; a vote can only accept proof the viewer has seen.
  const [photoState, setPhotoState] = useState<Record<string, PhotoState>>({});
  const [photoRetry, setPhotoRetry] = useState<Record<string, number>>({});
  const avatars = useAvatars();
  // The comment icon asks that post's text block to open its composer.
  const [commenting, setCommenting] = useState({ id: "", count: 0 });
  // Own-post menu: which post's menu is open, and which caption composer to open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [captioning, setCaptioning] = useState({ id: "", count: 0 });
  const [captioned, setCaptioned] = useState<ReadonlySet<string>>(new Set());
  const [needsOpen, setNeedsOpen] = useState(readNeedsOpen);
  // The post open full screen, and the tile that opened it for focus return.
  const [viewing, setViewing] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openPost = (id: string, from: HTMLElement) => {
    opener.current = from;
    setViewing(id);
  };
  const closePost = useCallback(() => {
    setViewing(null);
    opener.current?.focus();
  }, []);
  const viewingOpen = viewing !== null;
  useEffect(() => {
    if (!viewingOpen) return;
    closeRef.current?.focus();
    document.documentElement.classList.add("post-viewer-open");
    const onKey = (event: KeyboardEvent) => {
      // Tab stays inside the post; a sheet over it keeps its own trap.
      const viewer = document.querySelector<HTMLElement>(".post-viewer");
      if (
        event.key === "Tab" &&
        viewer &&
        !event.defaultPrevented &&
        !document.querySelector(".sheet-layer")
      ) {
        const controls = [
          ...viewer.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!viewer.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      // A confirm sheet or menu over the post handles its own Escape.
      if (
        event.key === "Escape" &&
        !document.querySelector(".sheet-layer, .post-menu-list")
      )
        closePost();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("post-viewer-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [viewingOpen, closePost]);
  useEffect(() => {
    if (!menuFor) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !(event.target as Element).closest?.(".post-menu")
      )
        setMenuFor(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuFor]);
  const [confirmSheet, ask] = useConfirm();
  const [conductSheet, ensureConduct] = useConduct(apiBaseUrl, token);
  const confirmReport = useCallback(
    () =>
      ask({
        title: "Report this message?",
        body: "It’s hidden for everyone right away and the operator reviews it. The writer isn’t told who reported it.",
        confirm: "Report message",
        tone: "danger",
      }),
    [ask],
  );

  useEffect(() => {
    void revision;
    void reload;
    void fresh;
    let active = true;
    const mark = writeMark();
    const previous = cachedFeed(cacheKey);
    if (previous) onItems(previous);
    loadProofFeed(apiBaseUrl, token)
      .then((loaded) => {
        // A reload landing under an optimistic change waits for the next one.
        if (!active || (previous && overlappedWrite(mark))) return;
        const next = keepPhotoUrls(feedCache.get(cacheKey) ?? [], loaded);
        feedCache.set(cacheKey, next);
        setItems((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
        onItems(next);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        // Cached posts stay on screen when a refresh fails.
        if (!previous) setState("error");
      });
    return () => {
      active = false;
    };
  }, [
    apiBaseUrl,
    token,
    revision,
    reload,
    fresh,
    cacheKey,
    onRevoked,
    onItems,
  ]);

  const act = useCallback(
    async (
      item: ProofItem,
      action: ProofAction,
      choice: string,
      done: string,
    ) => {
      const id = item.workoutCheckinId;
      // Optimistic: show the outcome at once; a failure restores the post.
      // Removing photos cannot be undone, so it waits for the server.
      const instant =
        action === "review" ||
        action === "vote" ||
        (action === "moderate" && choice === "restore");
      const optimistic: ProofItem = !instant
        ? item
        : action === "moderate"
          ? { ...item, hidden: false }
          : action === "vote"
            ? {
                ...item,
                myVote: choice as ProofItem["myVote"],
                acceptVotes: item.acceptVotes + (choice === "accept" ? 1 : 0),
                rejectVotes: item.rejectVotes + (choice === "reject" ? 1 : 0),
              }
            : // The questioner is in the decision audience, so they can vote next.
              {
                ...item,
                reviewStatus: "questioned",
                canReview: false,
                canVote: true,
              };
      const swap = (next: ProofItem) =>
        setItems((current) =>
          current.map((entry) =>
            entry.workoutCheckinId === id ? next : entry,
          ),
        );
      setBusy(id);
      if (action !== "review") setDecided((ids) => new Set(ids).add(id));
      const confirm = () => setNotice({ kind: "success", text: done });
      if (instant) {
        swap(optimistic);
        confirm();
      }
      try {
        await actOnProof(apiBaseUrl, token, id, action, choice);
        if (!instant) confirm();
      } catch (error) {
        setDecided((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
        swap(item);
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Couldn’t save. Try again.",
        });
      } finally {
        setBusy((current) => (current === id ? null : current));
        setReload((value) => value + 1);
      }
    },
    [apiBaseUrl, token, onRevoked, setNotice],
  );

  // Optimistic: the tap shows at once; a failure undoes just that emoji.
  const react = useCallback(
    async (item: ProofItem, emoji: string, on: boolean) => {
      const id = item.workoutCheckinId;
      const apply = (post: ProofItem, add: boolean): ProofItem => {
        const step = add ? 1 : -1;
        const listed = reactionList(post).some(
          (entry) => entry.emoji === emoji,
        );
        const reactions = (
          listed
            ? reactionList(post).map((entry) =>
                entry.emoji === emoji
                  ? { ...entry, count: entry.count + step }
                  : entry,
              )
            : [...reactionList(post), { emoji, count: 1 }]
        ).filter((entry) => entry.count > 0);
        const mine = post.myReactions ?? [];
        return {
          ...post,
          reactions,
          myReactions: add
            ? [...mine, emoji]
            : mine.filter((entry) => entry !== emoji),
        };
      };
      const update = (add: boolean) =>
        setItems((current) =>
          current.map((post) =>
            post.workoutCheckinId === id ? apply(post, add) : post,
          ),
        );
      update(on);
      try {
        await reactToProof(apiBaseUrl, token, id, emoji, on);
      } catch (error) {
        update(!on);
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Couldn’t save. Try again.",
        });
      }
    },
    [apiBaseUrl, token, onRevoked, setNotice],
  );

  // Deleting cannot be undone, so only its button waits on the server.
  const remove = useCallback(
    async (item: ProofItem) => {
      const id = item.workoutCheckinId;
      setBusy(id);
      try {
        const result = await deleteProof(apiBaseUrl, token, id);
        const keep = (list: ProofItem[]) =>
          list.filter((entry) => entry.workoutCheckinId !== id);
        setItems(keep);
        feedCache.set(cacheKey, keep(feedCache.get(cacheKey) ?? []));
        onDeleted?.(result.currentWeekCount);
        setNotice({
          kind: "success",
          text: "Post deleted. It no longer counts, so log a new one any time this week.",
        });
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Couldn’t delete. Try again.",
        });
      } finally {
        setBusy((current) => (current === id ? null : current));
      }
    },
    [apiBaseUrl, token, cacheKey, onDeleted, onRevoked, setNotice],
  );

  // Taking photos down cannot be undone either; the workout keeps counting.
  const takeDown = useCallback(
    async (item: ProofItem) => {
      const id = item.workoutCheckinId;
      setBusy(id);
      try {
        await removeProofPhotos(apiBaseUrl, token, id);
        const keep = (list: ProofItem[]) =>
          list.filter((entry) => entry.workoutCheckinId !== id);
        setItems(keep);
        feedCache.set(cacheKey, keep(feedCache.get(cacheKey) ?? []));
        setNotice({
          kind: "success",
          text: "Photos removed. The workout still counts.",
        });
      } catch (error) {
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Couldn’t remove. Try again.",
        });
      } finally {
        setBusy((current) => (current === id ? null : current));
      }
    },
    [apiBaseUrl, token, cacheKey, onRevoked, setNotice],
  );

  // A post scrolled into view clears the notifications about it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new posts need observing.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.post;
          if (!entry.isIntersecting || !id) continue;
          observer.unobserve(entry.target);
          markViewed(viewedPost(id));
        }
      },
      { threshold: 0.5 },
    );
    for (const node of document.querySelectorAll("[data-post]"))
      observer.observe(node);
    return () => observer.disconnect();
  }, [items]);

  // A choice already made, here or on another device, needs no buttons.
  const canQuestion = (item: ProofItem) =>
    !decided.has(item.workoutCheckinId) && item.canReview;
  const needsVote = (item: ProofItem) =>
    !decided.has(item.workoutCheckinId) && item.canVote && !item.myVote;
  const windowStart = feedWindowStart(windowEndsAt);
  const inWindow = (item: ProofItem) =>
    windowStart === null || Date.parse(item.submittedAt) >= windowStart;
  const byNewest = (left: ProofItem, right: ProofItem) =>
    Date.parse(right.submittedAt) - Date.parse(left.submittedAt);
  // Questioned posts leave the rows for Needs you; one still open for a vote stays reachable.
  const questioned = items
    .filter(
      (item) =>
        item.reviewStatus === "questioned" &&
        (inWindow(item) || needsVote(item)),
    )
    .sort(byNewest);
  const days = new Map<string, ProofItem[]>();
  for (const item of items
    .filter((entry) => entry.reviewStatus !== "questioned" && inWindow(entry))
    .sort(byNewest)) {
    const key = dayLabel(item.submittedAt);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  // Only what waits on the viewer counts; voted and own questioned posts stay listed.
  const needsCount = questioned.filter(needsVote).length + needsExtraCount;
  const needsShown = questioned.length > 0 || needsExtraShown;
  const viewed = items.find((item) => item.workoutCheckinId === viewing);

  // Own posts only: caption and delete live in a menu at the post's top right.
  const ownMenu = (item: ProofItem, disabled: boolean) => {
    const id = item.workoutCheckinId;
    const canCaption =
      !item.hidden &&
      !item.caption &&
      !captioned.has(id) &&
      Date.now() - Date.parse(item.submittedAt) < 3_600_000;
    const canRemovePhotos = !item.canDelete && item.reviewStatus === "verified";
    if (!canCaption && !item.canDelete && !canRemovePhotos) return null;
    const open = menuFor === id;
    return (
      <span className="post-menu">
        <button
          type="button"
          className="post-menu-button"
          aria-label="Post options"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setMenuFor(open ? null : id)}
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {open && (
          <span className="post-menu-list" role="menu">
            {canCaption && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuFor(null);
                  setCaptioning((current) => ({
                    id,
                    count: current.count + 1,
                  }));
                }}
              >
                Add caption
              </button>
            )}
            {item.canDelete && (
              <button
                type="button"
                role="menuitem"
                className="danger-text"
                onClick={async () => {
                  setMenuFor(null);
                  if (
                    await ask({
                      title: "Delete this post?",
                      body: "It stops counting toward this week and its photos are deleted. You can log a new workout right after.",
                      confirm: "Delete post",
                      tone: "danger",
                    })
                  )
                    void remove(item);
                }}
              >
                Delete post
              </button>
            )}
            {canRemovePhotos && (
              <button
                type="button"
                role="menuitem"
                className="danger-text"
                onClick={async () => {
                  setMenuFor(null);
                  if (
                    await ask({
                      title: "Remove these photos?",
                      body: "The photos are deleted for everyone. The workout stays verified, so your week doesn’t change.",
                      confirm: "Remove photos",
                      tone: "danger",
                    })
                  )
                    void takeDown(item);
                }}
              >
                Remove photos
              </button>
            )}
          </span>
        )}
      </span>
    );
  };

  // Photo load state for one post; a vote can only accept proof the viewer has seen.
  const photoKit = (item: ProofItem) => {
    const id = item.workoutCheckinId;
    const urls = {
      activity: item.activityPhotoUrl,
      presence: item.presencePhotoUrl,
    };
    const stateOf = (kind: keyof typeof urls) =>
      urls[kind] ? photoState[`${id}:${kind}`] : undefined;
    const photosSeen =
      stateOf("activity") === "loaded" && stateOf("presence") === "loaded";
    const photoFailed =
      stateOf("activity") === "failed" || stateOf("presence") === "failed";
    const photoMissing = !urls.activity || !urls.presence;
    const photoNote = photoMissing
      ? "Proof photos aren’t available for this post."
      : photoFailed
        ? "A proof photo didn’t load."
        : null;
    const retryPhotos = () => {
      setPhotoState((current) => {
        const next = { ...current };
        delete next[`${id}:activity`];
        delete next[`${id}:presence`];
        return next;
      });
      setPhotoRetry((current) => ({
        ...current,
        [id]: (current[id] ?? 0) + 1,
      }));
    };
    const photo = (
      kind: keyof typeof urls,
      url: string | null,
      className: string,
      alt: string,
    ) =>
      url ? (
        <img
          key={`${kind}:${photoRetry[id] ?? 0}`}
          className={`${className}${stateOf(kind) === "failed" ? " is-failed" : ""}`}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          crossOrigin="anonymous"
          onLoad={() =>
            setPhotoState((current) => ({
              ...current,
              [`${id}:${kind}`]: "loaded",
            }))
          }
          onError={() =>
            setPhotoState((current) => ({
              ...current,
              [`${id}:${kind}`]: "failed",
            }))
          }
        />
      ) : null;
    return { photo, photosSeen, photoFailed, photoNote, retryPhotos };
  };

  const post = (item: ProofItem) => {
    const disabled = busy === item.workoutCheckinId;
    const who = item.mine ? "You" : item.authorName;
    const { photo, photosSeen, photoFailed, photoNote, retryPhotos } =
      photoKit(item);
    return (
      <li
        className="proof-post"
        key={item.workoutCheckinId}
        data-post={item.workoutCheckinId}
      >
        <header>
          <Avatar name={who} url={avatars[item.authorMembershipId]} />
          <span className="proof-byline">
            <strong>{who}</strong>
            <time dateTime={item.submittedAt}>{ago(item.submittedAt)}</time>
          </span>
          <span className={`proof-status proof-${item.reviewStatus}`}>
            {item.hidden
              ? "Reported"
              : item.reviewStatus === "questioned"
                ? "Questioned"
                : "Verified ✓"}
          </span>
          {item.mine && ownMenu(item, disabled)}
        </header>
        <div className="proof-frame">
          {photo(
            "activity",
            item.activityPhotoUrl,
            "proof-main",
            `${item.mine ? "Your" : `${item.authorName}'s`} workout activity`,
          )}
          {photo(
            "presence",
            item.presencePhotoUrl,
            "proof-inset",
            `${who} at the workout`,
          )}
          {!photosSeen && photoNote && (
            <p className="proof-photo-note" role="status">
              {photoNote}
              {photoFailed && (
                <button
                  type="button"
                  className="proof-photo-retry"
                  onClick={retryPhotos}
                >
                  Retry
                </button>
              )}
            </p>
          )}
          <span className="proof-tag">
            <i className={`activity-swatch activity-${item.activityType}`} />
            {label(item.activityType)} · {item.durationMinutes} min ·{" "}
            {label(item.perceivedIntensity)}
          </span>
        </div>
        {item.details && (
          <p className="proof-details">{detailLine(item.details)}</p>
        )}
        {needsVote(item) && (
          // Vote base: continues the photo frame; Accept in chalk, Reject in red.
          <fieldset className="proof-decide" aria-label="Your vote">
            <button
              type="button"
              className="lamp-good"
              disabled={disabled || !photosSeen}
              onClick={() =>
                void act(item, "vote", "accept", "Vote saved: accept.")
              }
            >
              Accept workout
            </button>
            <button
              type="button"
              className="lamp-no"
              disabled={disabled}
              onClick={() =>
                void act(item, "vote", "reject", "Vote saved: reject.")
              }
            >
              Reject workout
            </button>
            <p className="proof-decide-hint">
              {photosSeen
                ? "The Group settles this by vote."
                : "Accept unlocks once both photos load."}
            </p>
          </fieldset>
        )}
        {canQuestion(item) && (
          <button
            type="button"
            className="proof-report"
            disabled={disabled}
            onClick={() =>
              void act(
                item,
                "review",
                "question",
                "Workout questioned. The Group votes for 48 hours.",
              )
            }
          >
            Question workout · {remaining(item.reviewClosesAt)}
          </button>
        )}
        {needsVote(item) && (
          <button
            type="button"
            className="proof-report"
            disabled={disabled}
            onClick={() =>
              void act(
                item,
                "vote",
                "cannot_assess",
                "Marked can’t assess. You won’t be reminded again.",
              )
            }
          >
            Can’t assess
          </button>
        )}
        {!item.hidden && (
          <Reactions
            reactions={reactionList(item)}
            mine={item.myReactions ?? []}
            readOnly={item.mine}
            onToggle={(emoji, on) => void react(item, emoji, on)}
            loadReactors={() =>
              loadReactors(apiBaseUrl, token, item.workoutCheckinId)
            }
            cachedReactors={() => cachedReactors(item.workoutCheckinId)}
            trailing={
              <button
                type="button"
                className="proof-reaction proof-comment"
                aria-label="Comment"
                onClick={() =>
                  setCommenting((current) => ({
                    id: item.workoutCheckinId,
                    count: current.count + 1,
                  }))
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z" />
                </svg>
              </button>
            }
          />
        )}
        {!item.hidden && (
          <PostText
            item={item}
            authorName={who}
            askCaption={
              captioning.id === item.workoutCheckinId ? captioning.count : 0
            }
            onCaptioned={() =>
              setCaptioned(
                (current) => new Set([...current, item.workoutCheckinId]),
              )
            }
            askComment={
              commenting.id === item.workoutCheckinId ? commenting.count : 0
            }
            apiBaseUrl={apiBaseUrl}
            token={token}
            ensureConduct={ensureConduct}
            confirmReport={confirmReport}
            onNotice={setNotice}
            // Photo reports are paused for now; the flow returns with moderation.
            onReportPhotos={undefined}
          />
        )}
        {item.reviewStatus === "questioned" && (
          <p className="proof-tally">
            Accept {item.acceptVotes} · Reject {item.rejectVotes} of{" "}
            {item.eligibleVoters} voters · {remaining(item.decisionClosesAt)}
          </p>
        )}
        {item.mine && item.reviewStatus === "questioned" && (
          <div className="proof-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                void act(
                  item,
                  "withdraw",
                  "",
                  "Withdrawn. It won’t count this week.",
                )
              }
            >
              Withdraw report
            </button>
          </div>
        )}
        {/* Only Group admins receive other members' reported proof. */}
        {item.hidden && !item.mine && (
          <div className="proof-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void act(item, "moderate", "restore", "Restored.")}
            >
              Restore
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                void act(item, "moderate", "remove", "Photos removed.")
              }
            >
              Remove photos
            </button>
          </div>
        )}
        {item.mine && disabled && (
          <p className="proof-tally" role="status">
            {item.canDelete ? "Deleting…" : "Removing…"}
          </p>
        )}
      </li>
    );
  };

  // A questioned post in Needs you: who, the tally in referee lights, and the vote.
  const questionedCard = (item: ProofItem) => {
    const id = item.workoutCheckinId;
    const disabled = busy === id;
    const who = item.mine ? "You" : item.authorName;
    const { photo, photosSeen } = photoKit(item);
    const voted = decided.has(id) || item.myVote;
    return (
      <li className="needs-post" key={id} data-post={id}>
        <button
          type="button"
          className="needs-thumb"
          aria-label={`Open ${item.mine ? "your" : `${item.authorName}’s`} post`}
          onClick={(event) => openPost(id, event.currentTarget)}
        >
          {photo(
            "activity",
            item.activityPhotoUrl,
            "needs-thumb-main",
            `${item.mine ? "Your" : `${item.authorName}'s`} workout activity`,
          )}
          {photo(
            "presence",
            item.presencePhotoUrl,
            "needs-thumb-inset",
            `${who} at the workout`,
          )}
        </button>
        <div className="needs-post-body">
          <p className="needs-post-title">
            <strong>
              {item.mine ? "Your" : `${item.authorName}’s`} {item.activityType}{" "}
              was questioned
            </strong>
            <Lights item={item} />
          </p>
          <p className="needs-post-note">
            {label(item.activityType)}, {item.durationMinutes} min. It still
            counts unless most of the Group rejects it.
          </p>
          <p className="proof-tally">
            Accept {item.acceptVotes} · Reject {item.rejectVotes} of{" "}
            {item.eligibleVoters} voters · {remaining(item.decisionClosesAt)}
          </p>
        </div>
        {needsVote(item) ? (
          <fieldset className="needs-vote" aria-label="Your vote">
            <button
              type="button"
              className="needs-accept"
              aria-label="Accept workout"
              disabled={disabled || !photosSeen}
              onClick={() =>
                void act(item, "vote", "accept", "Vote saved: accept.")
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="needs-reject"
              aria-label="Reject workout"
              disabled={disabled}
              onClick={() =>
                void act(item, "vote", "reject", "Vote saved: reject.")
              }
            >
              Reject
            </button>
            <button
              type="button"
              className="needs-unsure"
              disabled={disabled}
              onClick={() =>
                void act(
                  item,
                  "vote",
                  "cannot_assess",
                  "Marked can’t assess. You won’t be reminded again.",
                )
              }
            >
              Can’t assess
            </button>
          </fieldset>
        ) : item.mine ? (
          <div className="needs-vote">
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() =>
                void act(
                  item,
                  "withdraw",
                  "",
                  "Withdrawn. It won’t count this week.",
                )
              }
            >
              Withdraw report
            </button>
          </div>
        ) : voted ? (
          <p className="needs-voted">
            {item.myVote === "cannot_assess" || !item.myVote
              ? "Your vote is in."
              : `You voted ${item.myVote}.`}{" "}
            The Group settles the rest.
          </p>
        ) : null}
      </li>
    );
  };

  const tile = (item: ProofItem) => {
    const id = item.workoutCheckinId;
    const who = item.mine ? "You" : item.authorName;
    const workout = `${label(item.activityType)} · ${item.durationMinutes} min`;
    return (
      <li key={id} className="day-tile">
        <button
          type="button"
          className="day-tile-open"
          data-post={id}
          aria-label={`${who}, ${workout}. Open post`}
          onClick={(event) => openPost(id, event.currentTarget)}
        >
          {item.activityPhotoUrl ? (
            <img
              className="day-tile-photo"
              src={item.activityPhotoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              crossOrigin="anonymous"
            />
          ) : (
            <span className="day-tile-photo" />
          )}
          <span className="day-tile-cap" aria-hidden="true">
            <strong className="day-tile-name">{who}</strong>
            <span className="day-tile-workout">
              {item.hidden ? "Reported" : workout}
            </span>
          </span>
          <i
            className={`day-tile-plate activity-swatch activity-${item.activityType}`}
            aria-hidden="true"
          />
        </button>
      </li>
    );
  };

  return (
    <section className="proof-feed" aria-label="Proof feed">
      <Result notice={notice} />
      {state === "loading" ? (
        <div
          className="day-rows-skeleton"
          role="status"
          aria-label="Loading posts"
        >
          <span className="skeleton day-skeleton-head" />
          <span className="day-skeleton-reel">
            <span className="skeleton day-skeleton-tile" />
            <span className="skeleton day-skeleton-tile" />
            <span className="skeleton day-skeleton-tile" />
          </span>
        </div>
      ) : state === "error" ? (
        <div className="proof-feed-note">
          <p role="alert">Couldn’t load the proof feed.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReload((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : null}
      {state !== "error" && needsShown && (
        <section
          id="needs-you"
          className={`needs-you-panel${needsOpen ? " is-open" : ""}`}
          aria-labelledby="needs-you-heading"
        >
          <h2 id="needs-you-heading" className="needs-you-heading">
            <button
              type="button"
              className="needs-you-toggle"
              aria-expanded={needsOpen}
              aria-controls="needs-you-body"
              aria-label={
                needsCount > 0 ? `Needs you ${needsCount} waiting` : "Needs you"
              }
              onClick={() => {
                writeNeedsOpen(!needsOpen);
                setNeedsOpen(!needsOpen);
              }}
            >
              <span>Needs you</span>
              {needsCount > 0 && (
                <span className="feed-badge">{needsCount}</span>
              )}
              <span className="needs-you-chevron" aria-hidden="true" />
            </button>
          </h2>
          {needsOpen && (
            <div id="needs-you-body" className="needs-you-body">
              {questioned.length > 0 && (
                <ul className="needs-posts" aria-label="Questioned workouts">
                  {questioned.map(questionedCard)}
                </ul>
              )}
              {needsExtra}
            </div>
          )}
        </section>
      )}
      {state === "ready" &&
        (days.size === 0 ? (
          <p className="proof-feed-note">No posts this week or last.</p>
        ) : (
          <ol className="day-rows" aria-label="Posts by day">
            {[...days.entries()].map(([day, posts]) => (
              <li key={day} className="day-row">
                <h2 className="day-row-head">
                  <span>{day}</span>
                  <span className="day-row-count">
                    {posts.length} {posts.length === 1 ? "post" : "posts"}
                  </span>
                </h2>
                <ul
                  className="day-reel"
                  aria-label={`${day} posts`}
                  // Scrolls sideways; keyboard users reach the tiles inside.
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region.
                  tabIndex={0}
                >
                  {posts.map(tile)}
                </ul>
              </li>
            ))}
          </ol>
        ))}
      {viewed && (
        <div
          className="post-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`${viewed.mine ? "Your" : `${viewed.authorName}’s`} post`}
        >
          <div className="post-viewer-bar">
            <button
              ref={closeRef}
              type="button"
              className="post-viewer-close"
              aria-label="Close post"
              onClick={closePost}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <ul className="proof-list post-viewer-list">{post(viewed)}</ul>
        </div>
      )}
      {confirmSheet}
      {conductSheet}
    </section>
  );
}
