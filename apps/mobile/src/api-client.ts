import {
  apiErrorResponseSchema,
  type components,
  currentGroupMembershipResponseSchema,
  currentWeekProgressResponseSchema,
  deletedAccountResponseSchema,
  finalizedWeeklyHistoryResponseSchema,
  groupInvitationResponseSchema,
  groupMembershipResponseSchema,
  healthResponseSchema,
  memberHomeResponseSchema,
  notificationCenterResponseSchema,
  notificationOpenResponseSchema,
  revokedGroupInvitationResponseSchema,
  socialInteractionResponseSchema,
  submitWorkoutCheckinResponseSchema,
  weeklyTargetResponseSchema,
} from "@no-excuses/contracts";

type SchemaName = keyof components["schemas"];
type Schema<Name extends SchemaName> = components["schemas"][Name];

export type MobileApiClientErrorKind = "api" | "malformed_response" | "network";

export class MobileApiClientError extends Error {
  readonly kind: MobileApiClientErrorKind;
  readonly status?: number;
  readonly apiError?: Schema<"ApiError">;

  constructor(
    kind: MobileApiClientErrorKind,
    message: string,
    options: {
      status?: number;
      apiError?: Schema<"ApiError">;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MobileApiClientError";
    this.kind = kind;
    this.status = options.status;
    this.apiError = options.apiError;
  }
}

type Fetch = typeof fetch;
type ResponseSchema<Output> = Readonly<{
  safeParse(
    value: unknown,
  ): Readonly<{ success: true; data: Output }> | Readonly<{ success: false }>;
}>;

export type MobileApiClientOptions = Readonly<{
  baseUrl: string;
  fetch?: Fetch;
}>;

export function readMobileApiBaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const source = environment.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!source) throw new Error("EXPO_PUBLIC_API_BASE_URL is required");
  const url = new URL(source);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL must use public HTTPS or loopback HTTP",
    );
  }
  return url.toString().replace(/\/$/, "");
}

type Authorized = Readonly<{ authorization: string }>;
type Command = Authorized & Readonly<{ idempotencyKey: string }>;
type CommandWithBody<Body> = Command & Readonly<{ body: Body }>;

export type MobileApiClient = Readonly<{
  getV1Health(input: Authorized): Promise<Schema<"HealthResponse">>;
  deleteAccount(
    input: CommandWithBody<Schema<"DeleteAccountRequest">>,
  ): Promise<Schema<"DeletedAccountResponse">>;
  submitWorkoutCheckin(
    input: CommandWithBody<Schema<"SubmitWorkoutCheckinRequest">>,
  ): Promise<Schema<"SubmitWorkoutCheckinResponse">>;
  createGroup(
    input: CommandWithBody<Schema<"CreateGroupRequest">>,
  ): Promise<Schema<"GroupMembershipResponse">>;
  issueGroupInvitation(
    input: CommandWithBody<Schema<"IssueGroupInvitationRequest">>,
  ): Promise<Schema<"GroupInvitationResponse">>;
  revokeGroupInvitation(
    input: Command & Readonly<{ invitationId: string }>,
  ): Promise<Schema<"RevokedGroupInvitationResponse">>;
  acceptGroupInvitation(
    input: CommandWithBody<Schema<"AcceptGroupInvitationRequest">>,
  ): Promise<Schema<"GroupMembershipResponse">>;
  leaveGroup(input: Command): Promise<Schema<"GroupMembershipResponse">>;
  setWeeklyTarget(
    input: CommandWithBody<Schema<"SetWeeklyTargetRequest">>,
  ): Promise<Schema<"WeeklyTargetResponse">>;
  removeGroupMember(
    input: Command & Readonly<{ groupId: string; membershipId: string }>,
  ): Promise<Schema<"GroupMembershipResponse">>;
  getCurrentGroupMembership(
    input: Authorized,
  ): Promise<Schema<"CurrentGroupMembershipResponse">>;
  getMemberHome(input: Authorized): Promise<Schema<"MemberHomeResponse">>;
  getNotifications(
    input: Authorized,
  ): Promise<Schema<"NotificationCenterResponse">>;
  openNotification(
    input: Authorized & Readonly<{ notificationId: string }>,
  ): Promise<Schema<"NotificationOpenResponse">>;
  createSocialInteraction(
    input: CommandWithBody<Schema<"CreateSocialInteractionRequest">>,
  ): Promise<Schema<"SocialInteractionResponse">>;
  getCurrentWeekProgress(
    input: Authorized & Readonly<{ groupId: string }>,
  ): Promise<Schema<"CurrentWeekProgressResponse">>;
  getFinalizedWeeklyHistory(
    input: Authorized & Readonly<{ groupId: string }>,
  ): Promise<Schema<"FinalizedWeeklyHistoryResponse">>;
}>;

