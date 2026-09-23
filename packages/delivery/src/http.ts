import type { ApiRequest, ApiResponse } from "./api.js";

type HttpHandler = (request: ApiRequest) => Promise<ApiResponse>;

export type V1HttpHandlers = Readonly<{
  deleteAccount: HttpHandler;
  getAccountDisplayName: HttpHandler;
  setAccountDisplayName: HttpHandler;
  submitWorkoutCheckin: HttpHandler;
  createGroup: HttpHandler;
  issueGroupInvitation: HttpHandler;
  revokeGroupInvitation: HttpHandler;
  acceptGroupInvitation: HttpHandler;
  previewGroupInvitation: HttpHandler;
  leaveGroup: HttpHandler;
  setWeeklyTarget: HttpHandler;
  removeGroupMember: HttpHandler;
  listGroupMembers: HttpHandler;
  listPendingGroupInvitations: HttpHandler;
  getCurrentGroupMembership: HttpHandler;
  getMemberHome: HttpHandler;
  getNotifications: HttpHandler;
  createSocialInteraction: HttpHandler;
  openNotification: HttpHandler;
  getCurrentWeekProgress: HttpHandler;
  getFinalizedWeeklyHistory: HttpHandler;
}>;

type Route = Readonly<{
  method: string;
  pattern: RegExp;
  parameters: readonly string[];
  handler: keyof V1HttpHandlers;
}>;

const routes: readonly Route[] = [
  {
    method: "GET",
    pattern: /^\/v1\/account\/display-name$/,
    parameters: [],
    handler: "getAccountDisplayName",
  },
  {
    method: "PUT",
    pattern: /^\/v1\/account\/display-name$/,
    parameters: [],
    handler: "setAccountDisplayName",
  },
  {
    method: "DELETE",
    pattern: /^\/v1\/account$/,
    parameters: [],
    handler: "deleteAccount",
  },
  {
    method: "GET",
    pattern: /^\/v1\/group-invitations\/preview$/,
    parameters: [],
    handler: "previewGroupInvitation",
  },
  {
    method: "POST",
    pattern: /^\/v1\/workout-check-ins$/,
    parameters: [],
    handler: "submitWorkoutCheckin",
  },
  {
    method: "POST",
    pattern: /^\/v1\/groups$/,
    parameters: [],
    handler: "createGroup",
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-invitations$/,
    parameters: [],
    handler: "issueGroupInvitation",
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-invitations\/([^/]+)\/revoke$/,
    parameters: ["invitationId"],
    handler: "revokeGroupInvitation",
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-invitations\/accept$/,
    parameters: [],
    handler: "acceptGroupInvitation",
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-memberships\/leave$/,
    parameters: [],
    handler: "leaveGroup",
  },
  {
    method: "PUT",
    pattern: /^\/v1\/group-memberships\/weekly-target$/,
    parameters: [],
    handler: "setWeeklyTarget",
  },
  {
    method: "GET",
    pattern: /^\/v1\/group-memberships\/current$/,
    parameters: [],
    handler: "getCurrentGroupMembership",
  },
  {
    method: "GET",
    pattern: /^\/v1\/member-home$/,
    parameters: [],
    handler: "getMemberHome",
  },
  {
    method: "GET",
    pattern: /^\/v1\/notifications$/,
    parameters: [],
    handler: "getNotifications",
  },
  {
    method: "GET",
    pattern: /^\/v1\/notifications\/([^/]+)\/open$/,
    parameters: ["notificationId"],
    handler: "openNotification",
  },
  {
    method: "POST",
    pattern: /^\/v1\/social-interactions$/,
    parameters: [],
    handler: "createSocialInteraction",
  },
  {
    method: "POST",
    pattern: /^\/v1\/groups\/([^/]+)\/members\/([^/]+)\/remove$/,
    parameters: ["groupId", "membershipId"],
    handler: "removeGroupMember",
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/members$/,
    parameters: ["groupId"],
    handler: "listGroupMembers",
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/pending-invitations$/,
    parameters: ["groupId"],
    handler: "listPendingGroupInvitations",
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/current-week-progress$/,
    parameters: ["groupId"],
    handler: "getCurrentWeekProgress",
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/finalized-weekly-history$/,
    parameters: ["groupId"],
    handler: "getFinalizedWeeklyHistory",
  },
];

const jsonHeaders = { "content-type": "application/json" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function routingError(status: number, code: string, message: string): Response {
  return json(status, {
    contractVersion: 1,
    error: { code, message, retryable: false },
  });
}

async function parseBody(request: Request): Promise<unknown> {
  const source = await request.text();
  return source.length === 0 ? {} : JSON.parse(source);
}

export function createV1HttpHandler(handlers: V1HttpHandlers) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/v1/health") {
      return request.method === "GET"
        ? json(200, { contractVersion: 1, status: "ok" })
        : routingError(405, "method_not_allowed", "Method not allowed");
    }

    const pathMatches = routes.flatMap((route) => {
      const match = route.pattern.exec(url.pathname);
      return match ? [{ route, match }] : [];
    });
    if (pathMatches.length === 0) {
      return routingError(404, "not_found", "Route not found");
    }

    const selected = pathMatches.find(
      ({ route }) => route.method === request.method,
    );
    if (!selected) {
      return routingError(405, "method_not_allowed", "Method not allowed");
    }

    let body: unknown;
    try {
      body = await parseBody(request);
    } catch {
      return routingError(400, "invalid_request", "Malformed JSON body");
    }

    let pathParameters: Record<string, string>;
    try {
      pathParameters = Object.fromEntries(
        selected.route.parameters.map((name, index) => [
          name,
          decodeURIComponent(selected.match[index + 1] ?? ""),
        ]),
      );
    } catch {
      return routingError(400, "invalid_request", "Malformed path parameter");
    }
    const queryParameters = Object.fromEntries(url.searchParams);
    const requestBody =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? body
        : { body };
    const apiResponse = await handlers[selected.route.handler]({
      authorization: request.headers.get("authorization") ?? undefined,
      headers: {
        "idempotency-key": request.headers.get("idempotency-key") ?? undefined,
      },
      body: { ...requestBody, ...queryParameters, ...pathParameters },
    });

    return json(apiResponse.status, apiResponse.body);
  };
}
