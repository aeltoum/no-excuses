import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";

const uuid = "10000000-0000-4000-8000-000000000001";
describe("browser API client", () => {
  it("accepts durable pending Account deletion receipt", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contractVersion: 1,
            data: { accountId: uuid, authDeletion: "pending" },
          }),
          { status: 202 },
        ),
    );
    await expect(
      createApiClient(
        "https://api.example.test",
        fetcher as typeof fetch,
      ).deleteAccount("token", crypto.randomUUID(), "123456"),
    ).resolves.toMatchObject({
      data: { accountId: uuid, authDeletion: "pending" },
    });
  });

  it("validates versioned enrollment response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ contractVersion: 1, data: { message: "wrong" } }),
          { status: 200 },
        ),
    );
    await expect(
      createApiClient(
        "https://api.example.test",
        fetcher as typeof fetch,
      ).enroll("friend@example.test", "token"),
    ).rejects.toThrow("Enrollment unavailable");
  });
  it("sends bearer auth/idempotency and validates command response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ contractVersion: 1, data: { membershipId: uuid } }),
          { status: 200 },
        ),
    );
    await expect(
      createApiClient(
        "https://api.example.test/",
        fetcher as typeof fetch,
      ).create("live-token", {
        groupId: uuid,
        membershipId: uuid,
        name: "Friends",
        timeZone: "America/Chicago",
        weeklyTarget: 3,
      }),
    ).resolves.toMatchObject({ data: { membershipId: uuid } });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/groups",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer live-token",
          "idempotency-key": expect.any(String),
        }),
      }),
    );
  });

  it("maps denied/conflict without exposing server details", async () => {
    for (const [status, kind, message] of [
      [403, "denied", "Action denied."],
      [409, "conflict", "Action conflicts with current Group state."],
    ] as const) {
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              contractVersion: 1,
              error: {
                code: status === 403 ? "denied" : "idempotency_conflict",
                message: "private database detail",
                retryable: false,
              },
            }),
            { status },
          ),
      );
      await expect(
        createApiClient(
          "https://api.example.test",
          fetcher as typeof fetch,
        ).leave("token"),
      ).rejects.toMatchObject({ kind, message });
    }
  });
});
