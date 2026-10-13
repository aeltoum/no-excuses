import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api-client";
import {
  actOnProof,
  loadProofFeed,
  type ProofAction,
  type ProofItem,
} from "./proof";
import { Result, useNotice } from "./Result";

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
  onRevoked,
  onItems,
}: {
  apiBaseUrl: string;
  token: string;
  revision: number;
  onRevoked: () => void;
  onItems: (items: ProofItem[]) => void;
}) {
  const [items, setItems] = useState<ProofItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [stamped, setStamped] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();

  useEffect(() => {
    void revision;
    void reload;
    let active = true;
    loadProofFeed(apiBaseUrl, token)
      .then((next) => {
        if (!active) return;
        setItems(next);
        onItems(next);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, revision, reload, onRevoked, onItems]);

  const act = useCallback(
    async (
      item: ProofItem,
      action: ProofAction,
      choice: string,
      done: string,
    ) => {
      setBusy(item.workoutCheckinId);
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

  const toReview = items.filter((item) => item.canReview || item.canVote);
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
            />
          )}
          {item.presencePhotoUrl && (
            <img
              className="proof-inset"
              src={item.presencePhotoUrl}
              alt={`${who} at the workout`}
              loading="lazy"
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
        {item.reviewStatus === "questioned" && (
          <p className="proof-tally">
            Accept {item.acceptVotes} · Reject {item.rejectVotes} of{" "}
            {item.eligibleVoters} voters · {remaining(item.decisionClosesAt)}
          </p>
        )}
        {item.canReview && (
          <div className="proof-actions">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void act(item, "review", "verify", "Verified.")}
            >
              Verify
            </button>
            <button
              type="button"
              className="secondary-button"
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
              Question
            </button>
          </div>
        )}
        {item.canVote && (
          <fieldset className="proof-actions">
            <legend>Your vote</legend>
            {(
              [
                ["accept", "Accept"],
                ["reject", "Reject"],
                ["cannot_assess", "Can’t assess"],
              ] as const
            ).map(([choice, text]) => (
              <button
                type="button"
                key={choice}
                aria-pressed={item.myVote === choice}
                className={choice === "accept" ? undefined : "secondary-button"}
                disabled={disabled}
                onClick={() => void act(item, "vote", choice, "Vote saved.")}
              >
                {text}
              </button>
            ))}
          </fieldset>
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
            onClick={() => {
              if (
                window.confirm(
                  "Report these photos as inappropriate? They’ll be hidden until the Group admin reviews them.",
                )
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
