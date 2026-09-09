import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  acceptGroupInvitationRequestSchema,
  apiErrorResponseSchema,
  createGroupRequestSchema,
  currentWeekProgressResponseSchema,
  finalizedWeeklyHistoryResponseSchema,
  groupInvitationResponseSchema,
  groupMembershipResponseSchema,
  groupRequestSchema,
  issueGroupInvitationRequestSchema,
  leaveGroupRequestSchema,
  removeGroupMemberRequestSchema,
  revokedGroupInvitationResponseSchema,
  revokeGroupInvitationRequestSchema,
  setWeeklyTargetRequestSchema,
  submitWorkoutCheckinRequestSchema,
  submitWorkoutCheckinResponseSchema,
  weeklyTargetResponseSchema,
} from "../packages/contracts/src/runtime.js";
import {
  handleV1ReadRequest,
  handleV1Request,
} from "../packages/delivery/src/api.js";
import {
  type ActorEnvelope,
  failure,
  opaqueId,
  type RequestEnvelope,
  type Result,
  success,
} from "../packages/shared-kernel/src/index.js";

const actor = {
  actorId: opaqueId("actor", "018f63c2-7d33-7f54-9fa7-9f55d735ae36"),
  kind: "member" as const,
};
const checkinId = "70000000-0000-4000-8000-000000000003";
const groupId = "10000000-0000-4000-8000-000000000001";
const membershipId = "40000000-0000-4000-8000-000000000001";
const commandBody = {
  workoutCheckinId: checkinId,
  activityType: "cardio",
  completedAt: "2026-03-05T09:00:00.000Z",
  durationMinutes: 30,
  perceivedIntensity: "moderate",
  selfReportAttested: true,
} as const;

function validation<Schema extends { safeParse(value: unknown): unknown }>(
  schema: Schema,
) {
  return (body: unknown) => {
    const result = schema.safeParse(body) as
      | { success: true; data: never }
      | { success: false };
    return result.success
      ? success(result.data)
      : failure("invalid_request" as const, "Invalid request");
  };
}

const statusFor = (code: string) =>
  ({
    unauthorized: 401,
    invalid_request: 400,
    idempotency_required: 400,
    denied: 403,
    idempotency_conflict: 409,
    domain_failure: 500,
  })[code] ?? 500;

function commandDependencies(
  execute: (
    input: typeof commandBody,
    context: RequestEnvelope,
  ) => Promise<
    Result<
      { workoutCheckinId: string; currentWeekCount: number },
      "denied" | "idempotency_conflict" | "domain_failure"
    >
  > = vi.fn(async () =>
    success({ workoutCheckinId: checkinId, currentWeekCount: 1 }),
  ),
  authenticate: () => Promise<
    Result<ActorEnvelope, "unauthorized">
  > = async () => success(actor),
) {
  return {
    authenticate,
    validate: validation(submitWorkoutCheckinRequestSchema),
    createId: () => "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
    now: () => "2026-03-05T10:00:00.000Z",
    hash: async (_body: unknown) => "a".repeat(64),
    execute,
    statusFor,
  };
}

function commandRequest(body: unknown = commandBody) {
  return {
    authorization: "Bearer local",
    body,
    headers: { "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35" },
  };
}

