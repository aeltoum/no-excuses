import { useEffect, useState } from "react";
import { ApiError } from "./api-client";
import { useConfirm } from "./Confirm";
import { call } from "./proof";
import { Result, useNotice } from "./Result";

type Case = {
  id: string;
  kind: "message_report" | "member_report" | "safety_block" | "proof_report";
  category: string | null;
  createdAt: string;
  group: string;
  groupId: string;
  reporter: string | null;
  subject: string | null;
  subjectStatus: string | null;
  message: string | null;
  photoUrls?: string[];
};
type Hold = {
  id: string;
  kind: "technical" | "service";
  group: string;
  member: string | null;
  reason: string;
  startsAt: string;
};
type Console = {
  cases: Case[];
  holds: Hold[];
  suspended: Array<{ accountId: string; name: string }>;
  groups: Array<{
    groupId: string;
    name: string;
    members: Array<{ membershipId: string; name: string }> | null;
  }>;
};

const kindLabel: Record<Case["kind"], string> = {
  message_report: "Reported message",
  member_report: "Reported member",
  safety_block: "Safety block",
  proof_report: "Reported photos",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Operator-only: Moderation cases, Moderation holds, and Technical or Service pauses.
export function OperatorConsole({
  apiBaseUrl,
  token,
}: {
  apiBaseUrl: string;
  token: string;
}) {
  const [state, setState] = useState<Console | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "denied" | "error"
  >("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useNotice();
  const [confirmSheet, ask] = useConfirm();
  const [holdGroup, setHoldGroup] = useState("");
  const [holdMember, setHoldMember] = useState("");
  const [holdReason, setHoldReason] = useState("");

  useEffect(() => {
    let active = true;
    call<Console>(apiBaseUrl, token, "/v1/operator", { method: "GET" })
      .then((next) => {
        if (!active) return;
        setState(next);
        setStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        setStatus(
          error instanceof ApiError && error.kind === "denied"
            ? "denied"
            : "error",
        );
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token]);

  // Operator actions cannot be undone on screen, so the acting control waits.
  const run = async (
    key: string,
    path: string,
    body: unknown,
    done: string,
  ) => {
    setBusy(key);
    try {
      setState(
        await call<Console>(apiBaseUrl, token, path, { method: "POST", body }),
      );
      setNotice({ kind: "success", text: done });
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Action failed. Try again.",
      });
    } finally {
      setBusy(null);
    }
  };
  const resolve = async (item: Case, action: string, label: string) => {
    if (
      action !== "dismiss" &&
      !(await ask({
        title: `${label}?`,
        body:
          action === "terminate"
            ? `${item.subject} leaves ${item.group} for good; finished weeks stay.`
            : action === "suspend"
              ? `${item.subject} loses access until reinstated. Their deadlines pause.`
              : "The content stays hidden for everyone.",
        confirm: label,
        tone: "danger",
      }))
    )
      return;
    void run(
      `${item.id}:${action}`,
      "/v1/operator/resolve",
      { caseId: item.id, action },
      `${label}: done.`,
    );
  };

  if (status === "loading")
    return (
      <div className="home-skeleton" role="status" aria-label="Loading console">
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-row" />
        <span className="skeleton skeleton-row" />
      </div>
    );
  if (status === "denied")
    return <p role="alert">This console is for the app’s operator only.</p>;
  if (status === "error" || !state)
    return <p role="alert">Couldn’t load the console. Try again later.</p>;
  const members =
    state.groups.find((entry) => entry.groupId === holdGroup)?.members ?? [];
  return (
    <div className="operator-console">
      {confirmSheet}
      <Result notice={notice} />
      <section aria-labelledby="cases-heading">
        <h2 id="cases-heading">
          Open cases <span className="feed-badge">{state.cases.length}</span>
        </h2>
        {state.cases.length === 0 ? (
          <p className="hint">Nothing waiting.</p>
        ) : (
          <ul className="operator-cases">
            {state.cases.map((item) => (
              <li key={item.id}>
                <strong>{kindLabel[item.kind]}</strong>
                <span>
                  {item.group} · {when(item.createdAt)}
                  {item.category
                    ? ` · ${item.category.replace(/_/g, " ")}`
                    : ""}
                </span>
                <span>
                  {item.reporter ?? "Someone"} →{" "}
                  {item.subject ?? "Former member"}
                  {item.subjectStatus === "suspended" ? " (suspended)" : ""}
                </span>
                {item.message && <q>{item.message}</q>}
                {item.photoUrls && item.photoUrls.length > 0 && (
                  <div className="operator-photos">
                    {item.photoUrls.map((url, index) => (
                      <img
                        key={url}
                        src={url}
                        alt={
                          index === 0
                            ? "Reported activity photo"
                            : "Reported presence photo"
                        }
                      />
                    ))}
                  </div>
                )}
                <div className="operator-actions">
                  {(
                    [
                      ["dismiss", "Dismiss"],
                      ...(item.message || item.photoUrls?.length
                        ? [["remove", "Remove content"]]
                        : []),
                      ["suspend", "Suspend access"],
                      ["terminate", "End membership"],
                    ] as Array<[string, string]>
                  ).map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      className={
                        action === "dismiss" ? undefined : "secondary-button"
                      }
                      disabled={busy !== null}
                      onClick={() => void resolve(item, action, label)}
                    >
                      {busy === `${item.id}:${action}` ? "Working…" : label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {state.suspended.length > 0 && (
        <section aria-labelledby="suspended-heading">
          <h2 id="suspended-heading">Suspended</h2>
          <ul className="operator-list">
            {state.suspended.map((entry) => (
              <li key={entry.accountId}>
                <span>{entry.name}</span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `reinstate:${entry.accountId}`,
                      "/v1/operator/reinstate",
                      { accountId: entry.accountId },
                      `${entry.name} reinstated.`,
                    )
                  }
                >
                  {busy === `reinstate:${entry.accountId}`
                    ? "Working…"
                    : "Reinstate"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="holds-heading">
        <h2 id="holds-heading">Pauses</h2>
        <p className="hint">
          While a pause is open, the weeks it covers wait to settle, so nobody
          misses a week for an outage or a defect.
        </p>
        {state.holds.length > 0 && (
          <ul className="operator-list">
            {state.holds.map((hold) => (
              <li key={hold.id}>
                <span>
                  {hold.kind === "service" ? "Service" : "Technical"} ·{" "}
                  {hold.member ?? hold.group} · {hold.reason} · since{" "}
                  {when(hold.startsAt)}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      `hold:${hold.id}`,
                      "/v1/operator/hold",
                      { open: false, holdId: hold.id },
                      "Pause ended.",
                    )
                  }
                >
                  {busy === `hold:${hold.id}` ? "Working…" : "End pause"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="operator-hold-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!holdGroup || !holdReason.trim()) return;
            void run(
              "hold:new",
              "/v1/operator/hold",
              {
                open: true,
                groupId: holdGroup,
                membershipId: holdMember || null,
                reason: holdReason.trim(),
              },
              "Pause opened.",
            ).then(() => {
              setHoldReason("");
              setHoldMember("");
            });
          }}
        >
          <label>
            Group
            <select
              value={holdGroup}
              onChange={(event) => {
                setHoldGroup(event.target.value);
                setHoldMember("");
              }}
            >
              <option value="">Choose…</option>
              {state.groups.map((entry) => (
                <option key={entry.groupId} value={entry.groupId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who
            <select
              value={holdMember}
              disabled={!holdGroup}
              onChange={(event) => setHoldMember(event.target.value)}
            >
              <option value="">Whole Group (Service pause)</option>
              {members.map((member) => (
                <option key={member.membershipId} value={member.membershipId}>
                  {member.name} (Technical pause)
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <input
              value={holdReason}
              maxLength={200}
              onChange={(event) => setHoldReason(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null || !holdGroup || !holdReason.trim()}
          >
            {busy === "hold:new" ? "Opening…" : "Open pause"}
          </button>
        </form>
      </section>
    </div>
  );
}
