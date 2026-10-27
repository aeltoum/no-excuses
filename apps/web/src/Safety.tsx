import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { onClearPersisted } from "./persist";
import { call } from "./proof";
import { Sheet } from "./Sheet";

// Latest safety state from Home extras, shared by the feed and the Group screen.
const safety = { conductAccepted: false, blocked: new Set<string>() };
onClearPersisted(() => {
  safety.conductAccepted = false;
  safety.blocked = new Set();
});
export function rememberSafety(
  value: { conductAccepted: boolean; blocked: string[] } | undefined,
) {
  if (!value) return;
  safety.conductAccepted = value.conductAccepted;
  safety.blocked = new Set(value.blocked);
}
export const isBlocked = (membershipId: string) =>
  safety.blocked.has(membershipId);

export const reportCategories: Array<[string, string]> = [
  ["harassment", "Harassment or humiliation"],
  ["threats", "Threats"],
  ["sexual_content", "Sexual content"],
  ["private_information", "Sharing private information"],
  ["dangerous", "Dangerous content"],
  ["other", "Something else"],
];

// Shows the Group conduct rules once, before the member first writes; resolves true on accept.
export function useConduct(apiBaseUrl: string, token: string) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resolver = useRef<(value: boolean) => void>(() => {});
  const ensure = useCallback(() => {
    if (safety.conductAccepted) return Promise.resolve(true);
    setError("");
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const finish = (value: boolean) => {
    setOpen(false);
    resolver.current(value);
  };
  const sheet = (
    <Sheet
      open={open}
      title="Group conduct rules"
      onDismiss={() => finish(false)}
    >
      <div className="conduct-rules">
        <p>Before you write anything your Group can read:</p>
        <ul>
          <li>
            No sexual content, threats, harassment, slurs, or humiliation.
          </li>
          <li>
            Don’t share someone’s private information or photos without consent.
          </li>
          <li>Nothing dangerous. Push each other, never past safe.</li>
          <li>Non-explicit gym and post-workout photos are fine.</li>
        </ul>
        <p className="hint">
          Members can report messages and members, and block each other. Reports
          go to the app’s operator, never to the person reported.
        </p>
        {error && (
          <p className="result error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            call(apiBaseUrl, token, "/v1/safety/conduct", {
              method: "POST",
              body: {},
            })
              .then(() => {
                safety.conductAccepted = true;
                finish(true);
              })
              .catch((failure) =>
                setError(
                  failure instanceof ApiError
                    ? failure.message
                    : "Couldn’t save. Try again.",
                ),
              )
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : "I agree"}
        </button>
      </div>
    </Sheet>
  );
  return [sheet, ensure] as const;
}

type Notice = { kind: "success" | "error"; text: string };

// Group screen: report or block another member from their row.
export function MemberSafety({
  apiBaseUrl,
  token,
  member,
  onClose,
  onNotice,
}: {
  apiBaseUrl: string;
  token: string;
  member: { membershipId: string; displayName: string } | null;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [step, setStep] = useState<"menu" | "report">("menu");
  const [, refresh] = useState(0);
  const [reporting, setReporting] = useState(false);
  const blocked = member ? isBlocked(member.membershipId) : false;
  const close = () => {
    setStep("menu");
    onClose();
  };
  return (
    <Sheet
      open={member !== null}
      title={member?.displayName ?? ""}
      onDismiss={close}
    >
      {member && step === "menu" && (
        <div className="member-safety">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setStep("report")}
          >
            Report {member.displayName}…
          </button>
          <button
            type="button"
            className={blocked ? "secondary-button" : "danger-outline"}
            onClick={() => {
              const on = !blocked;
              // Optimistic: the block applies on screen at once.
              if (on) safety.blocked.add(member.membershipId);
              else safety.blocked.delete(member.membershipId);
              refresh((value) => value + 1);
              onNotice({
                kind: "success",
                text: on
                  ? `Blocked ${member.displayName}. You won’t see each other’s past posts or messages, and neither can react, nudge, or message the other.`
                  : `Unblocked ${member.displayName}.`,
              });
              call(apiBaseUrl, token, "/v1/safety/block", {
                method: "POST",
                body: { membershipId: member.membershipId, on },
              }).catch((error) => {
                if (on) safety.blocked.delete(member.membershipId);
                else safety.blocked.add(member.membershipId);
                refresh((value) => value + 1);
                onNotice({
                  kind: "error",
                  text:
                    error instanceof ApiError
                      ? error.message
                      : "Couldn’t save. Try again.",
                });
              });
            }}
          >
            {blocked
              ? `Unblock ${member.displayName}`
              : `Block ${member.displayName}`}
          </button>
          <p className="hint">
            Blocking doesn’t change votes, targets, or results, and they aren’t
            told.
          </p>
        </div>
      )}
      {member && step === "report" && (
        <fieldset className="report-categories">
          <legend>What’s going on?</legend>
          {reportCategories.map(([value, label]) => (
            <button
              type="button"
              key={value}
              disabled={reporting}
              onClick={() => {
                setReporting(true);
                call(apiBaseUrl, token, "/v1/safety/report-member", {
                  method: "POST",
                  body: { membershipId: member.membershipId, category: value },
                })
                  .then(() => {
                    onNotice({
                      kind: "success",
                      text: "Reported. The operator will review it; they won’t know it was you.",
                    });
                    close();
                  })
                  .catch((error) =>
                    onNotice({
                      kind: "error",
                      text:
                        error instanceof ApiError
                          ? error.message
                          : "Couldn’t report. Try again.",
                    }),
                  )
                  .finally(() => setReporting(false));
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
    </Sheet>
  );
}
