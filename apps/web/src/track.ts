import { call } from "./proof";

// First-party product events (retention audit, section 7). Events queue in memory and
// send in small batches; a failure drops them, since they must never slow the app.
export type EventName =
  | "app_opened"
  | "signin_verified"
  | "onboarding_step_completed"
  | "invite_created"
  | "invite_shared"
  | "push_prompt_shown"
  | "push_enabled"
  | "log_sheet_opened"
  | "log_submitted"
  | "log_abandoned"
  | "post_viewed"
  | "reaction_added"
  | "nudge_sent"
  | "recap_viewed"
  | "card_offer_viewed"
  | "comeback_used"
  | "week_off_requested";

type Payload = Record<string, string | number | boolean | null>;
let queue: Array<{ name: EventName; payload: Payload }> = [];
let target: { apiBaseUrl: string; token: string } | null = null;
let timer = 0;

export function setTrackTarget(apiBaseUrl: string, token: string | null) {
  target = token ? { apiBaseUrl, token } : null;
  if (target && queue.length && !timer) timer = window.setTimeout(flush, 500);
}

// Sign-out drops anything not yet sent.
export function clearTrack() {
  queue = [];
  target = null;
}

const flush = () => {
  timer = 0;
  // Events made while access is still being confirmed wait for the token.
  if (!target || queue.length === 0) return;
  const events = queue.slice(0, 50);
  queue = queue.slice(50);
  void call(target.apiBaseUrl, target.token, "/v1/events", {
    method: "POST",
    body: { events },
  }).catch(() => undefined);
  if (queue.length) timer = window.setTimeout(flush, 2000);
};

export function track(name: EventName, payload: Payload = {}) {
  if (queue.length >= 100) return;
  queue.push({ name, payload });
  if (!timer) timer = window.setTimeout(flush, 2000);
}
