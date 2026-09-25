import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { ApiError, createApiClient } from "./api-client";
import {
  normalizeOtp,
  requestOtp,
  resolveLiveAccess,
  verifyOtp,
  WebAuthError,
} from "./auth";
import { Sheet } from "./Sheet";
import { Weekly } from "./Weekly";

type Route =
  | "/"
  | "/sign-in"
  | "/group"
  | "/home"
  | "/target"
  | "/history"
  | "/account";
type Access =
  | "checking"
  | "signed-out"
  | "signed-in"
  | "revoked"
  | "unavailable"
  | "failure";
type Notice = { kind: "success" | "error"; text: string } | null;
const codePositions = [1, 2, 3, 4, 5, 6] as const;
const memberRoutes: Array<[Route, string]> = [
  ["/home", "Home"],
  ["/group", "Group"],
  ["/target", "Target"],
  ["/history", "History"],
  ["/account", "Account"],
];
const currentPath = () => window.location.pathname.replace(/\/+$/, "") || "/";

function TabIcon({ route }: { route: Route }) {
  const shape =
    route === "/home" ? (
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    ) : route === "/group" ? (
      <>
        <circle cx="9" cy="8.5" r="3.3" />
        <path d="M2.8 20c.8-3.4 3.3-5.3 6.2-5.3s5.4 1.9 6.2 5.3" />
        <circle cx="17" cy="9.5" r="2.4" />
        <path d="M16.6 14.7c2.4.3 4 2 4.6 4.8" />
      </>
    ) : route === "/target" ? (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ) : route === "/history" ? (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ) : (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20.5c1-4 4.2-6 8-6s7 2 8 6" />
      </>
    );

  return (
    <svg
      aria-hidden="true"
      className="tab-icon"
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
      width="24"
    >
      {shape}
    </svg>
  );
}

