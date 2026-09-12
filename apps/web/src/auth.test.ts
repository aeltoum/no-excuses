import { describe, expect, it, vi } from "vitest";
import {
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
