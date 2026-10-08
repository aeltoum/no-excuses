import { describe, expect, it, vi } from "vitest";
import {
  fetchAuth,
  normalizeEmail,
  normalizeOtp,
  requestOtp,
  resolveLiveAccess,
  verifyOtp,
} from "./auth";

describe("browser email OTP", () => {
  it("normalizes email and requires exactly six digits", () => {
    expect(normalizeEmail(" FRIEND@Example.Test ")).toBe("friend@example.test");
    expect(normalizeOtp(" 123456 ")).toBe("123456");
    expect(() => normalizeOtp("12345")).toThrow("six-digit");
    expect(() => normalizeEmail("unknown")).toThrow("valid email");
  });

  it("requests OTP without creating users and makes eligibility results identical", async () => {
    const signInWithOtp = vi.fn(async () => ({ error: { status: 400 } }));
    const client = { auth: { signInWithOtp } } as never;
    await expect(requestOtp(client, "unknown@example.test")).resolves.toBe(
      "unknown@example.test",
    );
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "unknown@example.test",
      options: { shouldCreateUser: false },
    });
  });

  it("returns verified session and never accepts a missing session", async () => {
    const session = { access_token: "access" };
    const verify = vi.fn(async () => ({ data: { session }, error: null }));
    await expect(
      verifyOtp(
        { auth: { verifyOtp: verify } } as never,
        "member@example.test",
        "123456",
      ),
    ).resolves.toBe(session);
    expect(verify).toHaveBeenCalledWith({
      email: "member@example.test",
      token: "123456",
      type: "email",
    });
  });

  it("distinguishes revoked access from unavailable live checks", async () => {
    const session = { access_token: "access" } as never;
    await expect(
      resolveLiveAccess(
        {
          auth: {
            getUser: vi.fn(async () => ({
              data: { user: null },
              error: { status: 401 },
            })),
          },
        } as never,
        session,
      ),
    ).resolves.toBe("revoked");
    await expect(
      resolveLiveAccess(
        {
          auth: {
            getUser: vi.fn(async () => {
              throw new Error("offline");
            }),
          },
        } as never,
        session,
      ),
    ).resolves.toBe("unavailable");
  });
});

describe("persistent session recovery", () => {
  it("refreshes bad_jwt once, then verifies live user", async () => {
    const refreshSession = vi.fn(async () => ({
      data: { session: { access_token: "fresh" } },
      error: null,
    }));
    const getUser = vi.fn(async (token: string) =>
      token === "fresh"
        ? { data: { user: { id: "member" } }, error: null }
        : { data: { user: null }, error: { status: 401, code: "bad_jwt" } },
    );
    await expect(
      resolveLiveAccess(
        { auth: { getUser, refreshSession } } as never,
        { access_token: "expired" } as never,
      ),
    ).resolves.toBe("signed-in");
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
  it("keeps rate limits recoverable and never refreshes revoked sessions", async () => {
    for (const [status, code, expected] of [
      [0, "network", "unavailable"],
      [429, "over_request_rate_limit", "unavailable"],
      [401, "session_not_found", "revoked"],
      [403, "user_banned", "revoked"],
    ] as const) {
      const refreshSession = vi.fn();
      const getUser = vi.fn(async () => ({
        data: { user: null },
        error: { status, code },
      }));
      await expect(
        resolveLiveAccess(
          { auth: { getUser, refreshSession } } as never,
          { access_token: "token" } as never,
        ),
      ).resolves.toBe(expected);
      expect(refreshSession).not.toHaveBeenCalled();
    }
  });
});

it("keeps refresh rate limits retryable without changing other HTTP responses", async () => {
  const response = new Response("{}", { status: 429 });
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  try {
    await expect(
      fetchAuth(
        "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
      ),
    ).rejects.toMatchObject({ name: "AuthRetryableFetchError" });
    await expect(
      fetchAuth("https://auth.example.test/auth/v1/user"),
    ).resolves.toBe(response);
  } finally {
    fetcher.mockRestore();
  }
});
