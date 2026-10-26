import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import {
  type ProofItem,
  type ProofMessage,
  postMessage,
  reportMessage,
  setCaption,
} from "./proof";

type Notice = { kind: "success" | "error"; text: string };

const captionLimit = 140;

// Caption starters drawn from the workout itself, so a member can tap
// what they hit instead of retyping it.
export const captionStarters = (item: ProofItem): string[] => {
  const starters: string[] = [];
  const lift = item.details?.lifts?.reduce<
    NonNullable<ProofItem["details"]>["lifts"]
  >(
    (best, next) =>
      !best?.[0] || (next.weightKg ?? 0) > (best[0].weightKg ?? 0)
        ? [next]
        : best,
    [],
  )?.[0];
  if (lift) {
    const name = lift.exercise.replace(/_/g, " ");
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    starters.push(
      lift.weightKg
        ? `${label} ${lift.weightKg} kg`
        : `${label} ${lift.sets}×${lift.reps}`,
    );
  }
  const km = item.details?.cardio?.distanceKm;
  if (km) starters.push(`${Number(km.toFixed(1))} km done`);
  starters.push(`${item.durationMinutes} min in`);
  starters.push("New PR");
  starters.push(
    item.perceivedIntensity === "high" ? "That one hurt" : "Showed up anyway",
  );
  return starters;
};

// A post's caption and messages, with the inputs to add them.
export function PostText({
  item,
  authorName,
  askComment = 0,
  apiBaseUrl,
  token,
  ensureConduct,
  confirmReport,
  onNotice,
  onReportPhotos,
}: {
  item: ProofItem;
  authorName: string;
  // Bumped by the comment icon beside the reactions.
  askComment?: number;
  apiBaseUrl: string;
  token: string;
  ensureConduct: () => Promise<boolean>;
  confirmReport: () => Promise<boolean>;
  onNotice: (notice: Notice) => void;
  onReportPhotos?: () => void;
}) {
  const [caption, setLocalCaption] = useState(item.caption ?? null);
  const [messages, setMessages] = useState<ProofMessage[]>(item.messages ?? []);
  const [showAll, setShowAll] = useState(false);
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [writing, setWriting] = useState<"message" | "caption" | null>(null);
  const [draft, setDraft] = useState("");
  const shownCaption = caption ?? item.caption ?? null;
  const known = new Set(messages.map((message) => message.id));
  const all = [
    ...(item.messages ?? []).filter((message) => !known.has(message.id)),
    ...messages,
  ]
    .filter((message) => !reported.has(message.id))
    .sort((left, right) => left.at.localeCompare(right.at));
  const starters = writing === "caption" ? captionStarters(item) : [];
  const left = captionLimit - draft.length;
  const visible = showAll ? all : all.slice(-3);
  const canCaption =
    item.mine &&
    !shownCaption &&
    Date.now() - Date.parse(item.submittedAt) < 3_600_000;
  const fail = (error: unknown) =>
    onNotice({
      kind: "error",
      text:
        error instanceof ApiError ? error.message : "Couldn’t save. Try again.",
    });
  const open = async (mode: "message" | "caption") => {
    if (!(await ensureConduct())) return;
    setDraft("");
    setWriting(mode);
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (askComment > 0) void openRef.current("message");
  }, [askComment]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !writing) return;
    setWriting(null);
    setDraft("");
    // Optimistic: the text shows at once; a failure removes it again.
    if (writing === "caption") {
      setLocalCaption(text);
      setCaption(apiBaseUrl, token, item.workoutCheckinId, text).catch(
        (error) => {
          setLocalCaption(null);
          fail(error);
        },
      );
      return;
    }
    const message: ProofMessage = {
      id: crypto.randomUUID(),
      name: "You",
      mine: true,
      body: text,
      at: new Date().toISOString(),
    };
    setMessages((current) => [...current, message]);
    postMessage(
      apiBaseUrl,
      token,
      item.workoutCheckinId,
      message.id,
      text,
    ).catch((error) => {
      setMessages((current) =>
        current.filter((entry) => entry.id !== message.id),
      );
      fail(error);
    });
  };
  return (
    <div className="post-text">
      {shownCaption && (
        <p className="post-caption">
          <strong>{authorName}</strong> {shownCaption}
        </p>
      )}
      {all.length > 3 && !showAll && (
        <button
          type="button"
          className="text-button post-more"
          onClick={() => setShowAll(true)}
        >
          View all {all.length} comments
        </button>
      )}
      {visible.length > 0 && (
        <ul className="post-messages" aria-label="Comments">
          {visible.map((message) => (
            <li key={message.id}>
              <strong>{message.mine ? "You" : message.name}</strong>{" "}
              {message.body}
              {!message.mine && (
                <button
                  type="button"
                  className="text-button post-report"
                  aria-label={`Report message from ${message.name}`}
                  onClick={async () => {
                    if (!(await confirmReport())) return;
                    setReported((ids) => new Set(ids).add(message.id));
                    reportMessage(apiBaseUrl, token, message.id, "harassment")
                      .then(() =>
                        onNotice({
                          kind: "success",
                          text: "Reported and hidden. The operator will review it.",
                        }),
                      )
                      .catch(fail);
                  }}
                >
                  Report
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {writing === "caption" ? (
        <form className="caption-compose" onSubmit={submit}>
          <textarea
            aria-label="Caption"
            placeholder="What did you hit?"
            maxLength={captionLimit}
            rows={2}
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: the field opens on request.
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <fieldset className="caption-starters" aria-label="Caption starters">
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                className="caption-starter"
                onClick={() =>
                  setDraft((current) =>
                    (current.trim()
                      ? `${current.trim()} · ${starter}`
                      : starter
                    ).slice(0, captionLimit),
                  )
                }
              >
                {starter}
              </button>
            ))}
          </fieldset>
          <div className="caption-compose-actions">
            <span
              className={`caption-count${left <= 20 ? " is-near" : ""}`}
              aria-live="polite"
            >
              {left <= 20 ? `${left} left` : ""}
            </span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setWriting(null)}
            >
              Cancel
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Add
            </button>
          </div>
        </form>
      ) : writing ? (
        <form className="post-compose" onSubmit={submit}>
          <input
            aria-label="Comment"
            placeholder="Add a comment…"
            maxLength={200}
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: the field opens on request.
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            Post
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setWriting(null)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="post-text-actions">
          {canCaption && (
            <button
              type="button"
              className="text-button"
              onClick={() => void open("caption")}
            >
              Add caption
            </button>
          )}
          {onReportPhotos && (
            <button
              type="button"
              className="text-button post-report-photos"
              onClick={onReportPhotos}
            >
              Report photos
            </button>
          )}
        </div>
      )}
    </div>
  );
}
