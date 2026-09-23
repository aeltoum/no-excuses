import type { Session, SupabaseClient } from "@supabase/supabase-js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class WebAuthError extends Error {
  constructor(
    readonly kind: "invalid" | "rejected" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "WebAuthError";
  }
}

const unavailable = (status?: number) => status === undefined || status >= 500;

export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !emailPattern.test(email))
    throw new WebAuthError("invalid", "Enter a valid email address.");
  return email;
}

export function normalizeOtp(value: string) {
  const code = value.trim();
  if (!/^\d{6}$/.test(code))
    throw new WebAuthError("invalid", "Enter the six-digit code.");
  return code;
}

export async function requestOtp(
  client: Pick<SupabaseClient, "auth">,
  emailValue: string,
) {
  const email = normalizeEmail(emailValue);
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error && unavailable(error.status))
      throw new WebAuthError(
        "unavailable",
        "Sign-in service unavailable. Try again.",
      );
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError(
      "unavailable",
      "Sign-in service unavailable. Try again.",
    );
  }
  return email;
}

export async function verifyOtp(
  client: Pick<SupabaseClient, "auth">,
  emailValue: string,
  codeValue: string,
) {
  const email = normalizeEmail(emailValue);
  const token = normalizeOtp(codeValue);
  try {
    const { data, error } = await client.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error || !data.session)
      throw new WebAuthError(
        error && unavailable(error.status) ? "unavailable" : "rejected",
        error && unavailable(error.status)
          ? "Sign-in service unavailable. Try again."
          : "That code didn't match. Check the latest email, or send a new code.",
      );
    return data.session;
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError(
      "unavailable",
      "Sign-in service unavailable. Try again.",
    );
  }
}

export async function resolveLiveAccess(
  client: Pick<SupabaseClient, "auth">,
  session: Session,
): Promise<"signed-in" | "revoked" | "unavailable"> {
  try {
    const { data, error } = await client.auth.getUser(session.access_token);
    if (!error && data.user) return "signed-in";
    return unavailable(error?.status) ? "unavailable" : "revoked";
  } catch {
    return "unavailable";
  }
}
