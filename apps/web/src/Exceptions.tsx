import { useState } from "react";
import { ApiError } from "./api-client";
import {
  type ExceptionBallot,
  type ExceptionCategory,
  extrasCommand,
  type HomeExtras,
} from "./extras";
import { Sheet } from "./Sheet";

export const categories: Array<[ExceptionCategory, string]> = [
  ["health_safety", "Health or safety"],
  ["family_caregiving", "Family or caregiving"],
  ["schedule_disruption", "Work, school, or schedule"],
  ["travel_access", "Travel or no access"],
  ["planned_recovery", "Planned recovery or break"],
  ["private", "Private / prefer not to say"],
];
const categoryLabel = (value: ExceptionCategory | null) =>
  categories.find(([key]) => key === value)?.[1] ?? "Private";
const hoursLeft = (until: string) => {
  const hours = Math.max(
    0,
    Math.ceil((Date.parse(until) - Date.now()) / 3_600_000),
  );
  return hours <= 1 ? "under 1 hour left" : `${hours}h left`;
};
const weekLabel = (week: "current" | "next") =>
  week === "current" ? "this week" : "next week";

type Notice = { kind: "success" | "error"; text: string };

// Exception requests: the member's own status and form, and sealed ballots for the crew.
export function Exceptions({
  apiBaseUrl,
  token,
  extras,
  apply,
  reload,
  onNotice,
  onRevoked,
  part,
}: {
  // "own": the member's status and request sheet; "ballots": requests to vote on.
  part: "own" | "own-status" | "ballots";
  apiBaseUrl: string;
  token: string;
  extras: HomeExtras;
  apply: (next: HomeExtras | ((current: HomeExtras) => HomeExtras)) => void;
  reload: () => void;
  onNotice: (notice: Notice) => void;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState<"current" | "next">("current");
  const [category, setCategory] = useState<ExceptionCategory | null>(null);
  const [note, setNote] = useState("");
  const { mine, toDecide } = extras.exceptions;
  const taken = new Set(
    mine.filter((item) => item.status !== "denied").map((item) => item.week),
  );
  const failed = (previous: HomeExtras) => (error: unknown) => {
    apply(previous);
    if (error instanceof ApiError && error.kind === "unauthorized") onRevoked();
    onNotice({
      kind: "error",
      text:
        error instanceof ApiError ? error.message : "Couldn’t save. Try again.",
    });
    reload();
  };
  const send = (path: string, body: unknown, previous: HomeExtras) =>
    extrasCommand(apiBaseUrl, token, path, body)
      .then(apply)
      .catch(failed(previous));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!category) return;
    const id = crypto.randomUUID();
    const previous = extras;
    // Optimistic: the request shows as pending at once.
    apply({
      ...extras,
      exceptions: {
        ...extras.exceptions,
        mine: [
          ...mine.filter((item) => item.week !== week),
          {
            id,
            week,
            category,
            note: note.trim() || null,
            status: "pending",
            closesAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
          },
        ],
      },
    });
    setOpen(false);
    setCategory(null);
    setNote("");
    onNotice({
      kind: "success",
      text: `Asked your crew to excuse ${weekLabel(week)}. They have 48 hours.`,
    });
    void send(
      "/v1/exceptions/request",
      { id, week, category, note: note.trim() || null },
      previous,
    );
  };

  const vote = (
    ballot: ExceptionBallot,
    response: "approve" | "deny" | "abstain",
  ) => {
    const previous = extras;
    apply({
      ...extras,
      exceptions: {
        ...extras.exceptions,
        toDecide: toDecide.map((item) =>
          item.id === ballot.id ? { ...item, myResponse: response } : item,
        ),
      },
    });
    onNotice({
      kind: "success",
      text:
        response === "abstain"
          ? "You abstained. No more reminders."
          : "Vote saved. You can change it until the decision closes.",
    });
    void send(`/v1/exceptions/${ballot.id}/respond`, { response }, previous);
  };

  const withdraw = (id: string) => {
    const previous = extras;
    apply({
      ...extras,
      exceptions: {
        ...extras.exceptions,
        mine: mine.filter((item) => item.id !== id),
      },
    });
    onNotice({ kind: "success", text: "Request withdrawn." });
    void send(`/v1/exceptions/${id}/withdraw`, {}, previous);
  };

  if (part === "ballots")
    return toDecide.length > 0 ? (
      <section
        className="exception-ballots"
        aria-labelledby="exception-heading"
      >
        <h2 id="exception-heading" className="feed-day">
          Week-off requests
          <span className="feed-badge">
            {toDecide.filter((item) => !item.myResponse).length || "✓"}
          </span>
        </h2>
        <ul>
          {toDecide.map((ballot) => (
            <li key={ballot.id} className="exception-ballot">
              <strong>
                {ballot.name} · {weekLabel(ballot.week)}
              </strong>
              <span>{categoryLabel(ballot.category)}</span>
              {ballot.note && <q>{ballot.note}</q>}
              <small>
                Sealed vote · {hoursLeft(ballot.closesAt)}
                {ballot.myResponse ? ` · you chose ${ballot.myResponse}` : ""}
              </small>
              <fieldset
                className="exception-choices"
                aria-label={`Your vote on ${ballot.name}’s request`}
              >
                {(
                  [
                    ["approve", "Approve"],
                    ["deny", "Deny"],
                    ["abstain", "Abstain"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={ballot.myResponse === value}
                    onClick={() => vote(ballot, value)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  if (part === "own-status")
    return mine.map((item) => (
      <p
        key={item.id}
        className={`exception-status exception-${item.status}`}
        role="status"
      >
        <span>
          {item.status === "approved"
            ? `Excused ${weekLabel(item.week)}. Streaks hold.`
            : item.status === "denied"
              ? `Exception for ${weekLabel(item.week)} denied. Target stands.`
              : `Exception for ${weekLabel(item.week)} pending · ${hoursLeft(item.closesAt)}`}
        </span>
        {item.status === "pending" && (
          <button
            type="button"
            className="text-button"
            onClick={() => withdraw(item.id)}
          >
            Withdraw
          </button>
        )}
      </p>
    ));
  return (
    <>
      {taken.size < 2 && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setWeek(taken.has("current") ? "next" : "current");
            setOpen(true);
          }}
        >
          Week off
        </button>
      )}
      <Sheet
        open={open}
        title="Ask for a week off"
        onDismiss={() => setOpen(false)}
      >
        <form className="exception-form" onSubmit={submit}>
          <p className="hint">
            Your crew votes privately for 48 hours. If approved, there’s no
            miss, no card, and your streaks hold. No proof or details needed.
          </p>
          <fieldset className="choice-chips" aria-label="Which week">
            {(["current", "next"] as const).map((value) => (
              <button
                type="button"
                key={value}
                disabled={taken.has(value)}
                aria-pressed={week === value}
                onClick={() => setWeek(value)}
              >
                {value === "current" ? "This week" : "Next week"}
              </button>
            ))}
          </fieldset>
          <fieldset className="exception-categories">
            <legend>Why, broadly?</legend>
            {categories.map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <label>
            Note for your crew (optional)
            <textarea
              value={note}
              maxLength={280}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="hint">{280 - note.length} characters left</span>
          </label>
          <button type="submit" disabled={!category || taken.has(week)}>
            Send request
          </button>
        </form>
      </Sheet>
    </>
  );
}