describe("True-MVP API runtime contracts", () => {
  it("publishes every authenticated Group command with idempotency", async () => {
    const source = await readFile(
      new URL("../packages/contracts/openapi.yaml", import.meta.url),
      "utf8",
    );
    for (const path of [
      "/v1/groups:",
      "/v1/group-invitations:",
      "/v1/group-invitations/{invitationId}/revoke:",
      "/v1/group-invitations/accept:",
      "/v1/group-memberships/leave:",
      "/v1/group-memberships/weekly-target:",
      "/v1/groups/{groupId}/members/{membershipId}/remove:",
    ]) {
      const start = source.indexOf(`  ${path}`);
      const end = source.indexOf("\n  /", start + 1);
      const operation = source.slice(start, end === -1 ? undefined : end);
      expect(start).toBeGreaterThan(-1);
      expect(operation).toContain("security:");
      expect(operation).toContain("#/components/parameters/IdempotencyKey");
      expect(operation).toContain('"409":');
    }
  });

  it("strictly validates every Group command request and bounded result", () => {
    expect(
      createGroupRequestSchema.parse({
        groupId,
        membershipId,
        name: "Friends",
        timeZone: "America/Chicago",
        weeklyTarget: 3,
      }),
    ).toBeTruthy();
    expect(
      issueGroupInvitationRequestSchema.parse({
        invitationId: checkinId,
        email: "friend@example.test",
      }),
    ).toBeTruthy();
    expect(
      acceptGroupInvitationRequestSchema.parse({
        token: "opaque-token",
        membershipId,
        recurringTarget: 3,
        currentTarget: 2,
      }),
    ).toBeTruthy();
    expect(
      revokeGroupInvitationRequestSchema.parse({ invitationId: checkinId }),
    ).toBeTruthy();
    expect(leaveGroupRequestSchema.parse({})).toEqual({});
    expect(
      removeGroupMemberRequestSchema.parse({ groupId, membershipId }),
    ).toBeTruthy();
    expect(setWeeklyTargetRequestSchema.parse({ weeklyTarget: 4 })).toEqual({
      weeklyTarget: 4,
    });
    expect(
      setWeeklyTargetRequestSchema.safeParse({ weeklyTarget: 0 }).success,
    ).toBe(false);
    expect(
      setWeeklyTargetRequestSchema.safeParse({
        weeklyTarget: 4,
        membershipId,
      }).success,
    ).toBe(false);
    expect(
      acceptGroupInvitationRequestSchema.safeParse({
        token: "opaque-token",
        membershipId,
        recurringTarget: 2,
        currentTarget: 3,
      }).success,
    ).toBe(false);
    expect(leaveGroupRequestSchema.safeParse({ membershipId }).success).toBe(
      false,
    );
    expect(
      groupMembershipResponseSchema.parse({
        contractVersion: 1,
        data: { membershipId },
      }),
    ).toBeTruthy();
    expect(
      groupInvitationResponseSchema.parse({
        contractVersion: 1,
        data: {
          invitationId: checkinId,
          token: "opaque-token",
          expiresAt: "2026-03-12T10:00:00.000Z",
        },
      }),
    ).toBeTruthy();
    expect(
      revokedGroupInvitationResponseSchema.parse({
        contractVersion: 1,
        data: { invitationId: checkinId, status: "revoked" },
      }),
    ).toBeTruthy();
    expect(
      weeklyTargetResponseSchema.parse({
        contractVersion: 1,
        data: { membershipId, weeklyTarget: 4 },
      }),
    ).toBeTruthy();
  });

  it("strictly validates structured check-ins", () => {
    expect(submitWorkoutCheckinRequestSchema.parse(commandBody)).toEqual(
      commandBody,
    );
    for (const malformed of [
      { ...commandBody, workoutCheckinId: "not-a-uuid" },
      { ...commandBody, activityType: "other" },
      { ...commandBody, completedAt: "2026-03-05T09:00:00+01:00" },
      { ...commandBody, durationMinutes: 0 },
      { ...commandBody, durationMinutes: 1.5 },
      { ...commandBody, perceivedIntensity: "extreme" },
      { ...commandBody, selfReportAttested: false },
      { ...commandBody, note: "extra" },
    ]) {
      expect(
        submitWorkoutCheckinRequestSchema.safeParse(malformed).success,
      ).toBe(false);
    }
    expect(groupRequestSchema.safeParse({ groupId, extra: true }).success).toBe(
      false,
    );
  });

  it("validates bounded success and error response shapes", () => {
    expect(
      submitWorkoutCheckinResponseSchema.parse({
        contractVersion: 1,
        data: { workoutCheckinId: checkinId, currentWeekCount: 1 },
      }),
    ).toBeTruthy();
    expect(
      currentWeekProgressResponseSchema.parse({
        contractVersion: 1,
        data: [{ membershipId, lockedTarget: 3, completedWorkoutCount: 1 }],
      }),
    ).toBeTruthy();
    expect(
      finalizedWeeklyHistoryResponseSchema.parse({
        contractVersion: 1,
        data: [
          {
            membershipId,
            startsAt: "2026-03-02T00:00:00.000Z",
            endsAt: "2026-03-09T00:00:00.000Z",
            lockedTarget: 2,
            completedWorkoutCount: 2,
            outcome: "attained",
          },
        ],
      }),
    ).toBeTruthy();
    expect(
      finalizedWeeklyHistoryResponseSchema.safeParse({
        contractVersion: 1,
        data: [{ outcome: "excepted" }],
      }).success,
    ).toBe(false);
    expect(
      apiErrorResponseSchema.parse({
        contractVersion: 1,
        error: { code: "denied", message: "Denied", retryable: false },
      }),
    ).toBeTruthy();
    expect(
      apiErrorResponseSchema.safeParse({
        contractVersion: 1,
        error: { code: "unknown", message: "Unknown", retryable: false },
      }).success,
    ).toBe(false);
  });
});

