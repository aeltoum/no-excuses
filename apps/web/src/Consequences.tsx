import { useCallback, useEffect, useState } from "react";
import { AugmentPicker } from "./AugmentPicker";
import { ApiError, overlappedWrite, writeMark } from "./api-client";
import { useConfirm } from "./Confirm";
import { useFreshness } from "./freshness";
import { maxClipSeconds, ProofClip } from "./ProofClip";
import { persistentMap } from "./persist";
import { call } from "./proof";
import { Result, useNotice } from "./Result";

type Card = {
  cardId: string;
  title: string;
  instructions: string;
  unlockedByFriend: boolean;
};
export type ConsequenceHome = {
  owed: number;
  offer: { offerId: string; canRedraw: boolean; cards: Card[] } | null;
  attempt: {
    attemptId: string;
    status: "active" | "safety_paused" | "review";
    title: string;
    instructions: string;
    expiresAt: string;
    approvals: number;
    approvalsNeeded: number;
    clipUrl?: string | null;
    pauseRequest: {
      approvals: number;
      rejections: number;
      approvalsNeeded: number;
    } | null;
  } | null;
  reviews: {
    claimId: string;
    memberName: string;
    title: string;
    instructions: string;
    clipUrl?: string | null;
    myResponse: string | null;
  }[];
  pauseReviews: {
    pauseRequestId: string;
    memberName: string;
    title: string;
    myVote: "approve" | "reject" | null;
  }[];
  logBlocked: boolean;
  groupOwed: Record<string, number>;
  // Your own cards with proof sent, still waiting on friends.
  inReview?: {
    attemptId: string;
    title: string;
    claimReviewEndsAt: string;
    approvals: number;
    approvalsNeeded: number;
  }[];
};
type Action =
  | "redraw"
  | "select"
  | "claim"
  | "request_pause"
  | "vote_pause"
  | "resume"
  | "respond";
// What blocks workout logging: the owed card's title, or null once proof is in.
export type LogBlock = { title: string | null } | null;

async function request(
  baseUrl: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<ConsequenceHome> {
  let data: unknown;
  try {
    data = await call<unknown>(baseUrl, token, path, {
      method: body === undefined ? "GET" : "POST",
      body,
    });
  } catch (error) {
    if (error instanceof ApiError && error.kind === "denied")
      throw new ApiError("denied", "That card action is no longer available.");
    throw error;
  }
  if (!data || typeof data !== "object" || !("owed" in data))
    throw new ApiError("failure", "Couldn’t load your cards.", true);
  // Older API builds omit the pause and log-gate fields.
  const home = data as ConsequenceHome;
  return {
    ...home,
    pauseReviews: home.pauseReviews ?? [],
    logBlocked: home.logBlocked ?? false,
  };
}

// Last known cards per member and Group, shown at once on reopen.
const homeCache = persistentMap<ConsequenceHome>("consequences");

// The picker pops up on its own once per hand; afterwards it opens from Home.
const seenKey = "no-excuses:seen-card-offer";
const readSeen = () => {
  try {
    return window.localStorage.getItem(seenKey);
  } catch {
    return null;
  }
};
const writeSeen = (offerId: string) => {
  try {
    window.localStorage.setItem(seenKey, offerId);
  } catch {}
};

const hoursLeft = (until: string) => {
  const hours = Math.max(
    0,
    Math.ceil((new Date(until).getTime() - Date.now()) / 3_600_000),
  );
  return hours <= 1 ? "under 1 hour" : `${hours} hours`;
};

const debtCap = 5;
// Owed cards stack toward the backlog cap of five; the meter heats up as it fills.
function DebtMeter({ owed }: { owed: number }) {
  const level = owed >= debtCap ? "maxed" : owed >= 3 ? "high" : "low";
  return (
    <div
      className={`debt-meter debt-${level}`}
      role="img"
      aria-label={`Consequence debt: ${owed} of ${debtCap} cards owed`}
    >
      <span className="debt-label">Debt</span>
      <span className="debt-cells" aria-hidden="true">
        {Array.from({ length: debtCap }, (_, index) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed five-cell meter
            key={index}
            className={index < owed ? "filled" : undefined}
          />
        ))}
      </span>
      <span className="debt-value">
        {owed >= debtCap ? "Maxed" : `${owed}/${debtCap}`}
      </span>
    </div>
  );
}