function Result({ notice }: { notice: Notice }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  return notice ? (
    <p
      className={`result ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      tabIndex={-1}
      ref={ref}
    >
      {notice.text}
    </p>
  ) : null;
}

export function App({
  auth,
  apiBaseUrl,
}: {
  auth: SupabaseClient;
  apiBaseUrl: string;
}) {
  const api = useRef(createApiClient(apiBaseUrl)).current;
  const [launching, setLaunching] = useState(true);
  const [path, setPath] = useState(currentPath);
  const [access, setAccess] = useState<Access>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<{
    groupId: string;
    membershipId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setLaunching(false), 700);
    return () => window.clearTimeout(timer);
  }, []);
  const [email, setEmail] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [signInDoor, setSignInDoor] = useState<"invited" | "returning" | null>(
    null,
  );
  const codeInputs = useRef<Array<HTMLInputElement | null>>([]);
  const emailInput = useRef<HTMLInputElement>(null);
  const [groupRevision, setGroupRevision] = useState(0);
  const [groupLoad, setGroupLoad] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [groupRoster, setGroupRoster] = useState<{
    groupName: string;
    members: Array<{
      membershipId: string;
      displayName: string;
      weeklyTarget: number;
      creator: boolean;
    }>;
  } | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<
    Array<{ invitationId: string; email: string; expiresAt: string }>
  >([]);
  const [manageGroup, setManageGroup] = useState(false);
  const [inviteReady, setInviteReady] = useState<{
    email: string;
    token: string;
  } | null>(null);
  const [deletionStep, setDeletionStep] = useState<
    "idle" | "review" | "code-sent" | "ready"
  >("idle");
  const [deletionCode, setDeletionCode] = useState("");
  const deletionCodeInputs = useRef<Array<HTMLInputElement | null>>([]);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameLoaded, setDisplayNameLoaded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3>(1);
  const [crewChoice, setCrewChoice] = useState<"start" | "join">("start");
  const [crewName, setCrewName] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [invitationPreview, setInvitationPreview] = useState<{
    groupName: string;
    memberCount: number;
    weekEndsAt: string;
  } | null>(null);
  const [recurringTarget, setRecurringTarget] = useState(2);
  const [currentTarget, setCurrentTarget] = useState(1);
  const [onboardingConsents, setOnboardingConsents] = useState({
    adult: false,
    pilot: false,
    product: false,
  });
  const deletionKey = useRef<string>(undefined);
  const commandDrafts = useRef(
    new Map<string, { signature: string; key: string; entityId: string }>(),
  );
  const commandDraft = (action: string, signature: string) => {
    const previous = commandDrafts.current.get(action);
    if (previous?.signature === signature) return previous;
    const next = {
      signature,
      key: crypto.randomUUID(),
      entityId: crypto.randomUUID(),
    };
    commandDrafts.current.set(action, next);
    return next;
  };
  const go = (destination: string) => {
    window.history.pushState(null, "", destination);
    setPath(destination);
    setNotice(null);
    window.scrollTo(0, 0);
  };
  const navigate = (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    go(destination);
  };

  useEffect(() => {
    const onPopState = () => {
      setPath(currentPath());
      setNotice(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const resolve = async (next: Session | null, expected: number) => {
      if (!next) {
        if (active && revision === expected) {
          setSession(null);
          setMembership(null);
          setAccess("signed-out");
        }
        return;
      }
      const result = await resolveLiveAccess(auth, next);
      if (!active || revision !== expected) return;
      if (result !== "signed-in") {
        setSession(null);
        setMembership(null);
        setAccess(result);
        return;
      }
      try {
        const current = await api.current(next.access_token);
        setSession(next);
        setMembership(current.data.membership);
        setAccess("signed-in");
      } catch (error) {
        setSession(null);
        setMembership(null);
        setAccess(
          error instanceof ApiError && error.kind === "unauthorized"
            ? "revoked"
            : error instanceof ApiError && error.retryable
              ? "unavailable"
              : "failure",
        );
      }
    };
    const listener = auth.auth.onAuthStateChange((_event, next) => {
      const expected = ++revision;
      void resolve(next, expected);
    });
    const expected = ++revision;
    void auth.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          if (active && revision === expected)
            setAccess(
              error.status === undefined || error.status >= 500
                ? "unavailable"
                : "failure",
            );
          return;
        }
        return resolve(data.session, expected);
      })
      .catch(() => {
        if (active && revision === expected) setAccess("unavailable");
      });
    return () => {
      active = false;
      listener.data.subscription.unsubscribe();
    };
  }, [api, auth]);
  useEffect(() => {
    if (access !== "signed-in" || path !== "/sign-in") return;
    const destination = membership ? "/home" : "/group";
    window.history.replaceState(null, "", destination);
    setPath(destination);
  }, [access, membership, path]);
  useEffect(() => {
    if (
      access !== "signed-in" ||
      (path !== "/account" && (path !== "/group" || membership)) ||
      !session
    )
      return;
    let active = true;
    setDisplayNameLoaded(false);
    setDisplayName("");
    void api
      .displayName(session.access_token)
      .then((response) => {
        if (!active) return;
        setDisplayName(response.data.displayName ?? "");
        setDisplayNameLoaded(true);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized") {
          setSession(null);
          setMembership(null);
          setAccess("revoked");
        } else {
          setNotice({ kind: "error", text: "Couldn’t load your name." });
        }
      });
    return () => {
      active = false;
    };
  }, [access, api, membership, path, session]);
  useEffect(() => {
    void groupRevision;
    if (
      access !== "signed-in" ||
      (path !== "/group" && path !== "/account") ||
      !membership ||
      !session
    )
      return;
    let active = true;
    setGroupLoad("loading");
    void api
      .roster(session.access_token, membership.groupId)
      .then(async (response) => {
        if (!active) return;
        setGroupRoster(response.data);
        if (path === "/account") {
          setGroupLoad("ready");
          return;
        }
        const creator = response.data.members.some(
          (member) =>
            member.membershipId === membership.membershipId && member.creator,
        );
        const pending = creator
          ? await api.pendingInvitations(
              session.access_token,
              membership.groupId,
            )
          : null;
        if (!active) return;
        setPendingInvitations(pending?.data ?? []);
        setManageGroup((current) => current && creator);
        setGroupLoad("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.kind === "unauthorized") {
          setSession(null);
          setMembership(null);
          setAccess("revoked");
          return;
        }
        setGroupLoad("error");
      });
    return () => {
      active = false;
    };
  }, [access, api, groupRevision, membership, path, session]);
  useEffect(() => {
    if (codeSent) codeInputs.current[0]?.focus();
    else if (signInDoor) emailInput.current?.focus();
  }, [codeSent, signInDoor]);

  const act = async (
    work: () => Promise<string>,
    options: {
      clearCode?: boolean;
      refreshMembership?: boolean;
      cutoff?: boolean;
    } = {},
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await work();
      if (options.clearCode) setCode("");
      if (options.refreshMembership && session)
        setMembership(
          (await api.current(session.access_token)).data.membership,
        );
      if (options.cutoff) {
        try {
          await auth.auth.signOut({ scope: "local" });
        } catch {
          // DB cutoff remains authoritative even when local sign-out fails.
        }
        setSession(null);
        setMembership(null);
        setAccess("signed-out");
      }
      setNotice({ kind: "success", text });
    } catch (error) {
      const message =
        error instanceof WebAuthError || error instanceof ApiError
          ? error.message
          : "Action failed. Try again.";
      if (error instanceof ApiError && error.kind === "unauthorized") {
        setSession(null);
        setMembership(null);
        setAccess("revoked");
      }
      setNotice({ kind: "error", text: message });
    } finally {
      setBusy(false);
    }
  };
  const token = () => {
    if (!session)
      throw new ApiError("unauthorized", "Access ended. Sign in again.");
    return session.access_token;
  };
  const field = (form: FormData, name: string) =>
    String(form.get(name) ?? "").trim();
  const submit =
    (
      fn: (form: FormData) => Promise<string>,
      options?: Parameters<typeof act>[1],
    ) =>
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void act(() => fn(new FormData(event.currentTarget)), options);
    };
  const statusCopy: Record<Exclude<Access, "signed-in">, [string, string]> = {
    checking: [
      "Checking your access",
      "Restoring session and confirming live access.",
    ],
    "signed-out": [
      "Sign in required",
      "Use your invited email address to continue.",
    ],
    revoked: [
      "Access ended",
      "Session or Group access was revoked. Sign in again if eligible.",
    ],
    unavailable: [
      "Access unavailable",
      "Authentication or authorization service is unavailable. Try again.",
    ],
    failure: [
      "Access check failed",
      "We could not safely confirm access. Try again.",
    ],
  };
  const route = (
    [
      "/",
      "/sign-in",
      "/group",
      "/home",
      "/target",
      "/history",
      "/account",
    ] as string[]
  ).includes(path)
    ? (path as Route)
    : null;
  const currentMemberIsAdmin = Boolean(
    membership &&
      groupRoster?.members.some(
        (member) =>
          member.membershipId === membership.membershipId && member.creator,
      ),
  );
  const canLeaveGroup = Boolean(
    groupRoster && (!currentMemberIsAdmin || groupRoster.members.length === 1),
  );

  if (launching) {
    return (
      <main className="launch-screen" aria-live="polite" aria-busy="true">
        <img src="/icons/icon.svg" alt="" width="160" height="160" />
        <div>
          <p className="launch-name">No Excuses</p>
          <p className="launch-status" role="status">
            Loading your crew
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="wordmark" href="/" onClick={(e) => navigate(e, "/")}>
          <img src="/icons/icon.svg" alt="" width="32" height="32" />
          <span>No Excuses</span>
        </a>
        <span className="status">
          <span aria-hidden="true" /> Private PWA
        </span>
      </header>
      <main className="route-content" id="main-content" key={route ?? path}>
        {!route ? (
          <Page
            eyebrow="Route unavailable"
            title="Nothing shared here."
            lead="This address is unavailable. No Group or Account details were loaded."
          >
            <a
              className="primary-action"
              href="/"
              onClick={(e) => navigate(e, "/")}
            >
              Return to start
            </a>
          </Page>
        ) : access !== "signed-in" && route !== "/sign-in" ? (
          <Page
            eyebrow="Private friend-group accountability"
            title={statusCopy[access][0]}
            lead={statusCopy[access][1]}
          >
            <a
              className="primary-action"
              href="/sign-in"
              onClick={(e) => navigate(e, "/sign-in")}
            >
              Continue to sign in
            </a>
            <Result notice={notice} />
          </Page>
        ) : route === "/sign-in" ? (
          <Page
            eyebrow="Private access"
            title="Sign in"
            lead="We use a six-digit email code. Unknown or ineligible accounts receive the same response."
          >
            {!signInDoor && (
              <section
                className="sign-in-doors"
                aria-label="Choose sign-in path"
              >
                <div>
                  <button
                    type="button"
                    onClick={() => setSignInDoor("invited")}
                  >
                    I was invited
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignInDoor("returning")}
                  >
                    I already have an account
                  </button>
                </div>
                <p>
                  First time here? Use I was invited — the other door can’t
                  create an account.
                </p>
              </section>
            )}
            {signInDoor && !codeSent && (
              <form
                onSubmit={submit(async () => {
                  if (signInDoor === "invited")
                    await api.enroll(
                      email.trim().toLowerCase(),
                      enrollmentToken.trim(),
                    );
                  const normalized = await requestOtp(auth, email);
                  setEmail(normalized);
                  setCodeSent(true);
                  return "If this account is eligible, a code was sent.";
                })}
              >
                <label htmlFor="email">Email address</label>
                <input
                  ref={emailInput}
                  id="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
                {signInDoor === "invited" && (
                  <>
                    <label htmlFor="enrollment-token">Invitation code</label>
                    <input
                      id="enrollment-token"
                      type="password"
                      autoComplete="off"
                      maxLength={256}
                      required
                      value={enrollmentToken}
                      onChange={(e) => setEnrollmentToken(e.target.value)}
                      disabled={busy}
                    />
                  </>
                )}
                <button type="submit" disabled={busy}>
                  {busy ? "Sending…" : "Send code"}
                </button>
              </form>
            )}
            {codeSent && (
              <form
                onSubmit={submit(
                  async () => {
                    await verifyOtp(auth, email, code);
                    if (signInDoor === "invited") {
                      setCrewChoice("join");
                      setInvitationCode(enrollmentToken.trim());
                    } else {
                      setCrewChoice("start");
                      setInvitationCode("");
                    }
                    return "Code accepted. Confirming live access.";
                  },
                  { clearCode: true },
                )}
              >
                <p>We sent a 6-digit code to {email}. It expires in 1 hour.</p>
                <fieldset className="otp-fields">
                  <legend>Six-digit code</legend>
                  {codePositions.map((position, index) => (
                    <input
                      key={position}
                      ref={(element) => {
                        codeInputs.current[index] = element;
                      }}
                      aria-label={`Code digit ${index + 1}`}
                      className={
                        notice?.text ===
                        "That code didn't match. Check the latest email, or send a new code."
                          ? "invalid"
                          : undefined
                      }
                      inputMode="numeric"
                      autoComplete={index === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      required
                      value={code[index] ?? ""}
                      onChange={(event) => {
                        const digit = event.target.value
                          .replace(/\D/g, "")
                          .slice(-1);
                        const digits = code.padEnd(6).split("");
                        digits[index] = digit;
                        setCode(digits.join("").trimEnd());
                        setNotice(null);
                        if (digit) codeInputs.current[index + 1]?.focus();
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Backspace" &&
                          !code[index] &&
                          index > 0
                        )
                          codeInputs.current[index - 1]?.focus();
                      }}
                      onPaste={(event) => {
                        const pasted = event.clipboardData
                          .getData("text")
                          .replace(/\D/g, "")
                          .slice(0, 6);
                        if (pasted.length !== 6) return;
                        event.preventDefault();
                        setCode(pasted);
                        setNotice(null);
                        codeInputs.current[5]?.focus();
                      }}
                      disabled={busy}
                    />
                  ))}
                </fieldset>
                <button type="submit" disabled={busy}>
                  {busy ? "Checking…" : "Verify code"}
                </button>
                <div className="sign-in-secondary-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await requestOtp(auth, email);
                        return "If this account is eligible, a code was sent.";
                      })
                    }
                  >
                    Send a new code
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setCodeSent(false);
                      setCode("");
                      setNotice(null);
                    }}
                  >
                    Use another email
                  </button>
                </div>
              </form>
            )}
            <Result notice={notice} />
          </Page>
        ) : route === "/group" ? (
          <Page
            eyebrow="Private membership"
            title={
              membership && groupLoad === "ready" && groupRoster
                ? groupRoster.groupName
                : "Your Group"
            }
            lead={
              membership && groupLoad === "ready" && groupRoster
                ? `${groupRoster.members.length} members`
                : membership
                  ? "Loading your crew."
                  : "Create a private Group or join with an invitation token."
            }
          >
            {!membership && (
              <section
                className="onboarding"
                aria-labelledby="onboarding-title"
              >
                {onboardingStep > 1 && (
                  <button
                    className="back-button"
                    type="button"
                    aria-label="Back"
                    disabled={busy}
                    onClick={() => {
                      setNotice(null);
                      setInvitationError("");
                      setOnboardingStep((onboardingStep - 1) as 1 | 2);
                    }}
                  >
                    ←
                  </button>
                )}
                <p className="step-indicator">
                  Step {onboardingStep} of 3 ·{" "}
                  {onboardingStep === 1
                    ? "About you"
                    : onboardingStep === 2
                      ? "Your crew"
                      : "Your target"}
                </p>
                {onboardingStep === 1 && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      if (
                        !displayName.trim() ||
                        ["adult", "pilot", "product"].some(
                          (name) => form.get(name) !== "on",
                        )
                      )
                        return;
                      void act(async () => {
                        const draft = commandDraft(
                          "onboarding-name",
                          displayName.trim(),
                        );
                        const saved = await api.setDisplayName(
                          token(),
                          displayName.trim(),
                          draft.key,
                        );
                        commandDrafts.current.delete("onboarding-name");
                        setDisplayName(saved.data.displayName ?? "");
                        await api.consent(token());
                        setOnboardingStep(2);
                        return "About you saved.";
                      });
                    }}
                  >
                    <h2 id="onboarding-title">Before you join a crew</h2>
                    <label>
                      What should your crew call you?
                      <input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        maxLength={40}
                        required
                        disabled={busy || !displayNameLoaded}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="adult"
                        checked={onboardingConsents.adult}
                        onChange={(event) =>
                          setOnboardingConsents({
                            ...onboardingConsents,
                            adult: event.target.checked,
                          })
                        }
                        required
                        disabled={busy}
                      />{" "}
                      I’m 18 or older
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="pilot"
                        checked={onboardingConsents.pilot}
                        onChange={(event) =>
                          setOnboardingConsents({
                            ...onboardingConsents,
                            pilot: event.target.checked,
                          })
                        }
                        required
                        disabled={busy}
                      />{" "}
                      I’m joining this private pilot
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        name="product"
                        checked={onboardingConsents.product}
                        onChange={(event) =>
                          setOnboardingConsents({
                            ...onboardingConsents,
                            product: event.target.checked,
                          })
                        }
                        required
                        disabled={busy}
                      />{" "}
                      I agree to the terms and how my data is used
                    </label>
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        !displayNameLoaded ||
                        !displayName.trim() ||
                        !Object.values(onboardingConsents).every(Boolean)
                      }
                    >
                      {busy ? "Saving…" : "Continue"}
                    </button>
                    <p className="hint">
                      Add your name and tick all three to continue.
                    </p>
                  </form>
                )}
                {onboardingStep === 2 && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (crewChoice === "start") {
                        if (crewName.trim()) {
                          setBusy(true);
                          window.setTimeout(() => {
                            setOnboardingStep(3);
                            setBusy(false);
                          }, 150);
                        }
                        return;
                      }
                      if (!invitationCode.trim()) return;
                      setBusy(true);
                      setInvitationError("");
                      setNotice(null);
                      void api
                        .previewInvitation(token(), invitationCode.trim())
                        .then((response) => {
                          setInvitationPreview(response.data);
                          setOnboardingStep(3);
                        })
                        .catch(() =>
                          setInvitationError(
                            "That code has expired. Ask your friend for a new one.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    <h2 id="onboarding-title">Start a crew or join one?</h2>
                    <fieldset className="crew-choice" aria-label="Crew choice">
                      <button
                        className="target-button"
                        type="button"
                        aria-pressed={crewChoice === "start"}
                        onClick={() => setCrewChoice("start")}
                      >
                        Start a crew
                      </button>
                      <button
                        className="target-button"
                        type="button"
                        aria-pressed={crewChoice === "join"}
                        onClick={() => setCrewChoice("join")}
                      >
                        I have a code
                      </button>
                    </fieldset>
                    {crewChoice === "start" ? (
                      <label>
                        Crew name
                        <input
                          value={crewName}
                          onChange={(event) => setCrewName(event.target.value)}
                          maxLength={80}
                          required
                          disabled={busy}
                        />
                        <span className="hint">Only members see it.</span>
                      </label>
                    ) : (
                      <label>
                        Invitation code
                        <input
                          value={invitationCode}
                          onChange={(event) => {
                            setInvitationCode(event.target.value);
                            setInvitationError("");
                          }}
                          maxLength={256}
                          required
                          disabled={busy}
                          aria-invalid={Boolean(invitationError)}
                          aria-describedby={
                            invitationError ? "invitation-error" : undefined
                          }
                        />
                        {invitationError && (
                          <span className="field-error" id="invitation-error">
                            {invitationError}
                          </span>
                        )}
                      </label>
                    )}
                    <button type="submit" disabled={busy}>
                      {busy ? "Saving…" : "Continue"}
                    </button>
                  </form>
                )}
                {onboardingStep === 3 && crewChoice === "start" && (
                  <form
                    onSubmit={submit(
                      async () => {
                        const draft = commandDraft(
                          "create",
                          `${crewName}:${recurringTarget}`,
                        );
                        await api.create(
                          token(),
                          {
                            groupId: draft.entityId,
                            membershipId: draft.key,
                            name: crewName,
                            timeZone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                            weeklyTarget: recurringTarget,
                          },
                          draft.key,
                        );
                        commandDrafts.current.delete("create");
                        return "Group created.";
                      },
                      { refreshMembership: true },
                    )}
                  >
                    <h2 id="onboarding-title">Your weekly target</h2>
                    <div className="target-stepper">
                      <button
                        type="button"
                        aria-label="Decrease weekly target"
                        onClick={() =>
                          setRecurringTarget(Math.max(1, recurringTarget - 1))
                        }
                      >
                        −
                      </button>
                      <strong>{recurringTarget} workouts</strong>
                      <button
                        type="button"
                        aria-label="Increase weekly target"
                        onClick={() => setRecurringTarget(recurringTarget + 1)}
                      >
                        +
                      </button>
                    </div>
                    <p className="hint">
                      We suggest at least 2. You can change it for any future
                      week.
                    </p>
                    <button type="submit" disabled={busy}>
                      {busy ? "Saving…" : `Start ${crewName}`}
                    </button>
                  </form>
                )}
                {onboardingStep === 3 &&
                  crewChoice === "join" &&
                  invitationPreview && (
                    <form
                      onSubmit={submit(
                        async () => {
                          const draft = commandDraft(
                            "join",
                            `${invitationCode}:${recurringTarget}:${currentTarget}`,
                          );
                          await api.join(
                            token(),
                            {
                              token: invitationCode,
                              membershipId: draft.entityId,
                              recurringTarget,
                              currentTarget,
                            },
                            draft.key,
                          );
                          commandDrafts.current.delete("join");
                          return "Invitation accepted. Group joined.";
                        },
                        { refreshMembership: true },
                      )}
                    >
                      <h2 id="onboarding-title">
                        Join {invitationPreview.groupName}
                      </h2>
                      <div className="crew-preview">
                        <strong>{invitationPreview.groupName}</strong>
                        <span>
                          {invitationPreview.memberCount} members. This week
                          ends{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            weekday: "long",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(invitationPreview.weekEndsAt))}
                          .
                        </span>
                      </div>
                      <p>This week (starting today)</p>
                      <div className="target-stepper">
                        <button
                          className="target-button"
                          type="button"
                          aria-label="Decrease this week’s target"
                          onClick={() =>
                            setCurrentTarget(Math.max(1, currentTarget - 1))
                          }
                        >
                          −
                        </button>
                        <strong>{currentTarget} workouts</strong>
                        <button
                          className="target-button"
                          type="button"
                          aria-label="Increase this week’s target"
                          onClick={() =>
                            setCurrentTarget(
                              Math.min(recurringTarget, currentTarget + 1),
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                      <p>Every week after</p>
                      <div className="target-stepper">
                        <button
                          className="target-button"
                          type="button"
                          aria-label="Decrease recurring target"
                          onClick={() => {
                            const next = Math.max(1, recurringTarget - 1);
                            setRecurringTarget(next);
                            setCurrentTarget(Math.min(currentTarget, next));
                          }}
                        >
                          −
                        </button>
                        <strong>{recurringTarget} workouts</strong>
                        <button
                          className="target-button"
                          type="button"
                          aria-label="Increase recurring target"
                          onClick={() =>
                            setRecurringTarget(recurringTarget + 1)
                          }
                        >
                          +
                        </button>
                      </div>
                      <button type="submit" disabled={busy}>
                        {busy
                          ? "Saving…"
                          : `Join ${invitationPreview.groupName}`}
                      </button>
                    </form>
                  )}
              </section>
            )}
            {membership && (
              <section className="group-screen" aria-live="polite">
                {groupLoad === "loading" && (
                  <div
                    className="home-skeleton"
                    role="status"
                    aria-label="Loading your crew"
                  >
                    <span className="skeleton skeleton-line" />
                    <span className="skeleton skeleton-row" />
                    <span className="skeleton skeleton-row" />
                  </div>
                )}
                {groupLoad === "error" && (
                  <div className="home-load-error">
                    <div>
                      <h2>Couldn’t load your crew.</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGroupRevision((value) => value + 1)}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {groupLoad === "ready" && groupRoster && (
                  <>
                    <div className="group-heading">
                      {groupRoster.members.some(
                        (member) =>
                          member.membershipId === membership.membershipId &&
                          member.creator,
                      ) && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setManageGroup(!manageGroup)}
                        >
                          {manageGroup ? "Done" : "Manage"}
                        </button>
                      )}
                    </div>
                    {manageGroup && (
                      <p className="hint">
                        As the crew’s creator, you can remove members and revoke
                        invites.
                      </p>
                    )}
                    <ul className="group-roster">
                      {groupRoster.members.map((member) => (
                        <li key={member.membershipId}>
                          <span className="group-avatar" aria-hidden="true">
                            {member.displayName
                              .split(/\s+/)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")
                              .toUpperCase()}
                          </span>
                          <span className="group-member-copy">
                            <strong>{member.displayName}</strong>
                            <span>{member.weeklyTarget} a week</span>
                          </span>
                          {manageGroup &&
                            member.membershipId !== membership.membershipId && (
                              <button
                                className="row-action danger-text"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    !window.confirm(
                                      `Remove ${member.displayName} from ${groupRoster.groupName}?`,
                                    )
                                  )
                                    return;
                                  void act(async () => {
                                    const draft = commandDraft(
                                      "remove",
                                      member.membershipId,
                                    );
                                    await api.remove(
                                      token(),
                                      membership.groupId,
                                      member.membershipId,
                                      draft.key,
                                    );
                                    commandDrafts.current.delete("remove");
                                    setGroupRevision((value) => value + 1);
                                    return "Member removed.";
                                  });
                                }}
                              >
                                Remove
                              </button>
                            )}
                        </li>
                      ))}
                    </ul>
                    {manageGroup ? (
                      <section className="pending-invitations">
                        <h3>Invited, not joined yet</h3>
                        {pendingInvitations.length === 0 ? (
                          <p className="hint">No pending invitations.</p>
                        ) : (
                          <ul className="group-roster">
                            {pendingInvitations.map((invitation) => (
                              <li key={invitation.invitationId}>
                                <span className="group-member-copy">
                                  <strong>{invitation.email}</strong>
                                  <span>
                                    Expires{" "}
                                    {new Date(
                                      invitation.expiresAt,
                                    ).toLocaleDateString()}
                                  </span>
                                </span>
                                <button
                                  className="row-action"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Revoke invitation for ${invitation.email}?`,
                                      )
                                    )
                                      return;
                                    void act(async () => {
                                      const draft = commandDraft(
                                        "revoke",
                                        invitation.invitationId,
                                      );
                                      await api.revoke(
                                        token(),
                                        invitation.invitationId,
                                        draft.key,
                                      );
                                      commandDrafts.current.delete("revoke");
                                      setGroupRevision((value) => value + 1);
                                      return "Invitation revoked.";
                                    });
                                  }}
                                >
                                  Revoke
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    ) : !currentMemberIsAdmin ? null : inviteReady ? (
                      <section className="invite-card">
                        <strong>Invite ready for {inviteReady.email}</strong>
                        <code>{inviteReady.token}</code>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              void navigator.clipboard.writeText(
                                inviteReady.token,
                              )
                            }
                          >
                            Copy code
                          </button>
                          {navigator.share && (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() =>
                                void navigator.share({
                                  text: `Join ${groupRoster.groupName} with code ${inviteReady.token}`,
                                })
                              }
                            >
                              Share…
                            </button>
                          )}
                        </div>
                        <p>
                          Send it privately. It works once and expires in 7
                          days.
                        </p>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => setInviteReady(null)}
                        >
                          Invite another friend
                        </button>
                      </section>
                    ) : (
                      <form
                        className="invite-form"
                        onSubmit={submit(async (form) => {
                          const inviteEmail = field(
                            form,
                            "inviteEmail",
                          ).toLowerCase();
                          const draft = commandDraft("invite", inviteEmail);
                          const result = await api.invite(
                            token(),
                            {
                              invitationId: draft.entityId,
                              email: inviteEmail,
                            },
                            draft.key,
                          );
                          commandDrafts.current.delete("invite");
                          setInviteReady({
                            email: inviteEmail,
                            token: result.data.token,
                          });
                          setGroupRevision((value) => value + 1);
                          return "Invitation created.";
                        })}
                      >
                        <h3>Invite a friend</h3>
                        <label>
                          Friend email
                          <input
                            name="inviteEmail"
                            type="email"
                            maxLength={254}
                            required
                            disabled={busy}
                          />
                        </label>
                        <button type="submit" disabled={busy}>
                          {busy ? "Creating invite…" : "Invite a friend"}
                        </button>
                      </form>
                    )}
                    {canLeaveGroup ? (
                      <button
                        className="text-button danger-text leave-group"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(`Leave ${groupRoster.groupName}?`)
                          )
                            return;
                          void act(
                            async () => {
                              const draft = commandDraft(
                                "leave",
                                membership.membershipId,
                              );
                              await api.leave(token(), draft.key);
                              commandDrafts.current.delete("leave");
                              return `You left ${groupRoster.groupName}.`;
                            },
                            { refreshMembership: true },
                          );
                        }}
                      >
                        Leave {groupRoster.groupName}
                      </button>
                    ) : (
                      <p className="hint">
                        Make another member an admin before you can leave.
                      </p>
                    )}
                  </>
                )}
              </section>
            )}
            <Result notice={notice} />
          </Page>
        ) : route === "/account" ? (
          <Page
            eyebrow="Account"
            title="You"
            lead="Your account and crew settings."
          >
            <div className="account-page">
              <section className="account-identity" aria-label="Your identity">
                <span className="account-initials" aria-hidden="true">
                  {(displayName || session?.user.email || "You")
                    .split(/\s+|@/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join("")}
                </span>
                <span>
                  <strong>{displayName || "Name not set"}</strong>
                  <small>{session?.user.email}</small>
                </span>
              </section>
              <form
                className="account-name-row"
                onSubmit={submit(async () => {
                  const name = displayName.trim();
                  if (!name || name.length > 40)
                    throw new WebAuthError(
                      "invalid",
                      "Name must be 1 to 40 characters.",
                    );
                  const draft = commandDraft("display-name", name);
                  const response = await api.setDisplayName(
                    token(),
                    name,
                    draft.key,
                  );
                  commandDrafts.current.delete("display-name");
                  setDisplayName(response.data.displayName ?? "");
                  return "Name saved.";
                })}
              >
                <label>
                  <span className="account-name-label">Name</span>
                  <input
                    name="displayName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    minLength={1}
                    maxLength={40}
                    required
                    disabled={busy || !displayNameLoaded}
                  />
                </label>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={busy || !displayNameLoaded}
                >
                  {busy ? "Saving…" : "Save name"}
                </button>
              </form>
              {groupLoad === "error" ? (
                <div className="account-load-error" role="alert">
                  <span>Couldn’t load your crew.</span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setGroupRevision((value) => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  <a
                    className="account-row"
                    href="/group"
                    onClick={(event) => navigate(event, "/group")}
                  >
                    <span>Crew</span>
                    <span>
                      {groupLoad === "ready"
                        ? groupRoster?.groupName
                        : "Loading…"}{" "}
                      →
                    </span>
                  </a>
                  <a
                    className="account-row"
                    href="/target"
                    onClick={(event) => navigate(event, "/target")}
                  >
                    <span>Weekly target</span>
                    <span>
                      {groupLoad === "ready"
                        ? `${groupRoster?.members.find((member) => member.membershipId === membership?.membershipId)?.weeklyTarget ?? "—"} a week`
                        : "Loading…"}{" "}
                      →
                    </span>
                  </a>
                </>
              )}
              <button
                className="account-row"
                type="button"
                onClick={() => setInstallHelpOpen(true)}
              >
                <span>Install on your home screen</span>
                <span>→</span>
              </button>
              <button
                className="secondary-button account-sign-out"
                type="button"
                onClick={() =>
                  void act(async () => "Signed out.", { cutoff: true })
                }
                disabled={busy}
              >
                {busy ? "Signing out…" : "Sign out"}
              </button>
              <button
                className="account-delete"
                type="button"
                onClick={() => setDeletionStep("review")}
              >
                Delete account…
              </button>
            </div>
            <Sheet
              open={installHelpOpen}
              title="Install on your home screen"
              onDismiss={() => setInstallHelpOpen(false)}
            >
              <div className="install-help">
                <p>
                  <strong>iPhone:</strong> In Safari, tap Share, then Add to
                  Home Screen.
                </p>
                <p>
                  <strong>Android:</strong> In Chrome, open menu, then tap
                  Install app.
                </p>
                <p>Installation is optional. Every flow works in browser.</p>
              </div>
            </Sheet>
            <Sheet
              dismissible={false}
              open={deletionStep !== "idle"}
              title="Delete account"
              onDismiss={() => undefined}
            >
              <div className="deletion-sheet">
                <div className="deletion-progress" aria-hidden="true">
                  {([1, 2, 3] as const).map((step) => (
                    <span
                      key={step}
                      className={`deletion-progress-segment${
                        step <=
                        (
                          deletionStep === "review"
                            ? 1
                            : deletionStep === "code-sent"
                              ? 2
                              : 3
                        )
                          ? " complete"
                          : ""
                      }`}
                    />
                  ))}
                </div>
                <p className="deletion-step">
                  Step{" "}
                  {deletionStep === "review"
                    ? 1
                    : deletionStep === "code-sent"
                      ? 2
                      : 3}{" "}
                  of 3
                </p>
                {deletionStep === "review" && (
                  <>
                    <h2 tabIndex={-1}>What deleting does</h2>
                    <ul>
                      <li>
                        You leave {groupRoster?.groupName ?? "your crew"} right
                        away.
                      </li>
                      <li>You can’t sign in again with this account.</li>
                      <li>
                        Your finished weeks stay in the crew’s history as
                        “Former member”.
                      </li>
                      <li>This can’t be undone.</li>
                    </ul>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const address = session?.user.email;
                          if (!address)
                            throw new WebAuthError(
                              "rejected",
                              "Verified Account email unavailable.",
                            );
                          await requestOtp(auth, address);
                          setDeletionStep("code-sent");
                          return "If this Account remains eligible, a fresh code was sent.";
                        })
                      }
                    >
                      {busy ? "Sending…" : "Email me a code"}
                    </button>
                  </>
                )}
                {deletionStep === "code-sent" && (
                  <form
                    onSubmit={submit(async () => {
                      normalizeOtp(deletionCode);
                      setDeletionStep("ready");
                      return "Code ready. Final confirmation will verify identity before deletion.";
                    })}
                  >
                    <h2>Enter the code we sent</h2>
                    <p>A fresh code went to {session?.user.email}.</p>
                    <fieldset className="otp-fields">
                      <legend>Fresh six-digit code</legend>
                      {codePositions.map((position, index) => (
                        <input
                          key={position}
                          ref={(element) => {
                            deletionCodeInputs.current[index] = element;
                          }}
                          aria-label={`Deletion code digit ${index + 1}`}
                          inputMode="numeric"
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          maxLength={1}
                          required
                          value={deletionCode[index] ?? ""}
                          disabled={busy}
                          onChange={(event) => {
                            const digit = event.target.value
                              .replace(/\D/g, "")
                              .slice(-1);
                            const digits = deletionCode.padEnd(6).split("");
                            digits[index] = digit;
                            setDeletionCode(digits.join("").trimEnd());
                            if (digit)
                              deletionCodeInputs.current[index + 1]?.focus();
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Backspace" &&
                              !deletionCode[index] &&
                              index > 0
                            )
                              deletionCodeInputs.current[index - 1]?.focus();
                          }}
                        />
                      ))}
                    </fieldset>
                    <button type="submit" className="danger" disabled={busy}>
                      {busy ? "Checking…" : "Continue"}
                    </button>
                  </form>
                )}
                {deletionStep === "ready" && (
                  <form
                    onSubmit={submit(
                      async (f) => {
                        if (field(f, "confirmation") !== "DELETE")
                          throw new WebAuthError(
                            "invalid",
                            "Type DELETE exactly.",
                          );
                        deletionKey.current ??= crypto.randomUUID();
                        const deletion = await api
                          .deleteAccount(
                            token(),
                            deletionKey.current,
                            deletionCode,
                          )
                          .catch((error: unknown) => {
                            if (
                              error instanceof ApiError &&
                              error.kind === "unauthorized"
                            )
                              throw error;
                            throw new WebAuthError(
                              "rejected",
                              "Deletion didn't go through. Your account is unchanged — try again.",
                            );
                          });
                        setDeletionCode("");
                        return "authDeletion" in deletion.data
                          ? "Account deletion accepted. Access ended; Auth removal pending."
                          : "Account deletion completed. Access ended immediately.";
                      },
                      { cutoff: true },
                    )}
                  >
                    <h2>Type DELETE to confirm</h2>
                    <label>
                      Confirmation
                      <input
                        name="confirmation"
                        autoComplete="off"
                        required
                        disabled={busy}
                      />
                    </label>
                    <button type="submit" className="danger" disabled={busy}>
                      {busy ? "Deleting…" : "Delete my account"}
                    </button>
                  </form>
                )}
                <button
                  className="keep-account"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDeletionStep("idle");
                    setDeletionCode("");
                    setNotice(null);
                  }}
                >
                  Keep my account
                </button>
                <Result notice={notice} />
              </div>
            </Sheet>
            {deletionStep === "idle" && <Result notice={notice} />}
          </Page>
        ) : (
          <Weekly
            key={route}
            route={route as "/home" | "/target" | "/history"}
            api={api}
            token={token()}
            membership={membership}
            onRevoked={() => {
              setSession(null);
              setMembership(null);
              setAccess("revoked");
            }}
          />
        )}
      </main>
      {access === "signed-in" && (
        <nav aria-label="Member destinations" className="member-nav">
          {memberRoutes.map(([destination, label]) => (
            <a
              aria-current={route === destination ? "page" : undefined}
              href={destination}
              key={destination}
              onClick={(e) => navigate(e, destination)}
            >
              <TabIcon route={destination} />
              <span>{label}</span>
            </a>
          ))}
          <span
            aria-hidden="true"
            className="tab-indicator"
            style={{
              transform: `translateX(${
                Math.max(
                  0,
                  memberRoutes.findIndex(
                    ([destination]) => destination === route,
                  ),
                ) * 100
              }%)`,
            }}
          />
        </nav>
      )}
    </div>
  );
}

function Page({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="hero">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {children}
    </section>
  );
}
