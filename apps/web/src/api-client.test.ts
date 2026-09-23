import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";

const uuid = "10000000-0000-4000-8000-000000000001";
describe("browser API client", () => {
  it("reads only narrow invitation preview fields", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        contractVersion: 1,
        data: {
          groupName: "6AM Crew",
          memberCount: 5,
          weekEndsAt: "2026-09-28T05:00:00.000Z",
        },
      }),
    );
    await expect(
      createApiClient(
        "https://api.example.test",
        fetcher as typeof fetch,
      ).previewInvitation("token", "opaque code"),
    ).resolves.toMatchObject({
      data: { groupName: "6AM Crew", memberCount: 5 },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/group-invitations/preview?token=opaque%20code",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sets Account display name through own authenticated endpoint", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            contractVersion: 1,
            data: { displayName: "Akrum" },
          }),
          { status: 200 },
        ),
    );
    await expect(
      createApiClient(
        "https://api.example.test",
        fetcher as typeof fetch,
      ).setDisplayName("token", "Akrum", uuid),
    ).resolves.toMatchObject({ data: { displayName: "Akrum" } });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/account/display-name",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ displayName: "Akrum" }),
      }),
    );
  });

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
