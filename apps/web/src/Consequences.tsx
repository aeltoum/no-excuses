import { useCallback, useEffect, useState } from "react";
import { AugmentPicker } from "./AugmentPicker";
import { ApiError } from "./api-client";
import { useConfirm } from "./Confirm";
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
  } | null;
  reviews: {
    claimId: string;
    memberName: string;
    title: string;
    instructions: string;
    myResponse: string | null;
  }[];
  groupOwed: Record<string, number>;
};
type Action = "redraw" | "select" | "claim" | "pause" | "resume" | "respond";

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
  return data as ConsequenceHome;
}

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

// Owed Consequence cards on Home: pick, complete, and approve friends' claims.
export function Consequences({
  apiBaseUrl,
  token,
  onRevoked,
  onGroupOwed,
  onAttention,
}: {
  apiBaseUrl: string;
  token: string;
  onRevoked: () => void;
  onGroupOwed: (owed: Record<string, number>) => void;
  onAttention: (count: number) => void;
}) {
  const [home, setHome] = useState<ConsequenceHome | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
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
  }, [apiBaseUrl, token, onRevoked, onGroupOwed]);

  useEffect(() => {
    if (!home) return;
    onAttention(
      (home.offer ? 1 : 0) +
        home.reviews.filter((review) => review.myResponse === null).length,
    );
  }, [home, onAttention]);

  const act = async (
    action: Action,
    target: string,
    choice: string,
    done: string,
  ) => {
    setBusy(true);
    try {
      const next = await request(
        apiBaseUrl,
        token,
        `/v1/consequences/${action}`,
        { target, choice },
      );
      setHome(next);
      onGroupOwed(next.groupOwed);
      setNotice({ kind: "success", text: done });
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!home || (home.owed === 0 && home.reviews.length === 0)) return null;
  const { offer, attempt } = home;

  return (
    <section className="consequences" aria-label="Consequence cards">
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
              <div className="proof-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await ask({
                        title: "Mark it done?",
                        body: `Confirm you completed ${attempt.title}. Two friends must approve it.`,
                        confirm: "I did it",
                      })
                    )
                      void act(
                        "claim",
                        attempt.attemptId,
                        "",
                        "Marked done. Waiting for friends to approve.",
                      );
                  }}
                >
                  I did it
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await ask({
                        title: "Pause this card?",
                        body: "Pause it because you can’t do it safely right now. No reason needed. The deadline stops until you’re ready.",
                        confirm: "Pause card",
                      })
                    )
                      void act(
                        "pause",
                        attempt.attemptId,
                        "",
                        "Paused. Take care of yourself.",
                      );
                  }}
                >
                  Can’t do it safely
                </button>
              </div>
            </>
          )}
          {attempt?.status === "safety_paused" && (
            <>
              <h2>{attempt.title}</h2>
              <p className="owed-deadline">
                Paused for safety. When you’re ready you’ll get a fresh pick.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    "resume",
                    attempt.attemptId,
                    "",
                    "Ready. Pick a fresh card.",
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
                    disabled={busy || review.myResponse !== null}
                    onClick={() =>
                      void act(
                        "respond",
                        review.claimId,
                        choice,
                        "Response saved.",
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
      {offer && picking && (
        <AugmentPicker
          cards={offer.cards}
          canReroll={offer.canRedraw}
          busy={busy}
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