const verdictMark: Record<string, string> = {
  approve: "✓",
  reject: "✕",
  cannot_assess: "?",
};
const verdictText: Record<string, string> = {
  approve: "You approved",
  reject: "You rejected",
  cannot_assess: "You couldn’t tell on",
};

// Loads metadata and the first frame only, so each clip shows a thumbnail
// instead of a black box; the full clip streams on play.
function ClipPlayer({ url, label }: { url?: string | null; label: string }) {
  if (!url) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: member-recorded proof has no captions
    <video
      className="clip-player"
      // The media fragment seeks past a blank first frame for the poster.
      src={url.includes("#") ? url : `${url}#t=0.1`}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
    />
  );
}

// Owed Consequence cards on Home: pick, complete, and approve friends' claims.
// What a card hand asks of this member right now.
const cardAttention = (home: ConsequenceHome) =>
  (home.offer ? 1 : 0) +
  home.reviews.filter((review) => review.myResponse === null).length +
  home.pauseReviews.filter((review) => review.myVote === null).length;

// Card attention and the log gate without the cards, for pages that only
// need to know what waits (Home's badge and Log button).
export function useCardSummary(
  apiBaseUrl: string,
  token: string,
  cacheKey: string,
  enabled: boolean,
  onRevoked: () => void,
): {
  attention: number;
  blocked: boolean;
  title: string | null;
  // Whether the Consequence card block has anything to show.
  shown: boolean;
} {
  const [home, setHome] = useState<ConsequenceHome | null>(
    () => homeCache.get(cacheKey) ?? null,
  );
  const fresh = useFreshness();
  useEffect(() => {
    void fresh;
    if (!enabled) return;
    let active = true;
    request(apiBaseUrl, token, "/v1/consequences")
      .then((next) => {
        if (!active) return;
        homeCache.set(cacheKey, next);
        setHome(next);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, cacheKey, enabled, onRevoked, fresh]);
  return home && enabled
    ? {
        attention: cardAttention(home),
        blocked: home.logBlocked,
        title: home.attempt?.title ?? null,
        shown:
          home.owed > 0 ||
          home.reviews.length > 0 ||
          home.pauseReviews.length > 0,
      }
    : { attention: 0, blocked: false, title: null, shown: false };
}

export function Consequences({
  apiBaseUrl,
  token,
  onRevoked,
  onGroupOwed,
  onAttention,
  onLogBlock,
  cacheKey,
  autoPick = true,
}: {
  apiBaseUrl: string;
  token: string;
  cacheKey: string;
  // Open the card picker by itself when a new offer arrives (Week does; Home waits for a tap).
  autoPick?: boolean;
  onRevoked: () => void;
  onGroupOwed: (owed: Record<string, number>) => void;
  onAttention: (count: number) => void;
  onLogBlock: (block: LogBlock) => void;
}) {
  const [home, setHome] = useState<ConsequenceHome | null>(
    () => homeCache.get(cacheKey) ?? null,
  );
  // Controls waiting on the server, by action and target.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const busy = (key: string) => pending.has(key);
  const fresh = useFreshness();
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
  // Slim by default; friends' cards waiting on a vote open it until toggled.
  const [toggled, setExpanded] = useState<boolean | null>(null);
  const [notice, setNotice] = useNotice();
  const [confirmSheet, ask] = useConfirm();

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.kind === "unauthorized")
        onRevoked();
      setNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Action failed. Try again.",
      });
    },
    [onRevoked, setNotice],
  );

  useEffect(() => {
    void fresh;
    let active = true;
    const mark = writeMark();
    const previous = homeCache.has(cacheKey);
    request(apiBaseUrl, token, "/v1/consequences")
      .then((next) => {
        // A reload that overlapped an action must not undo it on screen.
        if (!active || (previous && overlappedWrite(mark))) return;
        homeCache.set(cacheKey, next);
        setHome(next);
        onGroupOwed(next.groupOwed);
        const offerId = next.offer?.offerId;
        if (autoPick && offerId && readSeen() !== offerId) {
          writeSeen(offerId);
          setPicking(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, cacheKey, onRevoked, onGroupOwed, fresh, autoPick]);

  useEffect(() => {
    if (!home) return;
    onAttention(cardAttention(home));
    onLogBlock(home.logBlocked ? { title: home.attempt?.title ?? null } : null);
  }, [home, onAttention, onLogBlock]);

  useEffect(() => {
    if (home) onGroupOwed(home.groupOwed);
  }, [home, onGroupOwed]);

  // Once friends' cards open the strip, it stays open until the member closes it.
  useEffect(() => {
    if (
      home?.reviews.some((review) => review.myResponse === null) ||
      home?.pauseReviews.some((review) => review.myVote === null)
    )
      setExpanded((current) => current ?? true);
  }, [home]);

  // With `change`, the outcome shows at once and a failure undoes only that
  // change; without it, only this control waits for the server.
  const act = async (
    action: Action,
    target: string,
    choice: string,
    done: string,
    change?: {
      apply: (current: ConsequenceHome) => ConsequenceHome;
      undo: (current: ConsequenceHome) => ConsequenceHome;
    },
  ) => {
    const key = `${action}:${target}`;
    if (pending.has(key)) return false;
    setPending((current) => new Set(current).add(key));
    if (change) {
      setHome((current) => current && change.apply(current));
      setNotice({ kind: "success", text: done });
    }
    try {
      const next = await request(
        apiBaseUrl,
        token,
        `/v1/consequences/${action}`,
        { target, choice },
      );
      homeCache.set(cacheKey, next);
      setHome(next);
      if (!change) setNotice({ kind: "success", text: done });
      // Sending proof deals the next owed card; show it straight away.
      const offerId = next.offer?.offerId;
      if (action === "claim" && offerId && readSeen() !== offerId) {
        writeSeen(offerId);
        setPicking(true);
      }
      return true;
    } catch (error) {
      if (change) setHome((current) => current && change.undo(current));
      fail(error);
      return false;
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  if (
    !home ||
    (home.owed === 0 &&
      home.reviews.length === 0 &&
      home.pauseReviews.length === 0)
  )
    return null;
  const { offer, attempt } = home;
  const waiting =
    home.reviews.filter((review) => review.myResponse === null).length +
    home.pauseReviews.filter((review) => review.myVote === null).length;
  const expanded = toggled ?? waiting > 0;

  return (
    <section
      id="consequence-cards"
      className="consequences"
      aria-label="Consequence cards"
      tabIndex={-1}
      // The log lock sends focus here to show the card.
      onFocus={(event) => {
        if (event.target === event.currentTarget) setExpanded(true);
      }}
    >
      {!(offer && picking) && <Result notice={notice} />}
      {confirmSheet}
      <button
        type="button"
        className={`consequence-strip${home.owed > 0 ? " is-owed" : ""}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="consequence-strip-mark" aria-hidden="true">
          {home.owed > 0 ? home.owed : "✓"}
        </span>
        <span className="consequence-strip-text">
          <strong>
            {home.owed > 0
              ? attempt?.status === "active"
                ? attempt.title
                : `You owe ${home.owed} Consequence ${home.owed === 1 ? "card" : "cards"}`
              : "Consequence cards"}
          </strong>
          <small>
            {attempt?.status === "active"
              ? `Due in ${hoursLeft(attempt.expiresAt)}`
              : attempt?.status === "review"
                ? offer
                  ? "In review. Your next card is ready"
                  : "Proof in review"
                : offer
                  ? "Tap to pick a card"
                  : waiting > 0
                    ? `${waiting} waiting on you`
                    : "Friends’ cards in review"}
          </small>
        </span>
        <span className="consequence-strip-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="consequence-body">
          {home.owed > 0 && (
            <div className="owed-card">
              <p className="owed-count">
                You owe {home.owed} Consequence{" "}
                {home.owed === 1 ? "card" : "cards"}
              </p>
              <DebtMeter owed={home.owed} />
              {offer && (
                <button type="button" onClick={() => setPicking(true)}>
                  Choose your card
                </button>
              )}
              {attempt?.status === "active" && (
                <>
                  <h2>{attempt.title}</h2>
                  <p>{attempt.instructions}</p>
                  <p className="owed-deadline">
                    Due in {hoursLeft(attempt.expiresAt)}. Miss it and you owe
                    another.
                  </p>
                  <p className="clip-heads-up">
                    Proof must be a video recorded in the app right now. Uploads
                    from your camera roll aren’t accepted. Record a quick clip
                    (up to {maxClipSeconds}s) showing the code, then doing the
                    card.
                  </p>
                  <div className="proof-actions">
                    <button
                      type="button"
                      onClick={() => {
                        // Earlier toasts would sit over the recorder.
                        setNotice(null);
                        setRecording(true);
                      }}
                    >
                      Record proof
                    </button>
                    {!attempt.pauseRequest && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy(`request_pause:${attempt.attemptId}`)}
                        onClick={async () => {
                          if (
                            await ask({
                              title: "Request a pause?",
                              body: "Your Group votes on it. Two friends must approve before the card pauses. The deadline keeps running until then.",
                              confirm: "Request pause",
                            })
                          )
                            void act(
                              "request_pause",
                              attempt.attemptId,
                              "",
                              "Pause requested. Waiting for friends to approve.",
                              {
                                apply: (current) => ({
                                  ...current,
                                  attempt: current.attempt && {
                                    ...current.attempt,
                                    pauseRequest: {
                                      approvals: 0,
                                      rejections: 0,
                                      approvalsNeeded: 2,
                                    },
                                  },
                                }),
                                undo: (current) => ({
                                  ...current,
                                  attempt: current.attempt && {
                                    ...current.attempt,
                                    pauseRequest: null,
                                  },
                                }),
                              },
                            );
                        }}
                      >
                        Request a pause
                      </button>
                    )}
                  </div>
                  {attempt.pauseRequest && (
                    <p className="owed-deadline">
                      Pause requested: {attempt.pauseRequest.approvals} of{" "}
                      {attempt.pauseRequest.approvalsNeeded} approvals. The
                      deadline keeps running until it’s approved.
                    </p>
                  )}
                </>
              )}
              {attempt?.status === "safety_paused" && (
                <>
                  <h2>{attempt.title}</h2>
                  <p className="owed-deadline">
                    Paused with your Group’s approval. When you’re ready you’ll
                    get a fresh pick.
                  </p>
                  <button
                    type="button"
                    disabled={busy(`resume:${attempt.attemptId}`)}
                    onClick={() =>
                      void act(
                        "resume",
                        attempt.attemptId,
                        "",
                        "Ready. Pick a fresh card.",
                        {
                          // The fresh hand comes from the server.
                          apply: (current) => ({ ...current, attempt: null }),
                          undo: (current) =>
                            current.attempt ? current : { ...current, attempt },
                        },
                      )
                    }
                  >
                    I’m ready
                  </button>
                </>
              )}
              {(home.inReview ?? [])
                .filter((card) => card.attemptId !== attempt?.attemptId)
                .map((card) => (
                  <p className="owed-deadline in-review" key={card.attemptId}>
                    <strong>{card.title}</strong> in review: {card.approvals} of{" "}
                    {card.approvalsNeeded} approvals. Counts as done in{" "}
                    {hoursLeft(card.claimReviewEndsAt)} if nobody rejects it.
                  </p>
                ))}
              {attempt?.status === "review" && (
                <>
                  <h2>{attempt.title}</h2>
                  <p className="owed-deadline">
                    Waiting for friends: {attempt.approvals} of{" "}
                    {attempt.approvalsNeeded} approvals. With no rejections it
                    counts as done when the review ends.
                  </p>
                  {offer && (
                    <p className="owed-deadline">
                      Your next card is ready. Start it now; friends keep
                      reviewing this one.
                    </p>
                  )}
                  <ClipPlayer url={attempt.clipUrl} label="Your proof clip" />
                </>
              )}
            </div>
          )}
          {home.reviews.length > 0 && (
            <ul
              className="card-reviews"
              aria-label="Consequence cards to approve"
            >
              {home.reviews.map((review) =>
                review.myResponse ? (
                  // Voted: a one-line receipt replaces the clip and the buttons.
                  <li key={review.claimId} className="verdict-receipt">
                    <span
                      className={`verdict-mark verdict-${review.myResponse}`}
                      aria-hidden="true"
                    >
                      {verdictMark[review.myResponse] ?? "?"}
                    </span>
                    <p role="status">
                      {verdictText[review.myResponse] ?? "You voted on"}{" "}
                      <strong>{review.memberName}</strong>’s {review.title}.
                    </p>
                  </li>
                ) : (
                  <li key={review.claimId} className="verdict">
                    <p className="verdict-who">
                      <strong>{review.memberName}</strong> says they did their
                      card
                    </p>
                    <h3 className="verdict-title">{review.title}</h3>
                    <p className="verdict-rules">{review.instructions}</p>
                    <ClipPlayer
                      url={review.clipUrl}
                      label={`${review.memberName}’s proof clip`}
                    />
                    <fieldset
                      className="verdict-choices"
                      aria-label={`Your vote on ${review.memberName}’s card`}
                    >
                      {(
                        [
                          ["approve", "Approve"],
                          ["reject", "Reject"],
                          ["cannot_assess", "Can’t tell"],
                        ] as const
                      ).map(([choice, text]) => (
                        <button
                          type="button"
                          key={choice}
                          className={`verdict-${choice}`}
                          onClick={() =>
                            void act(
                              "respond",
                              review.claimId,
                              choice,
                              "Vote saved.",
                              {
                                apply: (current) => ({
                                  ...current,
                                  reviews: current.reviews.map((entry) =>
                                    entry.claimId === review.claimId
                                      ? { ...entry, myResponse: choice }
                                      : entry,
                                  ),
                                }),
                                undo: (current) => ({
                                  ...current,
                                  reviews: current.reviews.map((entry) =>
                                    entry.claimId === review.claimId
                                      ? { ...entry, myResponse: null }
                                      : entry,
                                  ),
                                }),
                              },
                            )
                          }
                        >
                          {text}
                        </button>
                      ))}
                    </fieldset>
                  </li>
                ),
              )}
            </ul>
          )}
          {home.pauseReviews.length > 0 && (
            <ul className="card-reviews" aria-label="Pause requests to approve">
              {home.pauseReviews.map((review) =>
                review.myVote ? (
                  <li key={review.pauseRequestId} className="verdict-receipt">
                    <span
                      className={`verdict-mark verdict-${review.myVote}`}
                      aria-hidden="true"
                    >
                      {verdictMark[review.myVote]}
                    </span>
                    <p role="status">
                      You {review.myVote === "approve" ? "approved" : "denied"}{" "}
                      <strong>{review.memberName}</strong>’s pause.
                    </p>
                  </li>
                ) : (
                  <li key={review.pauseRequestId} className="verdict">
                    <p className="verdict-who">
                      <strong>{review.memberName}</strong> asked to pause
                    </p>
                    <h3 className="verdict-title">{review.title}</h3>
                    <fieldset
                      className="verdict-choices"
                      aria-label={`Your vote on ${review.memberName}’s pause`}
                    >
                      {(
                        [
                          ["approve", "Approve pause"],
                          ["reject", "Deny"],
                        ] as const
                      ).map(([choice, text]) => (
                        <button
                          type="button"
                          key={choice}
                          className={`verdict-${choice}`}
                          onClick={() =>
                            void act(
                              "vote_pause",
                              review.pauseRequestId,
                              choice,
                              "Vote saved.",
                              {
                                apply: (current) => ({
                                  ...current,
                                  pauseReviews: current.pauseReviews.map(
                                    (entry) =>
                                      entry.pauseRequestId ===
                                      review.pauseRequestId
                                        ? { ...entry, myVote: choice }
                                        : entry,
                                  ),
                                }),
                                undo: (current) => ({
                                  ...current,
                                  pauseReviews: current.pauseReviews.map(
                                    (entry) =>
                                      entry.pauseRequestId ===
                                      review.pauseRequestId
                                        ? { ...entry, myVote: null }
                                        : entry,
                                  ),
                                }),
                              },
                            )
                          }
                        >
                          {text}
                        </button>
                      ))}
                    </fieldset>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
      {recording && attempt?.status === "active" && (
        <ProofClip
          apiBaseUrl={apiBaseUrl}
          token={token}
          attemptId={attempt.attemptId}
          title={attempt.title}
          notice={<Result notice={notice} />}
          onError={fail}
          onClose={() => setRecording(false)}
          onSubmit={(clipPath) =>
            act(
              "claim",
              attempt.attemptId,
              clipPath,
              "Proof sent. Waiting for friends to approve.",
            )
          }
        />
      )}
      {offer && picking && (
        <AugmentPicker
          cards={offer.cards}
          canReroll={offer.canRedraw}
          busy={
            busy(`redraw:${offer.offerId}`) || busy(`select:${offer.offerId}`)
          }
          owed={home.owed}
          onClose={() => setPicking(false)}
          notice={<Result notice={notice} />}
          onReroll={() =>
            void act(
              "redraw",
              offer.offerId,
              "",
              "Rerolled. These three are final.",
            )
          }
          onLock={(cardId) =>
            void act(
              "select",
              offer.offerId,
              cardId,
              "Card locked in. 48 hours starts now.",
            ).then((saved) => {
              if (saved) setPicking(false);
            })
          }
        />
      )}
    </section>
  );
}
