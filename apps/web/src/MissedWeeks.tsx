import { ApiError } from "./api-client";
import {
  extrasCommand,
  type HomeExtras,
  type MissedResponse,
  type MissedWeek,
} from "./extras";

export const missedResponses: Array<[MissedResponse, string, string]> = [
  ["next_week", "💪", "Next week"],
  ["got_you", "🤝", "Got you"],
  ["bounce_back", "🔁", "Bounce back"],
  ["rest_up", "😴", "Rest up"],
  ["no_excuses", "😤", "No excuses"],
];

// Recent missed weeks: a neutral note with one preset response per member.
export function MissedWeeks({
  apiBaseUrl,
  token,
  extras,
  apply,
  reload,
  onError,
  onRevoked,
}: {
  apiBaseUrl: string;
  token: string;
  extras: HomeExtras;
  apply: (next: HomeExtras) => void;
  reload: () => void;
  onError: (text: string) => void;
  onRevoked: () => void;
}) {
  if (extras.missed.length === 0) return null;
  // Optimistic: the chip and its count change at once; a failure restores them.
  const respond = (week: MissedWeek, response: MissedResponse) => {
    const previous = extras;
    const next = week.myResponse === response ? null : response;
    const counts = new Map(
      week.responses.map((entry) => [entry.response, entry.count]),
    );
    if (week.myResponse)
      counts.set(week.myResponse, (counts.get(week.myResponse) ?? 1) - 1);
    if (next) counts.set(next, (counts.get(next) ?? 0) + 1);
    apply({
      ...extras,
      missed: extras.missed.map((item) =>
        item.memberWeekId === week.memberWeekId
          ? {
              ...item,
              myResponse: next,
              responses: [...counts]
                .filter(([, count]) => count > 0)
                .map(([key, count]) => ({ response: key, count })),
            }
          : item,
      ),
    });
    extrasCommand(
      apiBaseUrl,
      token,
      `/v1/missed/${week.memberWeekId}/respond`,
      { response: next },
    )
      .then(apply)
      .catch((error) => {
        apply(previous);
        if (error instanceof ApiError && error.kind === "unauthorized")
          onRevoked();
        onError(
          error instanceof ApiError
            ? error.message
            : "Couldn’t save. Try again.",
        );
        reload();
      });
  };
  return (
    <section className="missed-weeks" aria-label="Last week">
      {extras.missed.map((week) => (
        <article key={week.memberWeekId} className="missed-week">
          <p>
            <strong>{week.mine ? "You" : week.name}</strong> missed last week ·{" "}
            {week.completed} of {week.target}
          </p>
          <fieldset
            className="missed-responses"
            aria-label={`Respond to ${week.mine ? "your" : `${week.name}’s`} missed week`}
          >
            {missedResponses.map(([key, emoji, label]) => {
              const count =
                week.responses.find((entry) => entry.response === key)?.count ??
                0;
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={week.myResponse === key}
                  aria-label={`${label}${count ? `, ${count}` : ""}`}
                  onClick={() => respond(week, key)}
                >
                  <span aria-hidden="true">{emoji}</span>
                  <span>{label}</span>
                  {count > 0 && <small aria-hidden="true">{count}</small>}
                </button>
              );
            })}
          </fieldset>
        </article>
      ))}
    </section>
  );
}
