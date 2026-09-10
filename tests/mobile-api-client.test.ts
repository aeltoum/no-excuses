import { describe, expect, it, vi } from "vitest";
import {
  createMobileApiClient,
  MobileApiClientError,
  readMobileApiBaseUrl,
} from "../apps/mobile/src/api-client.js";

const authorization = "Bearer caller-token";
const idempotencyKey = "018f63c2-7d33-7f54-9fa7-9f55d735ae35";
const groupId = "10000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000002";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mobile API client", () => {
  it("reads only a public HTTPS or loopback HTTP mobile API base URL", () => {
    expect(
      readMobileApiBaseUrl({
        EXPO_PUBLIC_API_BASE_URL: " http://127.0.0.1:54321/functions/v1/ ",
      }),
    ).toBe("http://127.0.0.1:54321/functions/v1");
    expect(() => readMobileApiBaseUrl({})).toThrow(
      "EXPO_PUBLIC_API_BASE_URL is required",
    );
    expect(() =>
      readMobileApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: "file:///private" }),
    ).toThrow(
      "EXPO_PUBLIC_API_BASE_URL must use public HTTPS or loopback HTTP",
    );
    expect(() =>
      readMobileApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: "http://example.com" }),
    ).toThrow(
      "EXPO_PUBLIC_API_BASE_URL must use public HTTPS or loopback HTTP",
    );
    expect(() =>
      readMobileApiBaseUrl({
        EXPO_PUBLIC_API_BASE_URL: "https://user:secret@example.com",
      }),
    ).toThrow(
      "EXPO_PUBLIC_API_BASE_URL must use public HTTPS or loopback HTTP",
    );
    expect(
      readMobileApiBaseUrl({
        EXPO_PUBLIC_API_BASE_URL: "https://api.example.test/root/",
      }),
    ).toBe("https://api.example.test/root");
  });

  it("exposes a typed method for every version 1 operation", () => {
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn(),
    });

    expect(Object.keys(client).sort()).toEqual(
      [
        "getV1Health",
        "deleteAccount",
        "submitWorkoutCheckin",
        "createGroup",
        "issueGroupInvitation",
        "revokeGroupInvitation",
        "acceptGroupInvitation",
        "leaveGroup",
        "setWeeklyTarget",
        "removeGroupMember",
        "getCurrentGroupMembership",
        "getCurrentWeekProgress",
        "getFinalizedWeeklyHistory",
      ].sort(),
    );
  });

  it("sends command authorization, JSON, caller idempotency, and body", async () => {
    const fetch = vi.fn(async () =>
      response({ contractVersion: 1, data: { membershipId } }),
    );
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test/",
      fetch,
    });
    const body = {
      groupId,
      membershipId,
      name: "Morning crew",
      timeZone: "America/Chicago",
      weeklyTarget: 3,
    };

    await expect(
      client.createGroup({ authorization, idempotencyKey, body }),
    ).resolves.toEqual({ contractVersion: 1, data: { membershipId } });
    expect(fetch).toHaveBeenCalledWith("https://api.example.test/v1/groups", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  });

  it("sends read authorization without idempotency or JSON headers", async () => {
    const fetch = vi.fn(async () => response({ contractVersion: 1, data: [] }));
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch,
    });

    await client.getCurrentWeekProgress({ authorization, groupId });

    expect(fetch).toHaveBeenCalledWith(
      `https://api.example.test/v1/groups/${groupId}/current-week-progress`,
      {
        method: "GET",
        headers: { authorization },
        body: undefined,
      },
    );
  });

  it("reads explicit current and empty Group membership results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          contractVersion: 1,
          data: { membership: { groupId, membershipId } },
        }),
      )
      .mockResolvedValueOnce(
        response({ contractVersion: 1, data: { membership: null } }),
      );
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch,
    });

    await expect(
      client.getCurrentGroupMembership({ authorization }),
    ).resolves.toEqual({
      contractVersion: 1,
      data: { membership: { groupId, membershipId } },
    });
    await expect(
      client.getCurrentGroupMembership({ authorization }),
    ).resolves.toEqual({ contractVersion: 1, data: { membership: null } });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/group-memberships/current",
      {
        method: "GET",
        headers: { authorization },
        body: undefined,
      },
    );
  });

  it("rejects malformed current membership responses", async () => {
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn(async () =>
        response({ contractVersion: 1, data: { membership: { groupId } } }),
      ),
    });

    await expect(
      client.getCurrentGroupMembership({ authorization }),
    ).rejects.toMatchObject({
      name: "MobileApiClientError",
      kind: "malformed_response",
      status: 200,
    });
  });

  it("URL-encodes caller-supplied path authority", async () => {
    const fetch = vi.fn(async () =>
      response({ contractVersion: 1, data: { membershipId } }),
    );
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch,
    });

    await client.removeGroupMember({
      authorization,
      idempotencyKey,
      groupId: "group/with space",
      membershipId: "member?admin=true",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/groups/group%2Fwith%20space/members/member%3Fadmin%3Dtrue/remove",
      expect.anything(),
    );
  });

  it("preserves valid versioned API errors as typed errors", async () => {
    const fetch = vi.fn(async () =>
      response(
        {
          contractVersion: 1,
          error: {
            code: "denied",
            message: "Group admin required",
            retryable: false,
          },
        },
        403,
      ),
    );
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch,
    });

    const error = await client
      .leaveGroup({ authorization, idempotencyKey })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(MobileApiClientError);
    expect(error).toMatchObject({
      kind: "api",
      status: 403,
      apiError: {
        code: "denied",
        message: "Group admin required",
        retryable: false,
      },
    });
  });

  it.each([
    ["non-JSON", new Response("not JSON", { status: 502 })],
    [
      "wrong success envelope",
      response({ contractVersion: 1, data: { unexpected: true } }),
    ],
    [
      "wrong error envelope",
      response({ contractVersion: 1, error: { code: "unknown" } }, 500),
    ],
  ])(
    "turns %s responses into typed malformed-response errors",
    async (_, reply) => {
      const client = createMobileApiClient({
        baseUrl: "https://api.example.test",
        fetch: vi.fn(async () => reply),
      });

      await expect(
        client.getCurrentWeekProgress({ authorization, groupId }),
      ).rejects.toMatchObject({
        name: "MobileApiClientError",
        kind: "malformed_response",
        status: reply.status,
      });
    },
  );

  it("turns fetch failures into typed network errors with their cause", async () => {
    const cause = new TypeError("offline");
    const client = createMobileApiClient({
      baseUrl: "https://api.example.test",
      fetch: vi.fn(async () => {
        throw cause;
      }),
    });

    const error = await client
      .getV1Health({ authorization })
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(MobileApiClientError);
    expect(error).toMatchObject({ kind: "network", cause });
  });
});
