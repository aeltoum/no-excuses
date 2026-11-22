import { useEffect, useState } from "react";
import { ApiError } from "./api-client";
import type { useConfirm } from "./Confirm";
import { call } from "./proof";
import type { useNotice } from "./Result";

type Owed = {
  id: string;
  source: "missed_target" | "rejected_report" | "card_expiry";
  createdAt: string;
  weekStartsAt: string | null;
  card: { title: string; status: string; expiresAt: string } | null;
  offered: boolean;
};
type Week = {
  memberWeekId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  target: number;
  verified: number;
  added: number;
};
export type SupportMember = {
  membershipId: string;
  name: string;
  targetStreak: number;
  pausedStreak: number | null;
  owed: Owed[];
  weeks: Week[];
};
type Group = {
  groupId: string;
  name: string;
  members: Array<{ membershipId: string; name: string }> | null;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
// Weeks end at the next week's start; show the last day inside the week.
const weekLabel = (week: Week) =>
  `${day(week.startsAt)} – ${day(new Date(Date.parse(week.endsAt) - 1).toISOString())}`;
const owedLabel = (item: Owed) =>
  item.source === "missed_target"
    ? `Missed week of ${item.weekStartsAt ? day(item.weekStartsAt) : day(item.createdAt)}`
    : item.source === "rejected_report"
      ? `Rejected workout, ${day(item.createdAt)}`
      : `Expired card, ${day(item.createdAt)}`;
const cardLabel = (item: Owed) =>
  item.card
    ? `${item.card.title} (${
        item.card.status === "review"
          ? "in review"
          : item.card.status === "safety_paused"
            ? "paused"
            : "due"
      })`
    : item.offered
      ? "Choosing a card"
      : "Waiting in backlog";
const statusLabel: Record<string, string> = {
  active: "In progress",
  attained: "Met",
  missed: "Missed",
  excepted: "Excused",
  ended_without_result: "Ended",
  provisional: "Settling",
};
// <input type="datetime-local"> value in the operator's own time zone.
const localInput = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
};

