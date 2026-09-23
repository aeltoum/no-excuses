import { describe, expect, it, vi } from "vitest";
import {
  createV1HttpHandler,
  type V1HttpHandlers,
} from "../packages/delivery/src/http.js";

const groupId = "10000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000002";
const invitationId = "50000000-0000-4000-8000-000000000001";

function setup(overrides: Partial<V1HttpHandlers> = {}) {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const operation = (name: string) => async (request: unknown) => {
    calls.push({ operation: name, request });
    return { status: 207, body: { operation: name } };
  };
  const handlers: V1HttpHandlers = {
    deleteAccount: operation("deleteAccount"),
    getAccountDisplayName: operation("getAccountDisplayName"),
    setAccountDisplayName: operation("setAccountDisplayName"),
    submitWorkoutCheckin: operation("submitWorkoutCheckin"),
    createGroup: operation("createGroup"),
    issueGroupInvitation: operation("issueGroupInvitation"),
    revokeGroupInvitation: operation("revokeGroupInvitation"),
    acceptGroupInvitation: operation("acceptGroupInvitation"),
    previewGroupInvitation: operation("previewGroupInvitation"),
    leaveGroup: operation("leaveGroup"),
    setWeeklyTarget: operation("setWeeklyTarget"),
    removeGroupMember: operation("removeGroupMember"),
    listGroupMembers: operation("listGroupMembers"),
    listPendingGroupInvitations: operation("listPendingGroupInvitations"),
    getCurrentGroupMembership: operation("getCurrentGroupMembership"),
    getMemberHome: operation("getMemberHome"),
    getNotifications: operation("getNotifications"),
    openNotification: operation("openNotification"),
    createSocialInteraction: operation("createSocialInteraction"),
    getCurrentWeekProgress: operation("getCurrentWeekProgress"),
    getFinalizedWeeklyHistory: operation("getFinalizedWeeklyHistory"),
    ...overrides,
  };
  return { calls, route: createV1HttpHandler(handlers) };
}

function request(method: string, path: string, body?: unknown) {
  return new Request(`http://local.test${path}`, {
    method,
    headers: {
      authorization: "Bearer local",
      "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("version 1 HTTP routing", () => {
  it("routes every OpenAPI operation by exact method and path", async () => {
    const { calls, route } = setup();
    const cases = [
      ["DELETE", "/v1/account", "deleteAccount"],
      ["GET", "/v1/account/display-name", "getAccountDisplayName"],
      ["PUT", "/v1/account/display-name", "setAccountDisplayName"],
      ["POST", "/v1/workout-check-ins", "submitWorkoutCheckin"],
      ["POST", "/v1/groups", "createGroup"],
      ["POST", "/v1/group-invitations", "issueGroupInvitation"],
      [
        "POST",
        `/v1/group-invitations/${invitationId}/revoke`,
        "revokeGroupInvitation",
      ],
      ["POST", "/v1/group-invitations/accept", "acceptGroupInvitation"],
      [
        "GET",
        "/v1/group-invitations/preview?token=opaque",
        "previewGroupInvitation",
      ],
      ["POST", "/v1/group-memberships/leave", "leaveGroup"],
      ["PUT", "/v1/group-memberships/weekly-target", "setWeeklyTarget"],
      ["GET", "/v1/group-memberships/current", "getCurrentGroupMembership"],
      ["GET", "/v1/member-home", "getMemberHome"],
      ["GET", "/v1/notifications", "getNotifications"],
      [
        "GET",
        "/v1/notifications/50000000-0000-4000-8000-000000000002/open",
        "openNotification",
      ],
      ["POST", "/v1/social-interactions", "createSocialInteraction"],
      [
        "POST",
        `/v1/groups/${groupId}/members/${membershipId}/remove`,
        "removeGroupMember",
      ],
      ["GET", `/v1/groups/${groupId}/members`, "listGroupMembers"],
      [
        "GET",
        `/v1/groups/${groupId}/pending-invitations`,
        "listPendingGroupInvitations",
      ],
      [
        "GET",
        `/v1/groups/${groupId}/current-week-progress`,
        "getCurrentWeekProgress",
      ],
      [
        "GET",
        `/v1/groups/${groupId}/finalized-weekly-history`,
        "getFinalizedWeeklyHistory",
      ],
    ] as const;

    for (const [method, path, expected] of cases) {
      const response = await route(
        request(
          method,
          path,
          method === "GET" ? undefined : { supplied: expected },
        ),
      );
      expect(response.status).toBe(207);
      expect(await response.json()).toEqual({ operation: expected });
    }
    expect(calls.map(({ operation }) => operation)).toEqual(
      cases.map(([, , operationName]) => operationName),
    );
  });

  it("merges body, query, and path inputs while forwarding contract headers", async () => {
    const { calls, route } = setup();
    await route(
      request(
        "POST",
        `/v1/groups/${groupId}/members/${membershipId}/remove?groupId=query&view=compact`,
        { groupId: "body", reason: "test" },
      ),
    );

    expect(calls[0]).toEqual({
      operation: "removeGroupMember",
      request: {
        authorization: "Bearer local",
        headers: {
          "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
        },
        body: {
          groupId,
          membershipId,
          reason: "test",
          view: "compact",
        },
      },
    });
  });

  it("supports reads and versioned health", async () => {
    const { calls, route } = setup();
    const read = await route(
      request("GET", `/v1/groups/${groupId}/current-week-progress`),
    );
    expect(read.status).toBe(207);
    expect(calls[0]).toMatchObject({
      operation: "getCurrentWeekProgress",
      request: { body: { groupId } },
    });

    const health = await route(request("GET", "/v1/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ contractVersion: 1, status: "ok" });
  });

  it("returns predictable JSON errors for malformed JSON, unknown routes, and wrong methods", async () => {
    const { route } = setup();
    const malformed = new Request("http://local.test/v1/groups", {
      method: "POST",
      body: "{",
    });
    const unknown = request("GET", "/v1/unknown");
    const wrongMethod = request("GET", "/v1/groups");
    const malformedPath = request(
      "POST",
      "/v1/group-invitations/%E0%A4%A/revoke",
    );

    for (const [response, status, code] of [
      [await route(malformed), 400, "invalid_request"],
      [await route(malformedPath), 400, "invalid_request"],
      [await route(unknown), 404, "not_found"],
      [await route(wrongMethod), 405, "method_not_allowed"],
    ] as const) {
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toMatchObject({
        contractVersion: 1,
        error: { code, retryable: false },
      });
    }
  });

  it("preserves handler status and body as JSON", async () => {
    const responseBody = { contractVersion: 1, error: { code: "denied" } };
    const handler = vi.fn(async () => ({ status: 403, body: responseBody }));
    const { route } = setup({ createGroup: handler });

    const response = await route(request("POST", "/v1/groups", {}));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(responseBody);
  });
});
