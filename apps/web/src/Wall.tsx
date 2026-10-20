import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api-client";
import { useConfirm } from "./Confirm";
import { detailLine } from "./details";
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

// A photo the cache missed under an expired URL stays hidden until the feed
// brings a fresh one.
const photoEvents = {
  onLoad: (event: { currentTarget: HTMLImageElement }) => {
    event.currentTarget.style.visibility = "";
  },
  onError: (event: { currentTarget: HTMLImageElement }) => {
    event.currentTarget.style.visibility = "hidden";
  },
};

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

// The Wall feed rendered on Home: proof waiting on the viewer first, then everything by day.
export function ProofFeed({
  apiBaseUrl,
  token,
  revision,
  cacheKey,
  onRevoked,
  onItems,
  onDeleted,
}: {
  apiBaseUrl: string;
  token: string;
  revision: number;
  cacheKey: string;
  onRevoked: () => void;
  onItems: (items: ProofItem[]) => void;
  onDeleted?: (currentWeekCount: number) => void;
}) {
  const [items, setItems] = useState<ProofItem[]>(
    () => cachedFeed(cacheKey) ?? [],
  );
  const [state, setState] = useState<"loading" | "ready" | "error">(() =>
    feedCache.has(cacheKey) ? "ready" : "loading",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [stamped, setStamped] = useState<string | null>(null);
  // Posts the viewer just acted on; their buttons hide before the refetch lands.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useNotice();
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
    let active = true;
    const previous = cachedFeed(cacheKey);
    if (previous) onItems(previous);
    loadProofFeed(apiBaseUrl, token)
      .then((loaded) => {
        if (!active) return;
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
  }, [apiBaseUrl, token, revision, reload, cacheKey, onRevoked, onItems]);

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
            : {
                ...item,
                reviewStatus: choice === "verify" ? "verified" : "questioned",
              };
      const swap = (next: ProofItem) =>
        setItems((current) =>
          current.map((entry) =>
            entry.workoutCheckinId === id ? next : entry,
          ),
        );
      setBusy(id);
      setDecided((ids) => new Set(ids).add(id));
      const confirm = () => {
        if (action === "review" && choice === "verify") {
          setStamped(id);
          window.setTimeout(() => setStamped(null), 900);
        }
        setNotice({ kind: "success", text: done });
      };
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

  // A choice already made, here or on another device, needs no buttons.
  const needsReview = (item: ProofItem) =>
    !decided.has(item.workoutCheckinId) && item.canReview;
  const needsVote = (item: ProofItem) =>
    !decided.has(item.workoutCheckinId) && item.canVote && !item.myVote;
  const toReview = items.filter((item) => needsReview(item) || needsVote(item));
  const days = new Map<string, ProofItem[]>();
  for (const item of items.filter((entry) => !toReview.includes(entry))) {
    const key = dayLabel(item.submittedAt);
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  const post = (item: ProofItem) => {
    const disabled = busy === item.workoutCheckinId;
    const who = item.mine ? "You" : item.authorName;
    return (
      <li className="proof-post" key={item.workoutCheckinId}>
        <header>
          <span className="proof-avatar" aria-hidden="true">
            {who.slice(0, 2).toUpperCase()}
          </span>
          <strong>{who}</strong>
          <span className={`proof-status proof-${item.reviewStatus}`}>
            {item.hidden
              ? "Reported"
              : item.reviewStatus === "pending"
                ? item.canReview
                  ? `Review · ${remaining(item.reviewClosesAt)}`
                  : "Awaiting review"
                : item.reviewStatus === "questioned"
                  ? "Questioned"
                  : "Verified ✓"}
          </span>
        </header>
        <div className="proof-frame">
          {item.activityPhotoUrl && (
            <img
              className="proof-main"
              src={item.activityPhotoUrl}
              alt={`${item.mine ? "Your" : `${item.authorName}'s`} workout activity`}
              loading="lazy"
              decoding="async"
              crossOrigin="anonymous"
              {...photoEvents}
            />
          )}
          {item.presencePhotoUrl && (
            <img
              className="proof-inset"
              src={item.presencePhotoUrl}
              alt={`${who} at the workout`}
              loading="lazy"
              decoding="async"
              crossOrigin="anonymous"
              {...photoEvents}
            />
          )}
          <span className="proof-tag">
            <i className={`activity-swatch activity-${item.activityType}`} />
            {label(item.activityType)} · {item.durationMinutes} min ·{" "}
            {label(item.perceivedIntensity)}
          </span>
          {stamped === item.workoutCheckinId && (
            <span className="proof-stamp" aria-hidden="true">
              Verified
            </span>
          )}
        </div>
        {item.details && (
          <p className="proof-details">{detailLine(item.details)}</p>
        )}
        {(needsReview(item) || needsVote(item)) && (
          // Referee light box: the photo sits on a base holding white and red lamps.
          <fieldset
            className="proof-decide"
            aria-label={needsReview(item) ? "Review" : "Your vote"}
          >
            <button
              type="button"
              className="lamp-good"
              disabled={disabled}
              onClick={() =>
                void (needsReview(item)
                  ? act(item, "review", "verify", "Good lift. Verified.")
                  : act(item, "vote", "accept", "Good lift. Vote saved."))
              }
            >
              <span className="lamp" aria-hidden="true" />
              Good lift
            </button>
            <button
              type="button"
              className="lamp-no"
              disabled={disabled}
              onClick={() =>
                void (needsReview(item)
                  ? act(
                      item,
                      "review",
                      "question",
                      "No lift. The Group votes for 48 hours.",
                    )
                  : act(item, "vote", "reject", "No lift. Vote saved."))
              }
            >
              <span className="lamp" aria-hidden="true" />
              No lift
            </button>
          </fieldset>
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
                "Marked can’t tell. You won’t be reminded again.",
              )
            }
          >
            Can’t tell from these photos
          </button>
        )}
        {!item.hidden && (!item.mine || reactionList(item).length > 0) && (
          <Reactions
            reactions={reactionList(item)}
            mine={item.myReactions ?? []}
            readOnly={item.mine}
            onToggle={(emoji, on) => void react(item, emoji, on)}
            loadReactors={() =>
              loadReactors(apiBaseUrl, token, item.workoutCheckinId)
            }
            cachedReactors={() => cachedReactors(item.workoutCheckinId)}
          />
        )}
        {!item.hidden && (
          <PostText
            item={item}
            apiBaseUrl={apiBaseUrl}
            token={token}
            ensureConduct={ensureConduct}
            confirmReport={confirmReport}
            onNotice={setNotice}
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
        {item.mine && item.canDelete && (
          <button
            type="button"
            className="proof-report"
            disabled={disabled}
            onClick={async () => {
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
            {disabled ? "Deleting…" : "Delete post"}
          </button>
        )}
        {!item.mine && !item.hidden && (
          <button
            type="button"
            className="proof-report"
            disabled={disabled}
            onClick={async () => {
              if (
                await ask({
                  title: "Report these photos?",
                  body: "They’ll be hidden from the Group until the Group admin reviews them.",
                  confirm: "Report photos",
                  tone: "danger",
                })
              )
                void act(
                  item,
                  "report",
                  "",
                  "Reported. The photos are hidden.",
                );
            }}
          >
            Report photos
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="proof-feed" aria-label="Proof feed">
      <Result notice={notice} />
      {confirmSheet}
      {conductSheet}
      {state === "loading" ? (
        <p role="status" className="proof-feed-note">
          Loading proof…
        </p>
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
      ) : items.length === 0 ? (
        <p className="proof-feed-note">
          No proof yet this week. Log a workout and be first.
        </p>
      ) : (
        <>
          {toReview.length > 0 && (
            <section aria-labelledby="feed-review-heading">
              <h2 id="feed-review-heading" className="feed-day">
                Needs your review
                <span className="feed-badge">{toReview.length}</span>
              </h2>
              <ul className="proof-list">{toReview.map(post)}</ul>
            </section>
          )}
          {[...days.entries()].map(([day, posts]) => (
            <section key={day} aria-label={day}>
              <h2 className="feed-day">{day}</h2>
              <ul className="proof-list">{posts.map(post)}</ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}
