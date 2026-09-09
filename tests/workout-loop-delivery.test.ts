import { describe, expect, it, vi } from "vitest";
import {
  type ApiRequest,
  handleCurrentWeekProgress,
  handleFinalizedWeeklyHistory,
  handleSubmitWorkoutCheckin,
} from "../packages/delivery/src/api.js";
import {
  failure,
  opaqueId,
  type RequestEnvelope,
  success,
} from "../packages/shared-kernel/src/index.js";

const actor = {
  actorId: opaqueId("actor", "018f63c2-7d33-7f54-9fa7-9f55d735ae36"),
  kind: "member" as const,
};
const groupId = "10000000-0000-4000-8000-000000000001";
const checkin = {
  workoutCheckinId: "70000000-0000-4000-8000-000000000003",
  activityType: "cardio" as const,
  completedAt: "2026-03-05T09:00:00.000Z",
  durationMinutes: 30,
  perceivedIntensity: "moderate" as const,
  selfReportAttested: true as const,
};
const request = (body: unknown, idempotency = true): ApiRequest => ({
  authorization: "Bearer local",
  body,
  headers: idempotency
    ? { "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35" }
    : {},
});
const statusFor = (code: string) =>
  ({
    unauthorized: 401,
    invalid_request: 400,
    idempotency_required: 400,
    denied: 403,
    idempotency_conflict: 409,
    domain_failure: 500,
  })[code] ?? 500;
const authenticate = async () => success(actor);

describe("workout-loop delivery entrypoints", () => {
  it("binds check-in auth, strict schema, scoped idempotency, replay, and conflict", async () => {
    const completed = new Map<string, { hash: string; count: number }>();
    let writes = 0;
    const hash = vi.fn(async (value: unknown) =>
      JSON.stringify(value).includes('"durationMinutes":30')
        ? "a".repeat(64)
        : "b".repeat(64),
    );
    const dependencies = {
      authenticate,
      createId: () => "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
      now: () => "2026-03-05T10:00:00.000Z",
      hash,
      execute: async (input: typeof checkin, context: RequestEnvelope) => {
        const previous = completed.get(context.idempotency.key);
        if (previous) {
          return previous.hash === context.idempotency.requestHash
            ? success({
                workoutCheckinId: input.workoutCheckinId,
                currentWeekCount: previous.count,
              })
            : failure("idempotency_conflict" as const, "Key reused");
        }
        writes += 1;
        completed.set(context.idempotency.key, {
          hash: context.idempotency.requestHash,
          count: writes,
        });
        return success({
          workoutCheckinId: input.workoutCheckinId,
          currentWeekCount: writes,
        });
      },
      statusFor,
    };

    const first = await handleSubmitWorkoutCheckin(
      request(checkin),
      dependencies,
    );
    expect(first).toMatchObject({ status: 200, body: { contractVersion: 1 } });
    expect(
      await handleSubmitWorkoutCheckin(request(checkin), dependencies),
    ).toEqual(first);
    expect(writes).toBe(1);
    expect(hash).toHaveBeenCalledWith({
      command: "submit_workout_checkin",
      body: checkin,
    });
    expect(
      await handleSubmitWorkoutCheckin(
        request({ ...checkin, durationMinutes: 31 }),
        dependencies,
      ),
    ).toMatchObject({
      status: 409,
      body: { contractVersion: 1, error: { code: "idempotency_conflict" } },
    });
    expect(writes).toBe(1);
    expect(
      await handleSubmitWorkoutCheckin(
        request({ ...checkin, extra: true }),
        dependencies,
      ),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(
      await handleSubmitWorkoutCheckin(
        { ...request(checkin), authorization: undefined },
        {
          ...dependencies,
          authenticate: async () => failure("unauthorized" as const, "Sign in"),
        },
      ),
    ).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    expect(
      await handleSubmitWorkoutCheckin(request(checkin, false), dependencies),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "idempotency_required" } },
    });
  });

  it("binds both Group reads without idempotency", async () => {
    const progress = [
      {
        membershipId: "40000000-0000-4000-8000-000000000001",
        lockedTarget: 3,
        completedWorkoutCount: 1,
      },
    ];
    const history = [
      {
        ...progress[0],
        startsAt: "2026-03-02T00:00:00.000Z",
        endsAt: "2026-03-09T00:00:00.000Z",
        outcome: "attained" as const,
      },
    ];
    const progressExecute = vi.fn(async () => success(progress));
    const historyExecute = vi.fn(async () => success(history));
    const readRequest = request({ groupId }, false);

    expect(
      await handleCurrentWeekProgress(readRequest, {
        authenticate,
        execute: progressExecute,
        statusFor,
      }),
    ).toEqual({ status: 200, body: { contractVersion: 1, data: progress } });
    expect(
      await handleFinalizedWeeklyHistory(readRequest, {
        authenticate,
        execute: historyExecute,
        statusFor,
      }),
    ).toEqual({ status: 200, body: { contractVersion: 1, data: history } });
    expect(progressExecute).toHaveBeenCalledWith({ groupId }, actor);
    expect(historyExecute).toHaveBeenCalledWith({ groupId }, actor);
  });

  it("returns bounded invalid, unauthenticated, and denied read envelopes", async () => {
    const execute = vi.fn(async () =>
      failure("denied" as const, "Not a member"),
    );
    const dependencies = { authenticate, execute, statusFor };

    expect(
      await handleCurrentWeekProgress(
        request({ groupId, extra: true }, false),
        dependencies,
      ),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(
      await handleCurrentWeekProgress(
        { ...request({ groupId }, false), authorization: undefined },
        {
          ...dependencies,
          authenticate: async () => failure("unauthorized" as const, "Sign in"),
        },
      ),
    ).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    expect(
      await handleFinalizedWeeklyHistory(
        request({ groupId }, false),
        dependencies,
      ),
    ).toMatchObject({
      status: 403,
      body: { contractVersion: 1, error: { code: "denied" } },
    });
  });
});