describe("True-MVP API delivery", () => {
  it("requires auth, valid input, and idempotency only for submission", async () => {
    const missingAuth = commandDependencies(undefined, async () =>
      failure("unauthorized" as const, "Sign in"),
    );
    expect(
      await handleV1Request(
        { ...commandRequest(), authorization: undefined },
        missingAuth,
      ),
    ).toMatchObject({ status: 401 });
    expect(
      await handleV1Request(
        commandRequest({ ...commandBody, extra: true }),
        commandDependencies(),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await handleV1Request(
        { ...commandRequest(), headers: {} },
        commandDependencies(),
      ),
    ).toMatchObject({
      status: 400,
      body: { contractVersion: 1, error: { code: "idempotency_required" } },
    });
    expect(
      await handleV1Request(
        {
          ...commandRequest(),
          headers: { "idempotency-key": "not-a-uuid" },
        },
        commandDependencies(),
      ),
    ).toEqual({
      status: 400,
      body: {
        contractVersion: 1,
        error: {
          code: "invalid_request",
          message: "Idempotency-Key must be a UUID",
          retryable: false,
        },
      },
    });
  });

  it("returns stable duplicate results and maps conflicts and domain failures", async () => {
    const stable = { workoutCheckinId: checkinId, currentWeekCount: 1 };
    const completed = new Map<
      string,
      { hash: string; result: typeof stable }
    >();
    let logicalWrites = 0;
    const contexts: RequestEnvelope[] = [];
    const execute = vi.fn(
      async (_input: typeof commandBody, context: RequestEnvelope) => {
        contexts.push(context);
        const key = context.idempotency.key;
        const previous = completed.get(key);
        if (previous) {
          return previous.hash === context.idempotency.requestHash
            ? success(previous.result)
            : failure(
                "idempotency_conflict" as const,
                "Key already used for another request",
              );
        }
        logicalWrites += 1;
        completed.set(key, {
          hash: context.idempotency.requestHash,
          result: stable,
        });
        return success(stable);
      },
    );
    const dependencies = commandDependencies(execute);
    dependencies.hash = async (body) =>
      (body as { durationMinutes?: number }).durationMinutes === 30
        ? "a".repeat(64)
        : "b".repeat(64);
    expect(await handleV1Request(commandRequest(), dependencies)).toEqual({
      status: 200,
      body: { contractVersion: 1, data: stable },
    });
    expect(await handleV1Request(commandRequest(), dependencies)).toEqual({
      status: 200,
      body: { contractVersion: 1, data: stable },
    });
    expect(
      await handleV1Request(
        commandRequest({ ...commandBody, durationMinutes: 31 }),
        dependencies,
      ),
    ).toMatchObject({
      status: 409,
      body: {
        contractVersion: 1,
        error: { code: "idempotency_conflict" },
      },
    });
    expect(logicalWrites).toBe(1);
    expect(contexts).toHaveLength(3);
    expect(contexts.map((context) => context.idempotency.key)).toEqual([
      "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
      "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
      "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
    ]);
    expect(contexts.map((context) => context.idempotency.requestHash)).toEqual([
      "a".repeat(64),
      "a".repeat(64),
      "b".repeat(64),
    ]);

    for (const [code, status] of [
      ["denied", 403],
      ["domain_failure", 500],
    ] as const) {
      const failed = commandDependencies(
        vi.fn(async () => failure(code, code, code === "domain_failure")),
      );
      expect(await handleV1Request(commandRequest(), failed)).toMatchObject({
        status,
        body: { contractVersion: 1, error: { code } },
      });
    }
  });

  it("executes authenticated queries without an idempotency header", async () => {
    const execute = vi.fn(async () =>
      success([{ membershipId, lockedTarget: 3, completedWorkoutCount: 1 }]),
    );
    const response = await handleV1ReadRequest(
      { authorization: "Bearer local", body: { groupId }, headers: {} },
      {
        authenticate: async () => success(actor),
        validate: validation(groupRequestSchema),
        execute,
        statusFor,
      },
    );
    expect(response).toEqual({
      status: 200,
      body: {
        contractVersion: 1,
        data: [{ membershipId, lockedTarget: 3, completedWorkoutCount: 1 }],
      },
    });
    expect(execute).toHaveBeenCalledWith({ groupId }, actor);

    const history = [
      {
        membershipId,
        startsAt: "2026-03-02T00:00:00.000Z",
        endsAt: "2026-03-09T00:00:00.000Z",
        lockedTarget: 2,
        completedWorkoutCount: 2,
        outcome: "attained" as const,
      },
    ];
    expect(
      await handleV1ReadRequest(
        { authorization: "Bearer local", body: { groupId }, headers: {} },
        {
          authenticate: async () => success(actor),
          validate: validation(groupRequestSchema),
          execute: async () => success(history),
          statusFor,
        },
      ),
    ).toEqual({
      status: 200,
      body: { contractVersion: 1, data: history },
    });
  });

  it("rejects unauthenticated or denied reads without calling unauthorized work", async () => {
    const execute = vi.fn();
    expect(
      await handleV1ReadRequest(
        { authorization: undefined, body: { groupId }, headers: {} },
        {
          authenticate: async () => failure("unauthorized" as const, "Sign in"),
          validate: validation(groupRequestSchema),
          execute,
          statusFor,
        },
      ),
    ).toMatchObject({ status: 401 });
    expect(execute).not.toHaveBeenCalled();

    expect(
      await handleV1ReadRequest(
        { authorization: "Bearer local", body: { groupId }, headers: {} },
        {
          authenticate: async () => success(actor),
          validate: validation(groupRequestSchema),
          execute: async () => failure("denied" as const, "Not a member"),
          statusFor,
        },
      ),
    ).toMatchObject({ status: 403 });
  });
});