// Alpha support: waive owed Consequences, excuse a missed week, add a lost workout.
export function MemberSupport({
  apiBaseUrl,
  token,
  groups,
  ask,
  setNotice,
}: {
  apiBaseUrl: string;
  token: string;
  groups: Group[];
  ask: ReturnType<typeof useConfirm>[1];
  setNotice: ReturnType<typeof useNotice>[1];
}) {
  const [groupId, setGroupId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [member, setMember] = useState<SupportMember | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [logWeek, setLogWeek] = useState<string | null>(null);
  const [activityType, setActivityType] = useState("strength");
  const [minutes, setMinutes] = useState("45");
  const [intensity, setIntensity] = useState("moderate");
  const [completedAt, setCompletedAt] = useState("");

  useEffect(() => {
    setMember(null);
    setLogWeek(null);
    if (!membershipId) {
      setLoadState("idle");
      return;
    }
    let active = true;
    setLoadState("loading");
    call<SupportMember>(
      apiBaseUrl,
      token,
      `/v1/operator/member/${membershipId}`,
      { method: "GET" },
    )
      .then((next) => {
        if (!active) return;
        setMember(next);
        setLoadState("idle");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, membershipId]);

  // Overrides change a member's record for good, so the acting control waits.
  const run = async (
    key: string,
    path: string,
    body: unknown,
    done: string,
  ) => {
    setBusy(key);
    try {
      setMember(
        await call<SupportMember>(apiBaseUrl, token, path, {
          method: "POST",
          body,
        }),
      );
      setNotice({ kind: "success", text: done });
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "That didn’t go through. Try again.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const waive = async (item: Owed | null) => {
    if (!member) return;
    const what = item
      ? owedLabel(item).toLowerCase()
      : `all ${member.owed.length} owed cards`;
    if (
      !(await ask({
        title: item ? "Waive this card?" : "Waive every owed card?",
        body: `${member.name} no longer owes ${what}. Any card they’re doing or have in review closes without counting.`,
        confirm: item ? "Waive card" : "Waive all",
        tone: "danger",
      }))
    )
      return;
    void run(
      `waive:${item?.id ?? "all"}`,
      "/v1/operator/waive",
      { membershipId: member.membershipId, obligationId: item?.id ?? null },
      item ? "Card waived." : "All owed cards waived.",
    );
  };

  const excuse = async (week: Week) => {
    if (!member) return;
    if (
      !(await ask({
        title: "Excuse this week?",
        body: `${member.name}’s week of ${weekLabel(week)} becomes Excused. Its owed card is waived, and if it was their latest week their streak comes back.`,
        confirm: "Excuse week",
        tone: "danger",
      }))
    )
      return;
    void run(
      `excuse:${week.memberWeekId}`,
      "/v1/operator/excuse",
      { memberWeekId: week.memberWeekId },
      "Week excused.",
    );
  };

  const openLog = (week: Week) => {
    const end = Math.min(Date.now(), Date.parse(week.endsAt) - 60_000);
    setCompletedAt(localInput(new Date(end)));
    setLogWeek(week.memberWeekId);
  };

  const members = groups.find((entry) => entry.groupId === groupId)?.members;
  return (
    <section aria-labelledby="support-heading" className="member-support">
      <h2 id="support-heading">Member support</h2>
      <p className="hint">
        For alpha bugs: clear a card someone shouldn’t owe, excuse a week, or
        add a workout the app lost. Added workouts count but have no photos, so
        they stay off the Wall.
      </p>
      <div className="support-pick">
        <label>
          Group
          <select
            value={groupId}
            onChange={(event) => {
              setGroupId(event.target.value);
              setMembershipId("");
            }}
          >
            <option value="">Choose…</option>
            {groups.map((entry) => (
              <option key={entry.groupId} value={entry.groupId}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Member
          <select
            value={membershipId}
            disabled={!groupId}
            onChange={(event) => setMembershipId(event.target.value)}
          >
            <option value="">Choose…</option>
            {(members ?? []).map((entry) => (
              <option key={entry.membershipId} value={entry.membershipId}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loadState === "loading" && (
        <div
          className="support-skeleton"
          role="status"
          aria-label="Loading member"
        >
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-row" />
          <span className="skeleton skeleton-row" />
        </div>
      )}
      {loadState === "error" && (
        <p role="alert">Couldn’t load this member. Pick them again to retry.</p>
      )}

      {member && (
        <div className="support-member">
          <p className="support-streak">
            Streak <strong>{member.targetStreak}</strong>
            {member.pausedStreak
              ? ` (paused at ${member.pausedStreak} after a miss)`
              : ""}
          </p>

          <div className="support-block">
            <div className="support-block-head">
              <h3>
                Owes{" "}
                {member.owed.length > 0 && (
                  <span className="feed-badge">{member.owed.length}</span>
                )}
              </h3>
              {member.owed.length > 1 && (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => void waive(null)}
                >
                  {busy === "waive:all" ? "Waiving…" : "Waive all"}
                </button>
              )}
            </div>
            {member.owed.length === 0 ? (
              <p className="hint">Nothing owed.</p>
            ) : (
              <ul className="operator-list">
                {member.owed.map((item) => (
                  <li key={item.id}>
                    <span className="support-line">
                      <strong>{owedLabel(item)}</strong>
                      <span>{cardLabel(item)}</span>
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy !== null}
                      onClick={() => void waive(item)}
                    >
                      {busy === `waive:${item.id}` ? "Waiving…" : "Waive"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="support-block">
            <h3>Recent weeks</h3>
            <ul className="operator-list">
              {member.weeks.map((week) => (
                <li key={week.memberWeekId} className="support-week">
                  <span className="support-line">
                    <strong>{weekLabel(week)}</strong>
                    <span data-status={week.status}>
                      {statusLabel[week.status] ?? week.status} ·{" "}
                      {week.verified}/{week.target} done
                      {week.added > 0 ? ` (${week.added} added by you)` : ""}
                    </span>
                  </span>
                  <span className="operator-actions">
                    {week.status === "missed" && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => void excuse(week)}
                      >
                        {busy === `excuse:${week.memberWeekId}`
                          ? "Excusing…"
                          : "Excuse week"}
                      </button>
                    )}
                    {["active", "missed", "attained"].includes(week.status) && (
                      <button
                        type="button"
                        className="secondary-button"
                        aria-expanded={logWeek === week.memberWeekId}
                        disabled={busy !== null}
                        onClick={() =>
                          logWeek === week.memberWeekId
                            ? setLogWeek(null)
                            : openLog(week)
                        }
                      >
                        Add workout
                      </button>
                    )}
                  </span>
                  {logWeek === week.memberWeekId && (
                    <form
                      className="support-log"
                      aria-label={`Add workout for ${weekLabel(week)}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                          `log:${week.memberWeekId}`,
                          "/v1/operator/workout",
                          {
                            memberWeekId: week.memberWeekId,
                            activityType,
                            completedAt: new Date(completedAt).toISOString(),
                            durationMinutes: Number(minutes),
                            intensity,
                          },
                          "Workout added.",
                        ).then((saved) => {
                          if (saved) setLogWeek(null);
                        });
                      }}
                    >
                      <label>
                        Type
                        <select
                          value={activityType}
                          onChange={(event) =>
                            setActivityType(event.target.value)
                          }
                        >
                          <option value="strength">Strength</option>
                          <option value="cardio">Cardio</option>
                          <option value="class">Class</option>
                          <option value="sport">Sport</option>
                          <option value="mixed">Mixed</option>
                        </select>
                      </label>
                      <label>
                        When
                        <input
                          type="datetime-local"
                          required
                          value={completedAt}
                          min={localInput(new Date(week.startsAt))}
                          max={localInput(
                            new Date(
                              Math.min(
                                Date.now(),
                                Date.parse(week.endsAt) - 60_000,
                              ),
                            ),
                          )}
                          onChange={(event) =>
                            setCompletedAt(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Minutes
                        <input
                          type="number"
                          inputMode="numeric"
                          required
                          min={1}
                          max={600}
                          value={minutes}
                          onChange={(event) => setMinutes(event.target.value)}
                        />
                      </label>
                      <label>
                        Effort
                        <select
                          value={intensity}
                          onChange={(event) => setIntensity(event.target.value)}
                        >
                          <option value="low">Low</option>
                          <option value="moderate">Moderate</option>
                          <option value="high">High</option>
                        </select>
                      </label>
                      <button type="submit" disabled={busy !== null}>
                        {busy === `log:${week.memberWeekId}`
                          ? "Adding…"
                          : "Add workout"}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
