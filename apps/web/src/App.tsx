import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  createApiClient,
  requireAccountDeletionMatch,
} from "./api-client";
import { requestOtp, resolveLiveAccess, verifyOtp, WebAuthError } from "./auth";
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
const memberRoutes: Array<[Route, string]> = [
  ["/home", "Home"],
  ["/group", "Group"],
  ["/target", "Target"],
  ["/history", "History"],
  ["/account", "Account"],
];
const currentPath = () => window.location.pathname.replace(/\/+$/, "") || "/";

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
  const [path, setPath] = useState(currentPath);
  const [access, setAccess] = useState<Access>("checking");
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<{
    groupId: string;
    membershipId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [inviteId, setInviteId] = useState("");
  const [deletionStep, setDeletionStep] = useState<
    "idle" | "review" | "code-sent" | "ready"
  >("idle");
  const [deletionCode, setDeletionCode] = useState("");
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
        await auth.auth.signOut({ scope: "local" });
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
  const number = (form: FormData, name: string) =>
    Number.parseInt(field(form, name), 10);
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

  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="wordmark" href="/" onClick={(e) => navigate(e, "/")}>
          No Excuses
        </a>
        <span className="status">
          <span aria-hidden="true" /> Private PWA
        </span>
      </header>
      <main id="main-content">
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
            <form
              onSubmit={submit(async () => {
                const normalized = await requestOtp(auth, email);
                setEmail(normalized);
                setCodeSent(true);
                return "If this account is eligible, a code was sent.";
              })}
            >
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
              <button type="submit" disabled={busy}>
                {busy
                  ? "Sending…"
                  : codeSent
                    ? "Send another code"
                    : "Send code"}
              </button>
            </form>
            {codeSent && (
              <form
                onSubmit={submit(
                  async () => {
                    await verifyOtp(auth, email, code);
                    return "Code accepted. Confirming live access.";
                  },
                  { clearCode: true },
                )}
              >
                <label htmlFor="code">Six-digit code</label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={busy}
                />
                <button type="submit" disabled={busy}>
                  {busy ? "Checking…" : "Verify code"}
                </button>
              </form>
            )}
            <Result notice={notice} />
          </Page>
        ) : route === "/group" ? (
          <Page
            eyebrow="Private membership"
            title="Your Group"
            lead={
              membership
                ? `Active membership ${membership.membershipId}.`
                : "Create a private Group or join with an invitation token."
            }
          >
            {!membership && (
              <div className="form-grid">
                <form
                  onSubmit={submit(
                    async (f) => {
                      const name = field(f, "name");
                      const weeklyTarget = number(f, "weeklyTarget");
                      const draft = commandDraft(
                        "create",
                        `${name}:${weeklyTarget}`,
                      );
                      await api.create(
                        token(),
                        {
                          groupId: draft.entityId,
                          membershipId: draft.key,
                          name,
                          timeZone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                          weeklyTarget,
                        },
                        draft.key,
                      );
                      commandDrafts.current.delete("create");
                      return "Group created.";
                    },
                    { refreshMembership: true },
                  )}
                >
                  <h2>Create Group</h2>
                  <label>
                    Group name
                    <input
                      name="name"
                      maxLength={80}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Weekly target
                    <input
                      name="weeklyTarget"
                      type="number"
                      min="1"
                      required
                      disabled={busy}
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? "Creating…" : "Create Group"}
                  </button>
                </form>
                <form
                  onSubmit={submit(
                    async (f) => {
                      const invitationToken = field(f, "invitationToken");
                      const recurringTarget = number(f, "recurringTarget");
                      const currentTarget = number(f, "currentTarget");
                      const draft = commandDraft(
                        "join",
                        `${invitationToken}:${recurringTarget}:${currentTarget}`,
                      );
                      await api.join(
                        token(),
                        {
                          token: invitationToken,
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
                  <h2>Join Group</h2>
                  <label>
                    Invitation token
                    <input
                      name="invitationToken"
                      maxLength={256}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Weekly target
                    <input
                      name="recurringTarget"
                      type="number"
                      min="1"
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Current target
                    <input
                      name="currentTarget"
                      type="number"
                      min="1"
                      required
                      disabled={busy}
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? "Joining…" : "Join Group"}
                  </button>
                </form>
              </div>
            )}
            {membership && (
              <div className="form-grid">
                <form
                  onSubmit={submit(async (f) => {
                    const inviteEmail = field(f, "inviteEmail").toLowerCase();
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
                    setInviteId(result.data.invitationId);
                    return `Invitation created. Share this token securely: ${result.data.token}`;
                  })}
                >
                  <h2>Invite friend</h2>
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
                    {busy ? "Creating…" : "Create invitation"}
                  </button>
                </form>
                <form
                  onSubmit={submit(async (f) => {
                    const id = field(f, "invitationId");
                    const draft = commandDraft("revoke", id);
                    await api.revoke(token(), id, draft.key);
                    commandDrafts.current.delete("revoke");
                    return "Invitation revoked.";
                  })}
                >
                  <h2>Revoke invitation</h2>
                  <label>
                    Invitation ID
                    <input
                      name="invitationId"
                      value={inviteId}
                      onChange={(e) => setInviteId(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? "Revoking…" : "Revoke invitation"}
                  </button>
                </form>
                <form
                  onSubmit={submit(async (f) => {
                    const id = field(f, "membershipId");
                    const draft = commandDraft("remove", id);
                    await api.remove(
                      token(),
                      membership.groupId,
                      id,
                      draft.key,
                    );
                    commandDrafts.current.delete("remove");
                    return "Member removed. Access ended immediately.";
                  })}
                >
                  <h2>Remove member</h2>
                  <label>
                    Membership ID
                    <input name="membershipId" required disabled={busy} />
                  </label>
                  <button type="submit" className="danger" disabled={busy}>
                    {busy ? "Removing…" : "Remove member"}
                  </button>
                </form>
                <form
                  onSubmit={submit(
                    async () => {
                      const draft = commandDraft(
                        "leave",
                        membership.membershipId,
                      );
                      await api.leave(token(), draft.key);
                      commandDrafts.current.delete("leave");
                      return "You left the Group. Access ended immediately.";
                    },
                    { refreshMembership: true },
                  )}
                >
                  <h2>Leave Group</h2>
                  <p>Leaving ends current Group access.</p>
                  <button type="submit" className="danger" disabled={busy}>
                    {busy ? "Leaving…" : "Leave Group"}
                  </button>
                </form>
              </div>
            )}
            <Result notice={notice} />
          </Page>
        ) : route === "/account" ? (
          <Page
            eyebrow="Account access"
            title="Your Account"
            lead="Sign out here or permanently delete this Account."
          >
            <button
              type="button"
              onClick={() =>
                void act(async () => "Signed out.", { cutoff: true })
              }
              disabled={busy}
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
            <section className="danger-zone" aria-labelledby="delete-title">
              <h2 id="delete-title">Delete Account</h2>
              {deletionStep === "idle" ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => setDeletionStep("review")}
                >
                  Review Account deletion
                </button>
              ) : (
                <>
                  <p>
                    <strong>Permanent effects:</strong> current Group access
                    ends immediately; Account becomes unusable; included Account
                    data enters deletion processing. This cannot be undone.
                  </p>
                  {deletionStep === "review" && (
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
                      {busy ? "Sending…" : "Send fresh verification code"}
                    </button>
                  )}
                  {deletionStep === "code-sent" && (
                    <form
                      onSubmit={submit(async () => {
                        const address = session?.user.email;
                        if (!address)
                          throw new WebAuthError(
                            "rejected",
                            "Verified Account email unavailable.",
                          );
                        await verifyOtp(auth, address, deletionCode);
                        setDeletionCode("");
                        setDeletionStep("ready");
                        return "Identity reverified. Review effects, then confirm deletion.";
                      })}
                    >
                      <label>
                        Fresh six-digit code
                        <input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          required
                          value={deletionCode}
                          onChange={(event) =>
                            setDeletionCode(
                              event.target.value.replace(/\D/g, "").slice(0, 6),
                            )
                          }
                          disabled={busy}
                        />
                      </label>
                      <button type="submit" className="danger" disabled={busy}>
                        {busy ? "Checking…" : "Reverify identity"}
                      </button>
                    </form>
                  )}
                  {deletionStep === "ready" && (
                    <form
                      onSubmit={submit(
                        async (f) => {
                          if (field(f, "confirmation") !== "DELETE MY ACCOUNT")
                            throw new WebAuthError(
                              "invalid",
                              "Type DELETE MY ACCOUNT exactly.",
                            );
                          deletionKey.current ??= crypto.randomUUID();
                          const result = await api.deleteAccount(
                            token(),
                            deletionKey.current,
                          );
                          requireAccountDeletionMatch(
                            session?.user.id ?? "",
                            result.data.accountId,
                          );
                          return "Account deletion completed. Access ended immediately.";
                        },
                        { cutoff: true },
                      )}
                    >
                      <h2>Delete Account</h2>
                      <label>
                        Type DELETE MY ACCOUNT
                        <input
                          name="confirmation"
                          autoComplete="off"
                          required
                          disabled={busy}
                        />
                      </label>
                      <button type="submit" className="danger" disabled={busy}>
                        {busy ? "Deleting…" : "Confirm Account deletion"}
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
            <Result notice={notice} />
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
        <nav aria-label="Member destinations">
          {memberRoutes.map(([destination, label]) => (
            <a
              aria-current={route === destination ? "page" : undefined}
              href={destination}
              key={destination}
              onClick={(e) => navigate(e, destination)}
            >
              {label}
            </a>
          ))}
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
