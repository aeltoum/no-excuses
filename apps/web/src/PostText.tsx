import { useState } from "react";
import { ApiError } from "./api-client";
import {
  type ProofItem,
  type ProofMessage,
  postMessage,
  reportMessage,
  setCaption,
} from "./proof";

type Notice = { kind: "success" | "error"; text: string };

// A post's caption and messages, with the inputs to add them.
export function PostText({
  item,
  apiBaseUrl,
  token,
  ensureConduct,
  confirmReport,
  onNotice,
  onReportPhotos,
}: {
  item: ProofItem;
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
      {shownCaption && <p className="post-caption">{shownCaption}</p>}
      {all.length > 3 && !showAll && (
        <button
          type="button"
          className="text-button post-more"
          onClick={() => setShowAll(true)}
        >
          Show all {all.length} messages
        </button>
      )}
      {visible.length > 0 && (
        <ul className="post-messages" aria-label="Messages">
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
      {writing ? (
        <form className="post-compose" onSubmit={submit}>
          <input
            aria-label={writing === "caption" ? "Caption" : "Message"}
            placeholder={
              writing === "caption" ? "What did you hit?" : "Say something…"
            }
            maxLength={writing === "caption" ? 140 : 200}
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: the field opens on request.
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={!draft.trim()}>
            {writing === "caption" ? "Add" : "Send"}
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
          {!item.hidden && (
            <button
              type="button"
              className="text-button"
              onClick={() => void open("message")}
            >
              Message
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
