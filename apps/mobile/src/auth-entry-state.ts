import { MobileAuthError, type MobileSessionState } from "./auth";

export const MAX_EMAIL_INPUT_LENGTH = 254;
export const MAX_OTP_INPUT_LENGTH = 6;

export type AuthEntryState =
  | Readonly<{ screen: "launch"; session: MobileSessionState }>
  | Readonly<{
      screen: "request";
      email: string;
      busy: boolean;
      error?: string;
    }>
  | Readonly<{
      screen: "verify";
      email: string;
      code: string;
      busy: boolean;
      error?: string;
    }>;

export type AuthEntryAction =
  | Readonly<{ type: "session"; session: MobileSessionState }>
  | Readonly<{ type: "open-request" }>
  | Readonly<{ type: "edit-email"; email: string }>
  | Readonly<{ type: "edit-code"; code: string }>
  | Readonly<{
      type:
        | "request-start"
        | "request-success"
        | "verify-start"
        | "back-to-email";
    }>
  | Readonly<{ type: "request-failure" | "verify-failure"; error: unknown }>;

export const initialAuthEntryState: AuthEntryState = {
  screen: "launch",
  session: { status: "checking" },
};

export function authEntryError(error: unknown): string {
  if (error instanceof MobileAuthError) {
    if (error.kind === "invalid-input") return error.message;
    if (error.kind === "service-unavailable")
      return "Authentication service unavailable. Try again.";
  }
  return "We could not confirm that email or code. Check it and try again.";
}

export function authEntryReducer(
  state: AuthEntryState,
  action: AuthEntryAction,
): AuthEntryState {
  switch (action.type) {
    case "session":
      return { screen: "launch", session: action.session };
    case "open-request":
      return state.screen === "launch" &&
        state.session.status !== "checking" &&
        state.session.status !== "signed-in"
        ? { screen: "request", email: "", busy: false }
        : state;
    case "edit-email":
      return state.screen === "request"
        ? {
            ...state,
            email: action.email.slice(0, MAX_EMAIL_INPUT_LENGTH),
            error: undefined,
          }
        : state;
    case "edit-code":
      return state.screen === "verify"
        ? {
            ...state,
            code: action.code.replace(/\D/g, "").slice(0, MAX_OTP_INPUT_LENGTH),
            error: undefined,
          }
        : state;
    case "request-start":
      return state.screen === "request"
        ? { ...state, busy: true, error: undefined }
        : state;
    case "request-success":
      return state.screen === "request"
        ? { screen: "verify", email: state.email, code: "", busy: false }
        : state;
    case "request-failure":
      return state.screen === "request"
        ? { ...state, busy: false, error: authEntryError(action.error) }
        : state;
    case "verify-start":
      return state.screen === "verify"
        ? { ...state, busy: true, error: undefined }
        : state;
    case "verify-failure":
      return state.screen === "verify"
        ? { ...state, busy: false, error: authEntryError(action.error) }
        : state;
    case "back-to-email":
      return state.screen === "verify"
        ? { screen: "request", email: state.email, busy: false }
        : state;
  }
}
