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
  return hours <= 1 ? "under 1 hour left" : `${hours} hours left`;
};

export function Wall({
  apiBaseUrl,
  token,
  onRevoked,
}: {
  apiBaseUrl: string;
  token: string;
  onRevoked: () => void;
}) {
  const [items, setItems] = useState<ProofItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useNotice();

  useEffect(() => {
    void revision;
    let active = true;
    loadProofFeed(apiBaseUrl, token)
      .then((next) => {
        if (!active) return;
        setItems(next);
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
  }, [apiBaseUrl, token, revision, onRevoked]);

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
        setRevision((value) => value + 1);
      }
    },
    [apiBaseUrl, token, onRevoked, setNotice],
  );

  const toReview = items.filter((item) => item.canReview || item.canVote);
  const rest = items.filter((item) => !(item.canReview || item.canVote));

  const card = (item: ProofItem) => {
    const disabled = busy !== null;
    return (
      <li className="proof-card" key={item.workoutCheckinId}>
        <header>
          <strong>{item.mine ? "You" : item.authorName}</strong>
          <span className={`proof-status proof-${item.reviewStatus}`}>
            {item.hidden
              ? "Reported"
              : item.reviewStatus === "pending"
                ? "Awaiting review"
                : item.reviewStatus === "questioned"
                  ? "Questioned"
                  : "Verified"}
          </span>
        </header>
        <p className="proof-detail">
          {label(item.activityType)} · {item.durationMinutes} min ·{" "}
          {label(item.perceivedIntensity)} ·{" "}
          {new Date(item.completedAt).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </p>
        <div className="proof-photos">
          {item.activityPhotoUrl && (
            <img
              src={item.activityPhotoUrl}
              alt={`${item.mine ? "Your" : `${item.authorName}'s`} workout activity`}
              loading="lazy"
            />
          )}
          {item.presencePhotoUrl && (
            <img
              src={item.presencePhotoUrl}
              alt={`${item.mine ? "You" : item.authorName} at the workout`}
              loading="lazy"
            />
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
            <small>
              {remaining(item.reviewClosesAt)} before it auto-verifies
            </small>
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
    <section className="hero wall">
      <p className="eyebrow">Proof</p>
      <h1>Wall</h1>
      <p className="lead">
        Verify your friends’ workouts. Unquestioned proof verifies after 24
        hours; only verified workouts count.
      </p>
      <Result notice={notice} />
      {state === "loading" ? (
        <p role="status">Loading the Wall…</p>
      ) : state === "error" ? (
        <div className="history-load-error">
          <p role="alert">Couldn’t load the Wall.</p>
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="wall-empty">
          No proof yet. Log a workout with photos to start the Wall.
        </p>
      ) : (
        <>
          {toReview.length > 0 && (
            <section aria-labelledby="wall-review-heading">
              <h2 id="wall-review-heading">Needs your review</h2>
              <ul className="proof-list">{toReview.map(card)}</ul>
            </section>
          )}
          {rest.length > 0 && (
            <section aria-labelledby="wall-feed-heading">
              <h2 id="wall-feed-heading">This week and recent</h2>
              <ul className="proof-list">{rest.map(card)}</ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
