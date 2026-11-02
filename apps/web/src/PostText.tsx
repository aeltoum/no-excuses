import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { Avatar } from "./avatars";
import {
  type ProofItem,
  type ProofMessage,
  postMessage,
  reportMessage,
  setCaption,
} from "./proof";
import { Sheet } from "./Sheet";

type Notice = { kind: "success" | "error"; text: string };

const captionLimit = 140;
const quickEmoji = ["❤️", "🙌", "🔥", "👏", "💪", "😍", "😮", "😂"];

// Comment age the way the feed shows it: 5m, 3h, 2d, 4w.
const ago = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
};

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
  starters.push("Showed up anyway");
  return starters;
};

// A post's caption and messages, with the inputs to add them.
export function PostText({
  item,
  authorName,
  askComment = 0,
  askCaption = 0,
  onCaptioned,
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
  // Bumped by the author's post menu.
  askCaption?: number;
  onCaptioned?: () => void;
  apiBaseUrl: string;
  token: string;
  ensureConduct: () => Promise<boolean>;
  confirmReport: () => Promise<boolean>;
  onNotice: (notice: Notice) => void;
  onReportPhotos?: () => void;
}) {
  const [caption, setLocalCaption] = useState(item.caption ?? null);
  const [messages, setMessages] = useState<ProofMessage[]>(item.messages ?? []);
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
  // Only a bump after mount opens a field; a reopened post starts closed.
  const asked = useRef({ askComment, askCaption });
  useEffect(() => {
    if (askComment > asked.current.askComment) void openRef.current("message");
    asked.current.askComment = askComment;
  }, [askComment]);
  useEffect(() => {
    if (askCaption > asked.current.askCaption) void openRef.current("caption");
    asked.current.askCaption = askCaption;
  }, [askCaption]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !writing) return;
    // A comment keeps the sheet open, like a thread; a caption closes its form.
    if (writing === "caption") setWriting(null);
    setDraft("");
    // Optimistic: the text shows at once; a failure removes it again.
    if (writing === "caption") {
      setLocalCaption(text);
      onCaptioned?.();
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
      {all.length > 2 && (
        <button
          type="button"
          className="text-button post-more"
          onClick={() => void open("message")}
        >
          View all {all.length} comments
        </button>
      )}
      {all.length > 0 && (
        <ul className="post-messages" aria-label="Latest comments">
          {all.slice(-2).map((message) => (
            <li key={message.id}>
              <strong>{message.mine ? "You" : message.name}</strong>{" "}
              {message.body}
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={writing === "message"}
        title="Comments"
        onDismiss={() => setWriting(null)}
      >
        <div className="comments">
          {all.length === 0 ? (
            <p className="comments-empty">
              <strong>No comments yet</strong>
              <span>Start the conversation.</span>
            </p>
          ) : (
            <ul className="comments-list" aria-label="Comments">
              {all.map((message) => {
                const name = message.mine ? "You" : message.name;
                return (
                  <li key={message.id} className="comment">
                    <Avatar name={name} size="sm" />
                    <div className="comment-main">
                      <p className="comment-head">
                        <strong>{name}</strong>
                        <time dateTime={message.at}>{ago(message.at)}</time>
                      </p>
                      <p className="comment-body">{message.body}</p>
                      {!message.mine && (
                        <button
                          type="button"
                          className="comment-action"
                          aria-label={`Report comment from ${message.name}`}
                          onClick={async () => {
                            if (!(await confirmReport())) return;
                            setReported((ids) => new Set(ids).add(message.id));
                            reportMessage(
                              apiBaseUrl,
                              token,
                              message.id,
                              "harassment",
                            )
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <form className="comment-compose" onSubmit={submit}>
            <fieldset className="comment-emoji" aria-label="Quick emoji">
              {quickEmoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Add ${emoji}`}
                  onClick={() =>
                    setDraft((current) => (current + emoji).slice(0, 200))
                  }
                >
                  {emoji}
                </button>
              ))}
            </fieldset>
            <div className="comment-field">
              <Avatar name="You" size="sm" />
              <input
                aria-label="Comment"
                placeholder={`Add a comment for ${authorName}…`}
                maxLength={200}
                value={draft}
                enterKeyHint="send"
                // biome-ignore lint/a11y/noAutofocus: the sheet opens to write.
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="submit"
                className="comment-post"
                disabled={!draft.trim()}
              >
                Post
              </button>
            </div>
          </form>
        </div>
      </Sheet>
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
      ) : (
        <div className="post-text-actions">
          <button
            type="button"
            className="post-add-comment"
            onClick={() => void open("message")}
          >
            Add a comment…
          </button>
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
