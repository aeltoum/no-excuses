import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api-client";

const uuid = "10000000-0000-4000-8000-000000000001";
const workout = {
  workoutCheckinId: uuid,
  activityType: "mixed" as const,
  completedAt: "2026-10-08T12:00:00.000Z",
  durationMinutes: 90,
  perceivedIntensity: "high" as const,
  selfReportAttested: true as const,
};
const workoutReceipt = {
  contractVersion: 1,
  data: { workoutCheckinId: uuid, currentWeekCount: 4 },
};
describe("browser API client", () => {
  it("submits a healthy workout once", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(workoutReceipt));
    await expect(
      createApiClient("https://api.example.test", fetcher).checkIn(
        "token",
        workout,
        uuid,
      ),
    ).resolves.toEqual(workoutReceipt);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("logs on first submission when the initial transport attempt fails", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        Response.json({
          contractVersion: 1,
          data: {
            workoutCheckinId: uuid,
            currentWeekCount: 4,
          },
        }),
      );
    await expect(
      createApiClient("https://api.example.test", fetcher).checkIn(
        "token",
        workout,
        uuid,
      ),
    ).resolves.toMatchObject({ data: { currentWeekCount: 4 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
  });
  it("replays an accepted workout after its response is lost without a second write", async () => {
    const receipts = new Map<string, unknown>();
    let writes = 0;
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const key = new Headers(init?.headers).get("idempotency-key") ?? "";
        if (!receipts.has(key)) {
          receipts.set(key, workoutReceipt);
          writes++;
          throw new TypeError("Response lost");
        }
        return Response.json(receipts.get(key));
      },
    );
    await expect(
      createApiClient(
        "https://api.example.test",
        fetcher as typeof fetch,
      ).checkIn("token", workout, uuid),
    ).resolves.toEqual(workoutReceipt);
    expect(writes).toBe(1);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
  });
  it("recovers one retryable service response on the same submission", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            contractVersion: 1,
            error: {
              code: "domain_failure",
              message: "private detail",
              retryable: true,
            },
          },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(Response.json(workoutReceipt));
    await expect(
      createApiClient("https://api.example.test", fetcher).checkIn(
        "token",
        workout,
        uuid,
      ),
    ).resolves.toEqual(workoutReceipt);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
  });
  it("stops after two transport failures and preserves the caller's draft for manual retry", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = createApiClient("https://api.example.test", fetcher);
    await expect(api.checkIn("token", workout, uuid)).rejects.toMatchObject({
      kind: "failure",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(Response.json(workoutReceipt));
    await expect(api.checkIn("token", workout, uuid)).resolves.toEqual(
      workoutReceipt,
    );
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[2]);
  });
  it.each([401, 403, 409, 500])(
    "does not replay terminal HTTP %s",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(
        Response.json(
          {
            contractVersion: 1,
            error: {
              code: "domain_failure",
              message: "private detail",
              retryable: false,
            },
          },
          { status },
        ),
      );
      await expect(
        createApiClient("https://api.example.test", fetcher).checkIn(
          "token",
          workout,
          uuid,
        ),
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("does not replay an invalid success response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ unexpected: true }));
    await expect(
      createApiClient("https://api.example.test", fetcher).checkIn(
        "token",
        workout,
        uuid,
      ),
    ).rejects.toMatchObject({ retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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

  it("uses current session token for commands and never sends a stale fallback on refresh failure", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ contractVersion: 1, data: { membershipId: uuid } }),
    );
    const getFreshToken = vi.fn(async () => "fresh-token");
    const api = createApiClient(
      "https://api.example.test",
      fetcher as typeof fetch,
      getFreshToken,
    );
    await api.leave("stale-token", uuid);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/group-memberships/leave",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer fresh-token",
          "idempotency-key": uuid,
        }),
      }),
    );
    getFreshToken.mockRejectedValueOnce(
      new ApiError("failure", "Service unavailable. Try again.", true),
    );
    await expect(api.leave("stale-token", uuid)).rejects.toMatchObject({
      kind: "failure",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
