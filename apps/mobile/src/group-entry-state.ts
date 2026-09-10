import { MobileApiClientError } from "./api-client";

export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_TIME_ZONE_LENGTH = 64;
export const MAX_INVITATION_TOKEN_LENGTH = 256;
export const MAX_TARGET_INPUT_LENGTH = 16;

type Editable = Readonly<{ busy: boolean; error?: string }>;

export type GroupEntryState =
  | Readonly<{ screen: "choice" }>
  | (Editable &
      Readonly<{
        screen: "create";
        name: string;
        timeZone: string;
        weeklyTarget: string;
      }>)
  | (Editable &
      Readonly<{
        screen: "join";
        token: string;
        recurringTarget: string;
        currentTarget: string;
      }>)
  | Readonly<{ screen: "success"; membershipId: string }>;

export type GroupEntryAction =
  | Readonly<{ type: "choose-create"; timeZone: string }>
  | Readonly<{ type: "choose-join" }>
  | Readonly<{ type: "edit"; field: string; value: string }>
  | Readonly<{ type: "submit-start" }>
  | Readonly<{ type: "submit-failure"; error: unknown }>
  | Readonly<{ type: "submit-success"; membershipId: string }>
  | Readonly<{ type: "back" }>;

export const initialGroupEntryState: GroupEntryState = { screen: "choice" };

export type GroupSubmission =
  | Readonly<{
      kind: "create";
      idempotencyKey: string;
      body: Readonly<{
        groupId: string;
        membershipId: string;
        name: string;
        timeZone: string;
        weeklyTarget: number;
      }>;
    }>
  | Readonly<{
      kind: "join";
      idempotencyKey: string;
      body: Readonly<{
        token: string;
        membershipId: string;
        recurringTarget: number;
        currentTarget: number;
      }>;
    }>;

export class GroupEntryValidationError extends Error {}

function target(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new GroupEntryValidationError(
      `${label} must be a whole number of 1 or more`,
    );
  }
  return parsed;
}

function validTimeZone(value: string): string {
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new GroupEntryValidationError("Enter a valid IANA time zone");
  }
  return normalized;
}

export function buildGroupSubmission(
  state: GroupEntryState,
  ids: Readonly<{
    idempotencyKey: string;
    membershipId: string;
    groupId?: string;
  }>,
): GroupSubmission {
  if (state.screen === "create") {
    const name = state.name.trim();
    if (!name) throw new GroupEntryValidationError("Enter a Group name");
    if (!ids.groupId) throw new Error("Group ID is required");
    return {
      kind: "create",
      idempotencyKey: ids.idempotencyKey,
      body: {
        groupId: ids.groupId,
        membershipId: ids.membershipId,
        name,
        timeZone: validTimeZone(state.timeZone),
        weeklyTarget: target(state.weeklyTarget, "Weekly target"),
      },
    };
  }
  if (state.screen === "join") {
    const tokenValue = state.token.trim();
    if (!tokenValue)
      throw new GroupEntryValidationError("Enter an invitation token");
    const recurringTarget = target(state.recurringTarget, "Recurring target");
    const currentTarget = target(state.currentTarget, "Joining-week target");
    if (currentTarget > recurringTarget) {
      throw new GroupEntryValidationError(
        "Joining-week target cannot exceed recurring target",
      );
    }
    return {
      kind: "join",
      idempotencyKey: ids.idempotencyKey,
      body: {
        token: tokenValue,
        membershipId: ids.membershipId,
        recurringTarget,
        currentTarget,
      },
    };
  }
  throw new Error("Group form is not open");
}

export function groupEntryError(error: unknown): string {
  if (error instanceof GroupEntryValidationError) return error.message;
  if (error instanceof MobileApiClientError) {
    if (error.kind === "network") return "Service unavailable. Try again.";
    if (error.kind === "api") {
      if (error.apiError?.code === "denied")
        return "This Account cannot complete that Group action.";
      if (error.apiError?.code === "idempotency_conflict")
        return "Request conflict. Review the form and try again.";
      if (error.apiError?.retryable)
        return "Group service unavailable. Try again.";
    }
  }
  return "We could not complete that Group action. Check the form and try again.";
}

export function groupEntryReducer(
  state: GroupEntryState,
  action: GroupEntryAction,
): GroupEntryState {
  switch (action.type) {
    case "choose-create":
      return {
        screen: "create",
        name: "",
        timeZone: action.timeZone.slice(0, MAX_TIME_ZONE_LENGTH),
        weeklyTarget: "",
        busy: false,
      };
    case "choose-join":
      return {
        screen: "join",
        token: "",
        recurringTarget: "",
        currentTarget: "",
        busy: false,
      };
    case "edit": {
      if (state.screen !== "create" && state.screen !== "join") return state;
      const limits: Record<string, number> = {
        name: MAX_GROUP_NAME_LENGTH,
        timeZone: MAX_TIME_ZONE_LENGTH,
        token: MAX_INVITATION_TOKEN_LENGTH,
        weeklyTarget: MAX_TARGET_INPUT_LENGTH,
        recurringTarget: MAX_TARGET_INPUT_LENGTH,
        currentTarget: MAX_TARGET_INPUT_LENGTH,
      };
      if (!(action.field in state) || !(action.field in limits)) return state;
      const value = action.value.slice(0, limits[action.field]);
      return { ...state, [action.field]: value, error: undefined };
    }
    case "submit-start":
      return state.screen === "create" || state.screen === "join"
        ? { ...state, busy: true, error: undefined }
        : state;
    case "submit-failure":
      return state.screen === "create" || state.screen === "join"
        ? { ...state, busy: false, error: groupEntryError(action.error) }
        : state;
    case "submit-success":
      return { screen: "success", membershipId: action.membershipId };
    case "back":
      return state.screen === "create" || state.screen === "join"
        ? initialGroupEntryState
        : state;
  }
}
