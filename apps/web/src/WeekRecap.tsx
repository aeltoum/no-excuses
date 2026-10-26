import { useState } from "react";
import { ApiError } from "./api-client";
import { Barbell } from "./Barbell";
import { extrasCommand, type HomeExtras, type RecapWeek } from "./extras";
import { markViewed } from "./Notifications";
import { EmojiPicker, quickPicks } from "./Reactions";
import { Sheet } from "./Sheet";

const day = 24 * 3_600_000;
// Enough rows to see your result and the crew's; the rest open on request.
const shownRows = 4;
// Each finished week pops up once on this device; History keeps it after.
const shownKey = "no-excuses:recap-shown";
const alreadyShown = (endsAt: string) => {
  try {
    return localStorage.getItem(shownKey) === endsAt;
  } catch {
    return false;
  }
};
const rememberShown = (endsAt: string) => {
  try {
    localStorage.setItem(shownKey, endsAt);
  } catch {
    // Private mode: it may show again next launch.
  }
};
const resultKinds = new Set(["result", "missed-response"]);

// The day after a week ends: a one-time pop-up with everyone's result, each with one
// emoji reaction per member.
export function WeekRecap({
  apiBaseUrl,
  token,
  extras,
  apply,
  reload,
  onError,
  onRevoked,
  onHistory,
}: {
  apiBaseUrl: string;
  token: string;
  extras: HomeExtras;
  apply: (next: HomeExtras) => void;
  reload: () => void;
  onError: (text: string) => void;
  onRevoked: () => void;
  onHistory: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [picking, setPicking] = useState<RecapWeek | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [closed, setClosed] = useState(false);
  // A saved copy can outlive the day; the server drops it on the next load.
  const weeks = extras.recap.filter(
    (week) => Date.parse(week.endsAt) + day > Date.now(),
  );
  if (weeks.length === 0 || closed || alreadyShown(weeks[0].endsAt))
    return null;
  const close = () => {
    rememberShown(weeks[0].endsAt);
    // Seeing the results clears the result notifications.
    markViewed((item) => resultKinds.has(item.kind));
    setClosed(true);
  };

  // Optimistic: the chip and its count change at once; a failure restores them.
  const react = (week: RecapWeek, emoji: string | null) => {
    const previous = extras;
    const counts = new Map(
      week.reactions.map((entry) => [entry.emoji, entry.count]),
    );
    if (week.myReaction)
      counts.set(week.myReaction, (counts.get(week.myReaction) ?? 1) - 1);
    if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
    apply({
      ...extras,
      recap: extras.recap.map((item) =>
        item.memberWeekId === week.memberWeekId
          ? {
              ...item,
              myReaction: emoji,
              reactions: [...counts]
                .filter(([, count]) => count > 0)
                .map(([key, count]) => ({ emoji: key, count })),
            }
          : item,
      ),
    });
    extrasCommand(apiBaseUrl, token, `/v1/recap/${week.memberWeekId}/react`, {
      emoji,
    })
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
  const pick = (emoji: string) => {
    if (picking) react(picking, picking.myReaction === emoji ? null : emoji);
    setPicking(null);
  };

  const mine = weeks.find((week) => week.mine);
  return (
    <Sheet
      open
      title={
        picking
          ? picking.mine
            ? "React to your week"
            : `React to ${picking.name}`
          : "The results are in"
      }
      onDismiss={() => (picking ? setPicking(null) : close())}
    >
      {picking ? (
        <>
          <p className="sheet-hint">
            One reaction each. Picking another swaps it.
          </p>
          <fieldset className="reaction-quick" aria-label="Gym favorites">
            {quickPicks.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React ${emoji}`}
                aria-pressed={picking?.myReaction === emoji}
                onClick={() => pick(emoji)}
              >
                {emoji}
              </button>
            ))}
          </fieldset>
          {picking && <EmojiPicker onPick={pick} />}
        </>
      ) : (
        <div className="week-recap">
          {mine && (
            <p
              className={`recap-verdict ${mine.met ? "recap-met" : "recap-missed"}`}
            >
              <strong>{mine.met ? "Week met" : "Week missed"}</strong>
              <span>
                {mine.completed} of {mine.target} workouts
              </span>
            </p>
          )}
          <ul>
            {(showAll ? weeks : weeks.slice(0, shownRows)).map((week) => {
              const who = week.mine ? "You" : week.name;
              return (
                <li
                  key={week.memberWeekId}
                  className={`recap-row ${week.met ? "recap-met" : "recap-missed"}`}
                >
                  <strong className="recap-name">{who}</strong>
                  <Barbell
                    count={week.completed}
                    target={week.target}
                    size="mini"
                    activityTypes={week.activityTypes}
                  />
                  <span className="recap-outcome">
                    {week.met ? "Met" : "Missed"} {week.completed}/{week.target}
                  </span>
                  <fieldset
                    className="recap-reactions"
                    aria-label={`React to ${week.mine ? "your" : `${week.name}’s`} week`}
                  >
                    {week.reactions.map(({ emoji, count }) => (
                      <button
                        type="button"
                        key={emoji}
                        className="proof-reaction"
                        aria-pressed={week.myReaction === emoji}
                        aria-label={`${emoji}, ${count}`}
                        onClick={() =>
                          react(week, week.myReaction === emoji ? null : emoji)
                        }
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span
                          className="proof-reaction-count"
                          aria-hidden="true"
                        >
                          {count}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="proof-reaction proof-reaction-add"
                      aria-haspopup="dialog"
                      aria-label={`React to ${who === "You" ? "your" : `${who}’s`} week with any emoji`}
                      onClick={() => setPicking(week)}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        width="16"
                        height="16"
                        aria-hidden="true"
                      >
                        <circle
                          cx="9"
                          cy="10"
                          r="6.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        />
                        <circle cx="6.8" cy="8.6" r="1" fill="currentColor" />
                        <circle cx="11.2" cy="8.6" r="1" fill="currentColor" />
                        <path
                          d="M6.2 11.8a3.2 3.2 0 0 0 5.6 0"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16.5 1.5v5M14 4h5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </fieldset>
                </li>
              );
            })}
          </ul>
          {weeks.length > shownRows && (
            <button
              type="button"
              className="text-button recap-more"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "Show fewer" : `Show all ${weeks.length}`}
            </button>
          )}
          <a
            className="recap-history"
            href="/history"
            onClick={(event) => {
              close();
              onHistory(event);
            }}
          >
            See every week in History
          </a>
          <button type="button" className="recap-done" onClick={close}>
            Done
          </button>
        </div>
      )}
    </Sheet>
  );
}
