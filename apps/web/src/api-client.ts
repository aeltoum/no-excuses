import {
  apiErrorResponseSchema,
  currentGroupMembershipResponseSchema,
  deletedAccountResponseSchema,
  groupInvitationResponseSchema,
  groupMembershipResponseSchema,
  revokedGroupInvitationResponseSchema,
} from "@no-excuses/contracts";

type Parser<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};
type Membership = { contractVersion: 1; data: { membershipId: string } };

export class ApiError extends Error {
  constructor(
    readonly kind: "denied" | "conflict" | "unauthorized" | "failure",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function requireAccountDeletionMatch(expected: string, actual: string) {
  if (actual !== expected)
    throw new ApiError(
      "failure",
      "Deletion confirmation did not match this Account.",
    );
}

export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const root = baseUrl.replace(/\/$/, "");
  async function request<T>(
    path: string,
    token: string,
    parser: Parser<T>,
    command?: { method: "POST" | "DELETE"; body?: unknown; key: string },
  ) {
    let response: Response;
    try {
      response = await fetcher(`${root}${path}`, {
        method: command?.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(command
            ? {
                "content-type": "application/json",
                "idempotency-key": command.key,
              }
            : {}),
        },
        body:
          command?.body === undefined
            ? undefined
            : JSON.stringify(command.body),
      });
    } catch {
      throw new ApiError("failure", "Service unavailable. Try again.", true);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("failure", "Service returned an invalid response.");
    }
    if (response.ok) {
      const parsed = parser.safeParse(body);
      if (parsed.success) return parsed.data;
      throw new ApiError("failure", "Service returned an invalid response.");
    }
    const error = apiErrorResponseSchema.safeParse(body);
    if (!error.success)
      throw new ApiError("failure", "Service returned an invalid response.");
    const kind =
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "denied"
          : response.status === 409
            ? "conflict"
            : "failure";
    throw new ApiError(
      kind,
      kind === "denied"
        ? "Action denied."
        : kind === "conflict"
          ? "Action conflicts with current Group state."
          : kind === "unauthorized"
            ? "Access ended. Sign in again."
            : "Action failed. Try again.",
      error.data.error.retryable,
    );
  }
  const command = <T>(
    path: string,
    token: string,
    parser: Parser<T>,
    body?: unknown,
    method: "POST" | "DELETE" = "POST",
    key: string = crypto.randomUUID(),
  ) => request(path, token, parser, { method, body, key });
  return {
    current: (token: string) =>
      request(
        "/v1/group-memberships/current",
        token,
        currentGroupMembershipResponseSchema,
      ),
    create: (
      token: string,
      body: {
        groupId: string;
        membershipId: string;
        name: string;
        timeZone: string;
        weeklyTarget: number;
      },
      key?: string,
    ) =>
      command<Membership>(
        "/v1/groups",
        token,
        groupMembershipResponseSchema,
        body,
        "POST",
        key,
      ),
    join: (
      token: string,
      body: {
        token: string;
        membershipId: string;
        recurringTarget: number;
        currentTarget: number;
      },
      key?: string,
    ) =>
      command<Membership>(
        "/v1/group-invitations/accept",
        token,
        groupMembershipResponseSchema,
        body,
        "POST",
        key,
      ),
    invite: (
      token: string,
      body: { invitationId: string; email: string },
      key?: string,
    ) =>
      command(
        "/v1/group-invitations",
        token,
        groupInvitationResponseSchema,
        body,
        "POST",
        key,
      ),
    revoke: (token: string, invitationId: string, key?: string) =>
      command(
        `/v1/group-invitations/${encodeURIComponent(invitationId)}/revoke`,
        token,
        revokedGroupInvitationResponseSchema,
        undefined,
        "POST",
        key,
      ),
    leave: (token: string, key?: string) =>
      command<Membership>(
        "/v1/group-memberships/leave",
        token,
        groupMembershipResponseSchema,
        undefined,
        "POST",
        key,
      ),
    remove: (
      token: string,
      groupId: string,
      membershipId: string,
      key?: string,
    ) =>
      command<Membership>(
        `/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(membershipId)}/remove`,
        token,
        groupMembershipResponseSchema,
        undefined,
        "POST",
        key,
      ),
    deleteAccount: (token: string, key: string) =>
      command(
        "/v1/account",
        token,
        deletedAccountResponseSchema,
        { confirmation: true },
        "DELETE",
        key,
      ),
  };
}
