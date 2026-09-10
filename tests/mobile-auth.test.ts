import { describe, expect, it, vi } from "vitest";

import {
  MobileAuthError,
  type MobileAuthSession,
  observeMobileSession,
  requestEmailOtp,
  resolveMobileSessionAccess,
  type SessionAccess,
  verifyEmailOtp,
} from "../apps/mobile/src/auth.js";
import {
  createSecureSessionStorage,
  MobileSupabaseConfigError,
  mobileSupabaseAuthOptions,
  readMobileSupabaseConfig,
} from "../apps/mobile/src/supabase.js";

const session = {
  access_token: "private-access-token",
  refresh_token: "private-refresh-token",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "10000000-0000-4000-8000-000000000001" },
} as MobileAuthSession;

function legacyKey(role: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.signature`;
}

function authClient(auth: Record<string, unknown>) {
  return { auth } as never;
}

describe("mobile Supabase configuration", () => {
  it("requires public URL and anonymous key", () => {
    expect(() => readMobileSupabaseConfig({})).toThrow(
      MobileSupabaseConfigError,
    );
    expect(() =>
      readMobileSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: "file:///private/config",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "public-key",
      }),
    ).toThrow("public HTTP(S)");
  });

  it.each(["sb_secret_do-not-bundle", legacyKey("service_role")])(
    "rejects privileged key %s",
    (key) => {
      expect(() =>
        readMobileSupabaseConfig({
          EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
          EXPO_PUBLIC_SUPABASE_ANON_KEY: key,
        }),
      ).toThrow("Privileged Supabase keys are forbidden");
    },
  );

  it("accepts and normalizes local public configuration", () => {
    expect(
      readMobileSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: legacyKey("anon"),
      }),
    ).toEqual({
      url: "http://127.0.0.1:54321",
      anonymousKey: legacyKey("anon"),
    });
  });
});

describe("secure session persistence", () => {
  it("delegates every storage operation to SecureStore", async () => {
    const secureStore = {
      getItemAsync: vi.fn(async () => "stored-session"),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const storage = createSecureSessionStorage(secureStore);

    await expect(storage.getItem("auth-key")).resolves.toBe("stored-session");
    await storage.setItem("auth-key", "new-session");
    await storage.removeItem("auth-key");

    expect(secureStore.getItemAsync).toHaveBeenCalledWith("auth-key");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "auth-key",
      "new-session",
    );
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith("auth-key");
  });

  it("creates React Native-safe persistent auth options", () => {
    const storage = createSecureSessionStorage({
      getItemAsync: vi.fn(async () => null),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    });
    expect(mobileSupabaseAuthOptions(storage)).toEqual({
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
  });
});

describe("email OTP", () => {
  it("normalizes email and keeps unknown users invitation-gated", async () => {
    const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));

    await requestEmailOtp(
      authClient({ signInWithOtp }),
      " MEMBER@Example.test ",
    );

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "member@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("rejects oversized email and malformed OTP before network calls", async () => {
    const signInWithOtp = vi.fn();
    const verifyOtp = vi.fn();
    const client = authClient({ signInWithOtp, verifyOtp });

    await expect(
      requestEmailOtp(client, `${"x".repeat(250)}@x.test`),
    ).rejects.toBeInstanceOf(MobileAuthError);
    await expect(
      verifyEmailOtp(client, {
        email: "member@example.test",
        token: "1234567",
      }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies bounded email OTP and returns authenticated session", async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { session, user: session.user },
      error: null,
    }));
    const client = authClient({ verifyOtp });

    await expect(
      verifyEmailOtp(client, {
        email: " Member@example.test ",
        token: " 123456 ",
      }),
    ).resolves.toBe(session);
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "member@example.test",
      token: "123456",
      type: "email",
    });
  });

  it("returns sanitized rejected and unavailable failures", async () => {
    const rejected = authClient({
      signInWithOtp: vi.fn(async () => ({ data: {}, error: { status: 400 } })),
    });
    const unavailable = authClient({
      signInWithOtp: vi.fn(async () => ({ data: {}, error: { status: 503 } })),
    });

    await expect(
      requestEmailOtp(rejected, "member@example.test"),
    ).rejects.toMatchObject({
      kind: "rejected",
      message: "Authentication request rejected",
    });
    await expect(
      requestEmailOtp(unavailable, "member@example.test"),
    ).rejects.toMatchObject({
      kind: "service-unavailable",
      message: "Authentication service unavailable",
    });
  });

  it("sanitizes thrown transport failures", async () => {
    const client = authClient({
      signInWithOtp: vi.fn(async () => {
        throw new Error("request contained private credential");
      }),
    });

    await expect(
      requestEmailOtp(client, "member@example.test"),
    ).rejects.toMatchObject({
      kind: "service-unavailable",
      message: "Authentication service unavailable",
    });
  });
});

describe("session observer", () => {
  function observerClient(initial: {
    session: MobileAuthSession | null;
    error?: { status?: number } | null;
  }) {
    let listener:
      | ((event: "SIGNED_IN", session: MobileAuthSession | null) => void)
      | undefined;
    const unsubscribe = vi.fn();
    return {
      client: authClient({
        getSession: vi.fn(async () => ({
          data: { session: initial.session },
          error: initial.error ?? null,
        })),
        onAuthStateChange: vi.fn((callback) => {
          listener = callback;
          return { data: { subscription: { unsubscribe } } };
        }),
      }),
      emit(nextSession: MobileAuthSession | null) {
        listener?.("SIGNED_IN", nextSession);
      },
      unsubscribe,
    };
  }

  it.each([
    ["signed-in", "signed-in"],
    ["revoked", "revoked"],
    ["service-unavailable", "service-unavailable"],
  ] as const)("restores %s access", async (access, expected) => {
    const fake = observerClient({ session });
    const states: string[] = [];
    const observer = observeMobileSession({
      client: fake.client,
      resolveAccess: vi.fn(async () => access),
      onChange: (state) => states.push(state.status),
    });

    await observer.ready;
    expect(states).toEqual(["checking", expected]);
    observer.stop();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it("restores signed-out and follows later auth changes", async () => {
    const fake = observerClient({ session: null });
    const states: string[] = [];
    const observer = observeMobileSession({
      client: fake.client,
      resolveAccess: vi.fn(async (): Promise<SessionAccess> => "signed-in"),
      onChange: (state) => states.push(state.status),
    });

    await observer.ready;
    fake.emit(session);
    await vi.waitFor(() =>
      expect(states).toEqual(["checking", "signed-out", "signed-in"]),
    );
    observer.stop();
  });

  it("does not let stale restore overwrite a newer auth change", async () => {
    let finishRestore:
      | ((result: {
          data: { session: MobileAuthSession | null };
          error: null;
        }) => void)
      | undefined;
    let listener:
      | ((event: "SIGNED_IN", session: MobileAuthSession | null) => void)
      | undefined;
    const restore = new Promise<{
      data: { session: MobileAuthSession | null };
      error: null;
    }>((resolve) => {
      finishRestore = resolve;
    });
    const states: string[] = [];
    const observer = observeMobileSession({
      client: authClient({
        getSession: vi.fn(() => restore),
        onAuthStateChange: vi.fn((callback) => {
          listener = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
      }),
      resolveAccess: vi.fn(async (): Promise<SessionAccess> => "signed-in"),
      onChange: (state) => states.push(state.status),
    });

    listener?.("SIGNED_IN", session);
    await vi.waitFor(() => expect(states).toEqual(["checking", "signed-in"]));
    finishRestore?.({ data: { session: null }, error: null });
    await observer.ready;

    expect(states).toEqual(["checking", "signed-in"]);
    observer.stop();
  });

  it.each([
    [{ status: 503 }, "service-unavailable"],
    [{ status: 401 }, "failure"],
  ] as const)("maps restore error to %s", async (error, expected) => {
    const fake = observerClient({ session: null, error });
    const states: string[] = [];
    const observer = observeMobileSession({
      client: fake.client,
      resolveAccess: vi.fn(async (): Promise<SessionAccess> => "signed-in"),
      onChange: (state) => states.push(state.status),
    });

    await observer.ready;
    expect(states).toEqual(["checking", expected]);
    observer.stop();
  });

  it("maps access-check failure without exposing error or session", async () => {
    const fake = observerClient({ session });
    const states: unknown[] = [];
    const observer = observeMobileSession({
      client: fake.client,
      resolveAccess: vi.fn(async () => {
        throw new Error("private-access-token");
      }),
      onChange: (state) => states.push(state),
    });

    await observer.ready;
    expect(states).toEqual([{ status: "checking" }, { status: "failure" }]);
    expect(JSON.stringify(states)).not.toContain("private-access-token");
    observer.stop();
  });
});

describe("session access", () => {
  it.each([
    [{ data: { user: session.user }, error: null }, "signed-in"],
    [{ data: { user: null }, error: { status: 401 } }, "revoked"],
    [{ data: { user: null }, error: { status: 503 } }, "service-unavailable"],
  ] as const)(
    "maps live user lookup to %s access",
    async (result, expected) => {
      const getUser = vi.fn(async () => result);
      await expect(
        resolveMobileSessionAccess(authClient({ getUser }), session),
      ).resolves.toBe(expected);
      expect(getUser).toHaveBeenCalledWith(session.access_token);
    },
  );

  it("treats transport failure as service unavailable", async () => {
    await expect(
      resolveMobileSessionAccess(
        authClient({
          getUser: vi.fn(async () => {
            throw new Error("private credential");
          }),
        }),
        session,
      ),
    ).resolves.toBe("service-unavailable");
  });
});
