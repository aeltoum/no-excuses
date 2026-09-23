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
export const notificationOpenRequestSchema = z
  .object({ notificationId: uuidSchema })
  .strict();

export const removeGroupMemberRequestSchema = z
  .object({ groupId: uuidSchema, membershipId: uuidSchema })
  .strict();

export const setWeeklyTargetRequestSchema = z
  .object({ weeklyTarget: positiveIntegerSchema })
  .strict();

export const deleteAccountRequestSchema = z
  .object({
    confirmation: z.literal(true),
    otpCode: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const setDisplayNameRequestSchema = z
  .object({ displayName: boundedTextSchema(40) })
  .strict();

export const enrollmentRequestSchema = z
  .object({ email: z.email().max(254), token: boundedTextSchema(256) })
  .strict();
export const invitationPreviewRequestSchema = z
  .object({ token: boundedTextSchema(256) })
  .strict();
export const consentRequestSchema = z
  .object({
    adult: z.literal(true),
    pilot: z.literal(true),
    product: z.literal(true),
  })
  .strict();

const socialInteractionIdentitySchema = z.object({
  interactionId: uuidSchema,
  recipientMembershipId: uuidSchema,
});

export const createSocialInteractionRequestSchema = z.discriminatedUnion(
  "kind",
  [
    socialInteractionIdentitySchema
      .extend({
        kind: z.literal("reaction"),
        body: z.enum(["strong", "fire", "cheer"]),
      })
      .strict(),
    socialInteractionIdentitySchema
      .extend({
        kind: z.literal("message"),
        body: z
          .string()
          .min(1)
          .max(280)
          .refine((value) => value === value.trim()),
      })
      .strict(),
  ],
);

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

export const notificationItemSchema = z
  .object({
    notificationId: uuidSchema,
    class: z.enum(["social", "action"]),
    priority: z.number().int().min(1).max(3),
    templateKey: boundedTextSchema(80),
    state: z.enum(["unread", "read"]),
    createdAt: utcInstantSchema,
    relevantUntil: utcInstantSchema,
  })
  .strict();

export const notificationCenterResultSchema = z
  .object({
    unread: z.array(notificationItemSchema),
    read: z.array(notificationItemSchema),
  })
  .strict();

export const notificationOpenResultSchema = z
  .object({ route: z.string().startsWith("/") })
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
export const accountDisplayNameResultSchema = z
  .object({ displayName: boundedTextSchema(40).nullable() })
  .strict();
export const invitationPreviewResultSchema = z
  .object({
    groupName: boundedTextSchema(80),
    memberCount: positiveIntegerSchema,
    weekEndsAt: utcInstantSchema,
  })
  .strict();
export const groupRosterResultSchema = z
  .object({
    groupName: boundedTextSchema(80),
    members: z.array(
      z
        .object({
          membershipId: uuidSchema,
          displayName: boundedTextSchema(40),
          weeklyTarget: positiveIntegerSchema,
          creator: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export const pendingGroupInvitationSchema = z
  .object({
    invitationId: uuidSchema,
    email: z.email().max(254),
    expiresAt: utcInstantSchema,
  })
  .strict();
export const socialInteractionResultSchema = z
  .object({ interactionId: uuidSchema })
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
export const notificationCenterResponseSchema = commandResponse(
  notificationCenterResultSchema,
);
export const notificationOpenResponseSchema = commandResponse(
  notificationOpenResultSchema,
);
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
export const accountDisplayNameResponseSchema = commandResponse(
  accountDisplayNameResultSchema,
);
export const invitationPreviewResponseSchema = commandResponse(
  invitationPreviewResultSchema,
);
export const groupRosterResponseSchema = commandResponse(
  groupRosterResultSchema,
);
export const pendingGroupInvitationsResponseSchema = commandResponse(
  z.array(pendingGroupInvitationSchema),
);
export const pendingAccountDeletionResponseSchema = commandResponse(
  z
    .object({ accountId: uuidSchema, authDeletion: z.literal("pending") })
    .strict(),
);
export const enrollmentResponseSchema = commandResponse(
  z
    .object({
      message: z.literal("If invitation is eligible, request a sign-in code."),
    })
    .strict(),
);
export const consentResponseSchema = commandResponse(
  z.object({ accepted: z.literal(true) }).strict(),
);
export const socialInteractionResponseSchema = commandResponse(
  socialInteractionResultSchema,
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
    displayName: boundedTextSchema(40),
    lockedTarget: positiveIntegerSchema,
    completedWorkoutCount: z.number().int().nonnegative(),
    activityTypes: z.array(workoutActivityTypeSchema),
  })
  .strict();

export const finalizedWeeklyHistoryItemSchema = z
  .object({
    membershipId: uuidSchema,
    displayName: boundedTextSchema(40),
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
export type NotificationCenterResult = z.infer<
  typeof notificationCenterResultSchema
>;
export type NotificationOpenRequest = z.infer<
  typeof notificationOpenRequestSchema
>;
export type NotificationOpenResult = z.infer<
  typeof notificationOpenResultSchema
>;
export type GroupRequest = z.infer<typeof groupRequestSchema>;
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;
export type IssueGroupInvitationRequest = z.infer<
  typeof issueGroupInvitationRequestSchema
>;
export type InvitationPreviewResult = z.infer<
  typeof invitationPreviewResultSchema
>;
export type GroupRosterResult = z.infer<typeof groupRosterResultSchema>;
export type PendingGroupInvitation = z.infer<
  typeof pendingGroupInvitationSchema
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
export type SetDisplayNameRequest = z.infer<typeof setDisplayNameRequestSchema>;
export type CreateSocialInteractionRequest = z.infer<
  typeof createSocialInteractionRequestSchema
>;
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
export type SocialInteractionResult = z.infer<
  typeof socialInteractionResultSchema
>;
export type WorkoutCheckinResult = z.infer<typeof workoutCheckinResultSchema>;
export type CurrentWeekProgressItem = z.infer<
  typeof currentWeekProgressItemSchema
>;
export type FinalizedWeeklyHistoryItem = z.infer<
  typeof finalizedWeeklyHistoryItemSchema
>;
