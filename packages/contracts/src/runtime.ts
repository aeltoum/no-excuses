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
const boundedTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

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

export const createGroupRequestSchema = z
  .object({
    groupId: uuidSchema,
    membershipId: uuidSchema,
    name: boundedTextSchema(80),
    timeZone: boundedTextSchema(64),
    weeklyTarget: positiveIntegerSchema,
  })
  .strict();

export const issueGroupInvitationRequestSchema = z
  .object({ invitationId: uuidSchema, email: z.email().max(254) })
  .strict();

export const revokeGroupInvitationRequestSchema = z
  .object({ invitationId: uuidSchema })
  .strict();

export const acceptGroupInvitationRequestSchema = z
  .object({
    token: boundedTextSchema(256),
    membershipId: uuidSchema,
    recurringTarget: positiveIntegerSchema,
    currentTarget: positiveIntegerSchema,
  })
  .strict()
  .refine((value) => value.currentTarget <= value.recurringTarget);

export const leaveGroupRequestSchema = z.object({}).strict();
export const currentGroupMembershipRequestSchema = z.object({}).strict();

export const removeGroupMemberRequestSchema = z
  .object({ groupId: uuidSchema, membershipId: uuidSchema })
  .strict();

export const setWeeklyTargetRequestSchema = z
  .object({ weeklyTarget: positiveIntegerSchema })
  .strict();

export const deleteAccountRequestSchema = z
  .object({ confirmation: z.literal(true) })
  .strict();

export const groupMembershipResultSchema = z
  .object({ membershipId: uuidSchema })
  .strict();

export const currentGroupMembershipResultSchema = z
  .object({
    membership: z
      .object({ groupId: uuidSchema, membershipId: uuidSchema })
      .strict()
      .nullable(),
  })
  .strict();

export const memberHomeWeekStatusSchema = z.enum([
  "active",
  "provisional",
  "attained",
  "missed",
  "excepted",
  "ended_without_result",
]);

export const memberHomeResultSchema = z
  .object({
    membershipId: uuidSchema,
    groupId: uuidSchema,
    accountabilityWeekId: uuidSchema.nullable(),
    weekStatus: memberHomeWeekStatusSchema.nullable(),
    lockedTarget: positiveIntegerSchema.nullable(),
    completedWorkoutCount: z.number().int().nonnegative(),
    needsYouCount: z.number().int().nonnegative(),
    friendActivity: z.array(
      z
        .object({
          membershipId: uuidSchema,
          lockedTarget: positiveIntegerSchema.nullable(),
          completedWorkoutCount: z.number().int().nonnegative(),
          weekStatus: memberHomeWeekStatusSchema.nullable(),
        })
        .strict(),
    ),
    seasonStandings: z.array(
      z
        .object({
          membershipId: uuidSchema,
          crowns: z.number().int().nonnegative(),
          rank: positiveIntegerSchema,
          cochampion: z.boolean(),
        })
        .strict(),
    ),
    rebuiltAt: utcInstantSchema,
  })
  .strict();

export const groupInvitationResultSchema = z
  .object({
    invitationId: uuidSchema,
    token: boundedTextSchema(256),
    expiresAt: utcInstantSchema,
  })
  .strict();

export const revokedGroupInvitationResultSchema = z
  .object({ invitationId: uuidSchema, status: z.literal("revoked") })
  .strict();

export const weeklyTargetResultSchema = z
  .object({ membershipId: uuidSchema, weeklyTarget: positiveIntegerSchema })
  .strict();

export const deletedAccountResultSchema = z
  .object({ accountId: uuidSchema })
  .strict();

const commandResponse = <Schema extends z.ZodType>(schema: Schema) =>
  z.object({ contractVersion: z.literal(1), data: schema }).strict();

export const groupMembershipResponseSchema = commandResponse(
  groupMembershipResultSchema,
);
export const currentGroupMembershipResponseSchema = commandResponse(
  currentGroupMembershipResultSchema,
);
export const memberHomeResponseSchema = commandResponse(memberHomeResultSchema);
export const groupInvitationResponseSchema = commandResponse(
  groupInvitationResultSchema,
);
export const revokedGroupInvitationResponseSchema = commandResponse(
  revokedGroupInvitationResultSchema,
);
export const weeklyTargetResponseSchema = commandResponse(
  weeklyTargetResultSchema,
);
export const deletedAccountResponseSchema = commandResponse(
  deletedAccountResultSchema,
);

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
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;
export type IssueGroupInvitationRequest = z.infer<
  typeof issueGroupInvitationRequestSchema
>;
export type RevokeGroupInvitationRequest = z.infer<
  typeof revokeGroupInvitationRequestSchema
>;
export type AcceptGroupInvitationRequest = z.infer<
  typeof acceptGroupInvitationRequestSchema
>;
export type LeaveGroupRequest = z.infer<typeof leaveGroupRequestSchema>;
export type CurrentGroupMembershipRequest = z.infer<
  typeof currentGroupMembershipRequestSchema
>;
export type RemoveGroupMemberRequest = z.infer<
  typeof removeGroupMemberRequestSchema
>;
export type SetWeeklyTargetRequest = z.infer<
  typeof setWeeklyTargetRequestSchema
>;
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type GroupMembershipResult = z.infer<typeof groupMembershipResultSchema>;
export type CurrentGroupMembershipResult = z.infer<
  typeof currentGroupMembershipResultSchema
>;
export type MemberHomeResult = z.infer<typeof memberHomeResultSchema>;
export type GroupInvitationResult = z.infer<typeof groupInvitationResultSchema>;
export type RevokedGroupInvitationResult = z.infer<
  typeof revokedGroupInvitationResultSchema
>;
export type WeeklyTargetResult = z.infer<typeof weeklyTargetResultSchema>;
export type DeletedAccountResult = z.infer<typeof deletedAccountResultSchema>;
export type WorkoutCheckinResult = z.infer<typeof workoutCheckinResultSchema>;
export type CurrentWeekProgressItem = z.infer<
  typeof currentWeekProgressItemSchema
>;
export type FinalizedWeeklyHistoryItem = z.infer<
  typeof finalizedWeeklyHistoryItemSchema
>;
