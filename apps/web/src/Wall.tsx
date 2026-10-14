import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api-client";
import { useConfirm } from "./Confirm";
import { persistentMap } from "./persist";
import {
  actOnProof,
  loadProofFeed,
  type ProofAction,
  type ProofItem,
} from "./proof";
import { Result, useNotice } from "./Result";

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

const cachedFeed = (cacheKey: string) =>
  feedCache.get(cacheKey)?.map((item) => ({
    ...item,
    activityPhotoUrl: usable(item.activityPhotoUrl)
      ? item.activityPhotoUrl
      : null,
    presencePhotoUrl: usable(item.presencePhotoUrl)
      ? item.presencePhotoUrl
      : null,
  }));

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
}: {
  apiBaseUrl: string;
  token: string;
  revision: number;
  cacheKey: string;
  onRevoked: () => void;
  onItems: (items: ProofItem[]) => void;
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
      setBusy(item.workoutCheckinId);
      // Hide the choice the instant it's tapped; a failure puts it back.
      setDecided((ids) => new Set(ids).add(item.workoutCheckinId));
      try {
        await actOnProof(
          apiBaseUrl,
          token,
          item.workoutCheckinId,
          action,
          choice,
        );
        if (action === "review" && choice === "verify") {
          setStamped(item.workoutCheckinId);
          window.setTimeout(() => setStamped(null), 900);
        }
        setNotice({ kind: "success", text: done });
      } catch (error) {
        setDecided((ids) => {
          const next = new Set(ids);
          next.delete(item.workoutCheckinId);
          return next;
        });
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setNotice({
          kind: "error",
          text:
            error instanceof ApiError
              ? error.message
              : "Action failed. Try again.",
        });
      } finally {
        setBusy(null);
        setReload((value) => value + 1);
      }
    },
    [apiBaseUrl, token, onRevoked, setNotice],
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
    const disabled = busy !== null;
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
            />
          )}
          {item.presencePhotoUrl && (
            <img
              className="proof-inset"
              src={item.presencePhotoUrl}
              alt={`${who} at the workout`}
              loading="lazy"
              decoding="async"
            />
          )}
          <span className="proof-tag">
            <i className={`activity-swatch activity-${item.activityType}`} />
            {label(item.activityType)} · {item.durationMinutes} min ·{" "}
            {label(item.perceivedIntensity)}
          </span>
          {needsReview(item) && (
            <fieldset className="proof-decide" aria-label="Review">
              <button
                type="button"
                className="decide-no"
                disabled={disabled}
                onClick={() =>
                  void act(
                    item,
                    "review",
                    "question",
                    "Questioned. The Group votes for 48 hours.",
                  )
                }
              >
                <span className="decide-mark" aria-hidden="true">
                  ?
                </span>
                Question
              </button>
              <button
                type="button"
                className="decide-yes"
                disabled={disabled}
                onClick={() => void act(item, "review", "verify", "Verified.")}
              >
                <span className="decide-mark" aria-hidden="true">
                  ✓
                </span>
                Verify
              </button>
            </fieldset>
          )}
          {!needsReview(item) && needsVote(item) && (
            <fieldset className="proof-decide" aria-label="Your vote">
              {(
                [
                  ["reject", "✕", "Reject", "decide-no"],
                  ["cannot_assess", "–", "Can’t tell", "decide-skip"],
                  ["accept", "✓", "Accept", "decide-yes"],
                ] as const
              ).map(([choice, mark, text, tone]) => (
                <button
                  type="button"
                  key={choice}
                  className={tone}
                  disabled={disabled}
                  onClick={() => void act(item, "vote", choice, "Vote saved.")}
                >
                  <span className="decide-mark" aria-hidden="true">
                    {mark}
                  </span>
                  {text}
                </button>
              ))}
            </fieldset>
          )}
          {stamped === item.workoutCheckinId && (
            <span className="proof-stamp" aria-hidden="true">
              Verified
            </span>
          )}
        </div>
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
