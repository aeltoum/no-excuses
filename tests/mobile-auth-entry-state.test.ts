import { describe, expect, it } from "vitest";
import {
  MobileAuthError,
  type MobileAuthSession,
} from "../apps/mobile/src/auth.js";
import {
  authEntryReducer,
  initialAuthEntryState,
  MAX_EMAIL_INPUT_LENGTH,
} from "../apps/mobile/src/auth-entry-state.js";

describe("mobile auth entry state", () => {
  const signedOutRequest = () =>
    authEntryReducer(
      authEntryReducer(initialAuthEntryState, {
        type: "session",
        session: { status: "signed-out" },
      }),
      { type: "open-request" },
    );

  it.each([
    "checking",
    "signed-out",
    "revoked",
    "service-unavailable",
    "failure",
  ] as const)("renders launch outcome %s", (status) => {
    expect(
      authEntryReducer(initialAuthEntryState, {
        type: "session",
        session: { status },
      }),
    ).toEqual({ screen: "launch", session: { status } });
  });

  it("renders signed-in launch outcome before routing", () => {
    const session = { access_token: "test" } as MobileAuthSession;
    expect(
      authEntryReducer(initialAuthEntryState, {
        type: "session",
        session: { status: "signed-in", session },
      }),
    ).toEqual({ screen: "launch", session: { status: "signed-in", session } });
  });

  it("opens email request only after signed-out continuation", () => {
    expect(signedOutRequest()).toEqual({
      screen: "request",
      email: "",
      busy: false,
    });
  });

  it("advances only after request acknowledgement and retains bounded email", () => {
    let state = signedOutRequest();
    state = authEntryReducer(state, {
      type: "edit-email",
      email: `${"x".repeat(300)}@example.test`,
    });
    expect(state).toMatchObject({
      screen: "request",
      email: "x".repeat(MAX_EMAIL_INPUT_LENGTH),
    });
    state = authEntryReducer(state, { type: "request-start" });
    expect(state).toMatchObject({ screen: "request", busy: true });
    state = authEntryReducer(state, { type: "request-success" });
    expect(state).toMatchObject({
      screen: "verify",
      busy: false,
      code: "",
      email: "x".repeat(MAX_EMAIL_INPUT_LENGTH),
    });
  });

  it("retains inputs on sanitized request and verification failures", () => {
    let request = signedOutRequest();
    request = authEntryReducer(request, {
      type: "edit-email",
      email: "member@example.test",
    });
    request = authEntryReducer(request, {
      type: "request-failure",
      error: new Error("private"),
    });
    expect(request).toMatchObject({
      email: "member@example.test",
      busy: false,
      error: expect.not.stringContaining("private"),
    });
    let verify = authEntryReducer(request, { type: "request-success" });
    verify = authEntryReducer(verify, { type: "edit-code", code: "12a34567" });
    verify = authEntryReducer(verify, {
      type: "verify-failure",
      error: new MobileAuthError("rejected", "secret"),
    });
    expect(verify).toMatchObject({
      screen: "verify",
      email: "member@example.test",
      code: "123456",
      busy: false,
      error: "We could not confirm that email or code. Check it and try again.",
    });
  });

  it("returns to retained email without retaining OTP", () => {
    expect(
      authEntryReducer(
        {
          screen: "verify",
          email: "member@example.test",
          code: "123456",
          busy: false,
        },
        { type: "back-to-email" },
      ),
    ).toEqual({ screen: "request", email: "member@example.test", busy: false });
  });
});
