import { z } from "zod";

export const healthResponseSchema = z
  .object({
    contractVersion: z.union([z.literal(0), z.literal(1)]),
    status: z.literal("ok"),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

const uuidSchema = z.uuid();
const utcInstantSchema = z.iso.datetime({ offset: false });
const positiveIntegerSchema = z.number().int().positive();

export const workoutActivityTypeSchema = z.enum([
  "strength",
  "cardio",
  "class",
  "sport",
  "mixed",
]);
export const perceivedIntensitySchema = z.enum(["low", "moderate", "high"]);
export const weeklyOutcomeSchema = z.enum(["attained", "missed"]);
export const apiErrorCodeSchema = z.enum([
  "unauthorized",
  "invalid_request",
  "denied",
  "idempotency_required",
  "idempotency_conflict",
  "domain_failure",
]);

export const submitWorkoutCheckinRequestSchema = z
  .object({
    workoutCheckinId: uuidSchema,
    activityType: workoutActivityTypeSchema,
    completedAt: utcInstantSchema,
    durationMinutes: positiveIntegerSchema,
    perceivedIntensity: perceivedIntensitySchema,
    selfReportAttested: z.literal(true),
  })
  .strict();

export const groupRequestSchema = z.object({ groupId: uuidSchema }).strict();

export const workoutCheckinResultSchema = z
  .object({
    workoutCheckinId: uuidSchema,
    currentWeekCount: positiveIntegerSchema,
  })
  .strict();

export const currentWeekProgressItemSchema = z
  .object({
    membershipId: uuidSchema,
    lockedTarget: positiveIntegerSchema,
    completedWorkoutCount: z.number().int().nonnegative(),
  })
  .strict();

export const finalizedWeeklyHistoryItemSchema = z
  .object({
    membershipId: uuidSchema,
    startsAt: utcInstantSchema,
    endsAt: utcInstantSchema,
    lockedTarget: positiveIntegerSchema,
    completedWorkoutCount: z.number().int().nonnegative(),
    outcome: weeklyOutcomeSchema,
  })
  .strict();

const errorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict();

export const apiErrorResponseSchema = z
  .object({ contractVersion: z.literal(1), error: errorSchema })
  .strict();

export const submitWorkoutCheckinResponseSchema = z
  .object({ contractVersion: z.literal(1), data: workoutCheckinResultSchema })
  .strict();

export const currentWeekProgressResponseSchema = z
  .object({
    contractVersion: z.literal(1),
    data: z.array(currentWeekProgressItemSchema),
  })
  .strict();

export const finalizedWeeklyHistoryResponseSchema = z
  .object({
    contractVersion: z.literal(1),
    data: z.array(finalizedWeeklyHistoryItemSchema),
  })
  .strict();

export type SubmitWorkoutCheckinRequest = z.infer<
  typeof submitWorkoutCheckinRequestSchema
>;
export type GroupRequest = z.infer<typeof groupRequestSchema>;
export type WorkoutCheckinResult = z.infer<typeof workoutCheckinResultSchema>;
export type CurrentWeekProgressItem = z.infer<
  typeof currentWeekProgressItemSchema
>;
export type FinalizedWeeklyHistoryItem = z.infer<
  typeof finalizedWeeklyHistoryItemSchema
>;
