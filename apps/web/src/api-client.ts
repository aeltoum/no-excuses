import {
  apiErrorResponseSchema,
  consentResponseSchema,
  currentGroupMembershipResponseSchema,
  currentWeekProgressResponseSchema,
  deletedAccountResponseSchema,
  enrollmentResponseSchema,
  finalizedWeeklyHistoryResponseSchema,
  groupInvitationResponseSchema,
  groupMembershipResponseSchema,
  pendingAccountDeletionResponseSchema,
  revokedGroupInvitationResponseSchema,
  submitWorkoutCheckinResponseSchema,
  weeklyTargetResponseSchema,
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

export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  const root = baseUrl.replace(/\/$/, "");
  async function request<T>(
    path: string,
    token: string,
    parser: Parser<T>,
    command?: {
      method: "POST" | "DELETE" | "PUT";
      body?: unknown;
      key: string;
    },
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
    method: "POST" | "DELETE" | "PUT" = "POST",
    key: string = crypto.randomUUID(),
  ) => request(path, token, parser, { method, body, key });
  return {
    enroll: async (email: string, token: string) => {
      let response: Response;
      try {
        response = await fetcher(`${root}/v1/enrollment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, token }),
        });
      } catch {
        throw new ApiError(
          "failure",
          "Enrollment service unavailable. Try again.",
          true,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ApiError("failure", "Service returned an invalid response.");
      }
      if (!response.ok || !enrollmentResponseSchema.safeParse(body).success)
        throw new ApiError(
          "failure",
          "Enrollment unavailable. Try again.",
          response.status >= 500,
        );
    },
    consent: (token: string) =>
      request("/v1/consent", token, consentResponseSchema, {
        method: "POST",
        body: { adult: true, pilot: true, product: true },
        key: crypto.randomUUID(),
      }),
    progress: (token: string, groupId: string) =>
      request(
        `/v1/groups/${encodeURIComponent(groupId)}/current-week-progress`,
        token,
        currentWeekProgressResponseSchema,
      ),
    history: (token: string, groupId: string) =>
      request(
        `/v1/groups/${encodeURIComponent(groupId)}/finalized-weekly-history`,
        token,
        finalizedWeeklyHistoryResponseSchema,
      ),
    setTarget: (token: string, weeklyTarget: number, key: string) =>
      command(
        "/v1/group-memberships/weekly-target",
        token,
        weeklyTargetResponseSchema,
        { weeklyTarget },
        "PUT",
        key,
      ),
    checkIn: (
      token: string,
      body: {
        workoutCheckinId: string;
        activityType: "strength" | "cardio" | "class" | "sport" | "mixed";
        completedAt: string;
        durationMinutes: number;
        perceivedIntensity: "low" | "moderate" | "high";
        selfReportAttested: true;
      },
      key: string,
    ) =>
      command(
        "/v1/workout-check-ins",
        token,
        submitWorkoutCheckinResponseSchema,
        body,
        "POST",
        key,
      ),
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
    deleteAccount: (token: string, key: string, otpCode: string) =>
      command(
        "/v1/account",
        token,
        deletedAccountResponseSchema.or(pendingAccountDeletionResponseSchema),
        { confirmation: true, otpCode },
        "DELETE",
        key,
      ),
  };
}
