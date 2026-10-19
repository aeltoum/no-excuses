import { useCallback, useEffect, useState } from "react";
import { AugmentPicker } from "./AugmentPicker";
import { ApiError } from "./api-client";
import { useConfirm } from "./Confirm";
import { maxClipSeconds, ProofClip } from "./ProofClip";
import { persistentMap } from "./persist";
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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("failure", "Connection failed. Try again.", true);
  }
  if (response.status === 401)
    throw new ApiError("unauthorized", "Access ended. Sign in again.");
  if (response.status === 403)
    throw new ApiError("denied", "That card action is no longer available.");
  if (!response.ok)
    throw new ApiError("failure", "Something went wrong. Try again.", true);
  const data = ((await response.json()) as { data?: unknown }).data;
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

// Loads only on tap, so a list of clips costs nothing until someone plays one.
function ClipPlayer({ url, label }: { url?: string | null; label: string }) {
  if (!url) return null;
  return (
    // biome-ignore lint/a11y/useMediaCaption: member-recorded proof has no captions
    <video
      className="clip-player"
      src={url}
      controls
      playsInline
      preload="none"
      aria-label={label}
    />
  );
}

// Owed Consequence cards on Home: pick, complete, and approve friends' claims.
export function Consequences({
  apiBaseUrl,
  token,
  onRevoked,
  onGroupOwed,
  onAttention,
  onLogBlock,
  cacheKey,
}: {
  apiBaseUrl: string;
  token: string;
  cacheKey: string;
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
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
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
    let active = true;
    request(apiBaseUrl, token, "/v1/consequences")
      .then((next) => {
        if (!active) return;
        homeCache.set(cacheKey, next);
        setHome(next);
        onGroupOwed(next.groupOwed);
        const offerId = next.offer?.offerId;
        if (offerId && readSeen() !== offerId) {
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
  }, [apiBaseUrl, token, cacheKey, onRevoked, onGroupOwed]);

  useEffect(() => {
    if (!home) return;
    onAttention(
      (home.offer ? 1 : 0) +
        home.reviews.filter((review) => review.myResponse === null).length +
        home.pauseReviews.filter((review) => review.myVote === null).length,
    );
    onLogBlock(home.logBlocked ? { title: home.attempt?.title ?? null } : null);
  }, [home, onAttention, onLogBlock]);

  useEffect(() => {
    if (home) onGroupOwed(home.groupOwed);
  }, [home, onGroupOwed]);

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

  return (
    <section
      id="consequence-cards"
      className="consequences"
      aria-label="Consequence cards"
      tabIndex={-1}
    >
      {!(offer && picking) && <Result notice={notice} />}
      {confirmSheet}
      {home.owed > 0 && (
        <div className="owed-card">
          <p className="owed-count">
            You owe {home.owed} Consequence {home.owed === 1 ? "card" : "cards"}
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
                from your camera roll aren’t accepted. Record a quick clip (up
                to {maxClipSeconds}s) showing the code, then doing the card.
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
                  {attempt.pauseRequest.approvalsNeeded} approvals. The deadline
                  keeps running until it’s approved.
                </p>
              )}
            </>
          )}
          {attempt?.status === "safety_paused" && (
            <>
              <h2>{attempt.title}</h2>
              <p className="owed-deadline">
                Paused with your Group’s approval. When you’re ready you’ll get
                a fresh pick.
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
          {attempt?.status === "review" && (
            <>
              <h2>{attempt.title}</h2>
              <p className="owed-deadline">
                Waiting for friends: {attempt.approvals} of{" "}
                {attempt.approvalsNeeded} approvals.
              </p>
              <ClipPlayer url={attempt.clipUrl} label="Your proof clip" />
            </>
          )}
        </div>
      )}
      {home.reviews.length > 0 && (
        <ul className="card-reviews" aria-label="Consequence cards to approve">
          {home.reviews.map((review) => (
            <li key={review.claimId}>
              <p>
                <strong>{review.memberName}</strong> finished{" "}
                <strong>{review.title}</strong>
              </p>
              <p className="owed-deadline">{review.instructions}</p>
              <ClipPlayer
                url={review.clipUrl}
                label={`${review.memberName}’s proof clip`}
              />
              <div className="proof-actions">
                {(
                  [
                    ["approve", "Approve"],
                    ["reject", "Reject"],
                    ["cannot_assess", "Can’t assess"],
                  ] as const
                ).map(([choice, text]) => (
                  <button
                    type="button"
                    key={choice}
                    aria-pressed={review.myResponse === choice}
                    className={
                      choice === "approve" ? undefined : "secondary-button"
                    }
                    disabled={review.myResponse !== null}
                    onClick={() =>
                      void act(
                        "respond",
                        review.claimId,
                        choice,
                        "Response saved.",
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
              </div>
            </li>
          ))}
        </ul>
      )}
      {home.pauseReviews.length > 0 && (
        <ul className="card-reviews" aria-label="Pause requests to approve">
          {home.pauseReviews.map((review) => (
            <li key={review.pauseRequestId}>
              <p>
                <strong>{review.memberName}</strong> asked to pause{" "}
                <strong>{review.title}</strong>
              </p>
              <div className="proof-actions">
                {(
                  [
                    ["approve", "Approve pause"],
                    ["reject", "Deny"],
                  ] as const
                ).map(([choice, text]) => (
                  <button
                    type="button"
                    key={choice}
                    aria-pressed={review.myVote === choice}
                    className={
                      choice === "approve" ? undefined : "secondary-button"
                    }
                    disabled={review.myVote !== null}
                    onClick={() =>
                      void act(
                        "vote_pause",
                        review.pauseRequestId,
                        choice,
                        "Vote saved.",
                        {
                          apply: (current) => ({
                            ...current,
                            pauseReviews: current.pauseReviews.map((entry) =>
                              entry.pauseRequestId === review.pauseRequestId
                                ? { ...entry, myVote: choice }
                                : entry,
                            ),
                          }),
                          undo: (current) => ({
                            ...current,
                            pauseReviews: current.pauseReviews.map((entry) =>
                              entry.pauseRequestId === review.pauseRequestId
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
              </div>
            </li>
          ))}
        </ul>
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
