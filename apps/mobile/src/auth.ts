import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";

const MAX_EMAIL_LENGTH = 254;
const OTP_PATTERN = /^\d{6}$/;

type MobileAuthClient = Pick<SupabaseClient, "auth">;
export type MobileAuthSession = Session;

export type MobileSessionState =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "signed-out" }>
  | Readonly<{ status: "signed-in"; session: Session }>
  | Readonly<{ status: "revoked" }>
  | Readonly<{ status: "service-unavailable" }>
  | Readonly<{ status: "failure" }>;

export type SessionAccess = "signed-in" | "revoked" | "service-unavailable";

export async function resolveMobileSessionAccess(
  client: MobileAuthClient,
  session: Session,
): Promise<SessionAccess> {
  try {
    const { data, error } = await client.auth.getUser(session.access_token);
    if (!error && data.user) return "signed-in";
    return error?.status === undefined || error.status >= 500
      ? "service-unavailable"
      : "revoked";
  } catch {
    return "service-unavailable";
  }
}

export class MobileAuthError extends Error {
  readonly kind: "invalid-input" | "rejected" | "service-unavailable";

  constructor(kind: MobileAuthError["kind"], message: string) {
    super(message);
    this.name = "MobileAuthError";
    this.kind = kind;
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length > MAX_EMAIL_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new MobileAuthError("invalid-input", "Enter a valid email address");
  }
  return normalized;
}

function validateOtp(token: string): string {
  const normalized = token.trim();
  if (!OTP_PATTERN.test(normalized)) {
    throw new MobileAuthError("invalid-input", "Enter the six-digit code");
  }
  return normalized;
}

function authFailure(error: Readonly<{ status?: number }>): MobileAuthError {
  const serviceUnavailable = error.status === undefined || error.status >= 500;
  return new MobileAuthError(
    serviceUnavailable ? "service-unavailable" : "rejected",
    serviceUnavailable
      ? "Authentication service unavailable"
      : "Authentication request rejected",
  );
}

export async function requestEmailOtp(
  client: MobileAuthClient,
  email: string,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  try {
    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false },
    });
    if (error) throw authFailure(error);
  } catch (error) {
    if (error instanceof MobileAuthError) throw error;
    throw new MobileAuthError(
      "service-unavailable",
      "Authentication service unavailable",
    );
  }
}

export async function verifyEmailOtp(
  client: MobileAuthClient,
  input: Readonly<{ email: string; token: string }>,
): Promise<Session> {
  const email = normalizeEmail(input.email);
  const token = validateOtp(input.token);
  try {
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) throw authFailure(error);
    if (!data.session) {
      throw new MobileAuthError(
        "rejected",
        "Authentication session unavailable",
      );
    }
    return data.session;
  } catch (error) {
    if (error instanceof MobileAuthError) throw error;
    throw new MobileAuthError(
      "service-unavailable",
      "Authentication service unavailable",
    );
  }
}

export function observeMobileSession(
  input: Readonly<{
    client: MobileAuthClient;
    resolveAccess: (session: Session) => Promise<SessionAccess>;
    onChange: (state: MobileSessionState) => void;
  }>,
): Readonly<{ ready: Promise<void>; stop(): void }> {
  let active = true;
  let revision = 0;

  const publish = (state: MobileSessionState, expectedRevision: number) => {
    if (active && revision === expectedRevision) input.onChange(state);
  };

  const resolve = async (session: Session | null, expectedRevision: number) => {
    if (!session) {
      publish({ status: "signed-out" }, expectedRevision);
      return;
    }
    try {
      const access = await input.resolveAccess(session);
      publish(
        access === "signed-in"
          ? { status: access, session }
          : { status: access },
        expectedRevision,
      );
    } catch {
      publish({ status: "failure" }, expectedRevision);
    }
  };

  const handleSession = (_event: AuthChangeEvent, session: Session | null) => {
    const expectedRevision = ++revision;
    void resolve(session, expectedRevision);
  };

  input.onChange({ status: "checking" });
  const { data: listener } = input.client.auth.onAuthStateChange(handleSession);
  const bootstrapRevision = ++revision;
  const ready = input.client.auth
    .getSession()
    .then(async ({ data, error }) => {
      if (error) {
        publish(
          {
            status:
              error.status === undefined || error.status >= 500
                ? "service-unavailable"
                : "failure",
          },
          bootstrapRevision,
        );
        return;
      }
      await resolve(data.session, bootstrapRevision);
    })
    .catch(() => {
      publish({ status: "service-unavailable" }, bootstrapRevision);
    });

  return {
    ready,
    stop() {
      active = false;
      listener.subscription.unsubscribe();
    },
  };
}