export function createMobileApiClient({
  baseUrl,
  fetch: fetchImplementation = globalThis.fetch,
}: MobileApiClientOptions): MobileApiClient {
  const apiBaseUrl = baseUrl.replace(/\/$/, "");

  async function request<Output>(
    path: string,
    authorization: string,
    responseSchema: ResponseSchema<Output>,
    command?: Readonly<{
      method: "DELETE" | "POST" | "PUT";
      idempotencyKey: string;
      body?: unknown;
    }>,
  ): Promise<Output> {
    let response: Response;
    try {
      response = await fetchImplementation(`${apiBaseUrl}${path}`, {
        method: command?.method ?? "GET",
        headers: {
          authorization,
          ...(command
            ? {
                "content-type": "application/json",
                "idempotency-key": command.idempotencyKey,
              }
            : {}),
        },
        body:
          command?.body === undefined
            ? undefined
            : JSON.stringify(command.body),
      });
    } catch (cause) {
      throw new MobileApiClientError("network", "API request failed", {
        cause,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new MobileApiClientError(
        "malformed_response",
        "API response was not valid JSON",
        { status: response.status, cause },
      );
    }

    if (response.status === 200) {
      const parsed = responseSchema.safeParse(body);
      if (parsed.success) return parsed.data;
      throw new MobileApiClientError(
        "malformed_response",
        "API success response did not match its contract",
        { status: response.status },
      );
    }

    const parsedError = apiErrorResponseSchema.safeParse(body);
    if (parsedError.success) {
      throw new MobileApiClientError("api", parsedError.data.error.message, {
        status: response.status,
        apiError: parsedError.data.error,
      });
    }
    throw new MobileApiClientError(
      "malformed_response",
      "API error response did not match its contract",
      { status: response.status },
    );
  }

  return {
    getV1Health: ({ authorization }) =>
      request<Schema<"HealthResponse">>(
        "/v1/health",
        authorization,
        healthResponseSchema as unknown as ResponseSchema<
          Schema<"HealthResponse">
        >,
      ),
    deleteAccount: ({ authorization, idempotencyKey, body }) =>
      request("/v1/account", authorization, deletedAccountResponseSchema, {
        method: "DELETE",
        idempotencyKey,
        body,
      }),
    submitWorkoutCheckin: ({ authorization, idempotencyKey, body }) =>
      request(
        "/v1/workout-check-ins",
        authorization,
        submitWorkoutCheckinResponseSchema,
        { method: "POST", idempotencyKey, body },
      ),
    createGroup: ({ authorization, idempotencyKey, body }) =>
      request("/v1/groups", authorization, groupMembershipResponseSchema, {
        method: "POST",
        idempotencyKey,
        body,
      }),
    issueGroupInvitation: ({ authorization, idempotencyKey, body }) =>
      request(
        "/v1/group-invitations",
        authorization,
        groupInvitationResponseSchema,
        { method: "POST", idempotencyKey, body },
      ),
    revokeGroupInvitation: ({ authorization, idempotencyKey, invitationId }) =>
      request(
        `/v1/group-invitations/${encodeURIComponent(invitationId)}/revoke`,
        authorization,
        revokedGroupInvitationResponseSchema,
        { method: "POST", idempotencyKey },
      ),
    acceptGroupInvitation: ({ authorization, idempotencyKey, body }) =>
      request(
        "/v1/group-invitations/accept",
        authorization,
        groupMembershipResponseSchema,
        { method: "POST", idempotencyKey, body },
      ),
    leaveGroup: ({ authorization, idempotencyKey }) =>
      request(
        "/v1/group-memberships/leave",
        authorization,
        groupMembershipResponseSchema,
        { method: "POST", idempotencyKey },
      ),
    setWeeklyTarget: ({ authorization, idempotencyKey, body }) =>
      request(
        "/v1/group-memberships/weekly-target",
        authorization,
        weeklyTargetResponseSchema,
        { method: "PUT", idempotencyKey, body },
      ),
    removeGroupMember: ({
      authorization,
      idempotencyKey,
      groupId,
      membershipId,
    }) =>
      request(
        `/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(membershipId)}/remove`,
        authorization,
        groupMembershipResponseSchema,
        { method: "POST", idempotencyKey },
      ),
    getCurrentGroupMembership: ({ authorization }) =>
      request(
        "/v1/group-memberships/current",
        authorization,
        currentGroupMembershipResponseSchema,
      ),
    getMemberHome: ({ authorization }) =>
      request("/v1/member-home", authorization, memberHomeResponseSchema),
    getNotifications: ({ authorization }) =>
      request(
        "/v1/notifications",
        authorization,
        notificationCenterResponseSchema,
      ),
    openNotification: ({ authorization, notificationId }) =>
      request(
        `/v1/notifications/${encodeURIComponent(notificationId)}/open`,
        authorization,
        notificationOpenResponseSchema,
      ),
    createSocialInteraction: ({ authorization, idempotencyKey, body }) =>
      request(
        "/v1/social-interactions",
        authorization,
        socialInteractionResponseSchema,
        { method: "POST", idempotencyKey, body },
      ),
    getCurrentWeekProgress: ({ authorization, groupId }) =>
      request(
        `/v1/groups/${encodeURIComponent(groupId)}/current-week-progress`,
        authorization,
        currentWeekProgressResponseSchema,
      ),
    getFinalizedWeeklyHistory: ({ authorization, groupId }) =>
      request(
        `/v1/groups/${encodeURIComponent(groupId)}/finalized-weekly-history`,
        authorization,
        finalizedWeeklyHistoryResponseSchema,
      ),
  };
}
