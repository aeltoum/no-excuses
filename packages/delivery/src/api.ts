import {
  acceptGroupInvitationRequestSchema,
  createGroupRequestSchema,
  createSocialInteractionRequestSchema,
  currentGroupMembershipRequestSchema,
  deleteAccountRequestSchema,
  groupRequestSchema,
  issueGroupInvitationRequestSchema,
  leaveGroupRequestSchema,
  notificationOpenRequestSchema,
  removeGroupMemberRequestSchema,
  revokeGroupInvitationRequestSchema,
  setWeeklyTargetRequestSchema,
  submitWorkoutCheckinRequestSchema,
} from "../../contracts/src/runtime.js";
import type {
  ActorEnvelope,
  RequestEnvelope,
  Result,
} from "../../shared-kernel/src/index.js";
import {
  idempotencyEnvelope,
  opaqueId,
  utcInstant,
} from "../../shared-kernel/src/index.js";

export type ApiRequest = Readonly<{
  authorization: string | undefined;
  body: unknown;
  headers: Readonly<Record<string, string | undefined>>;
}>;

export type ApiResponse = Readonly<{ status: number; body: unknown }>;

export interface ApiDependencies<Input, Output, Code extends string> {
  authenticate(
    authorization: string | undefined,
  ): Promise<Result<ActorEnvelope, "unauthorized">>;
  validate(body: unknown): Result<Input, "invalid_request">;
  createId(): string;
  now(): string;
  hash(body: unknown): Promise<string>;
  execute(
    input: Input,
    context: RequestEnvelope,
  ): Promise<Result<Output, Code>>;
  statusFor(
    code: Code | "invalid_request" | "unauthorized" | "idempotency_required",
  ): number;
}

export interface ReadApiDependencies<Input, Output, Code extends string> {
  authenticate(
    authorization: string | undefined,
  ): Promise<Result<ActorEnvelope, "unauthorized">>;
  validate(body: unknown): Result<Input, "invalid_request">;
  execute(input: Input, actor: ActorEnvelope): Promise<Result<Output, Code>>;
  statusFor(code: Code | "invalid_request" | "unauthorized"): number;
}

export async function handleV1Request<Input, Output, Code extends string>(
  request: ApiRequest,
  dependencies: ApiDependencies<Input, Output, Code>,
): Promise<ApiResponse> {
  const actor = await dependencies.authenticate(request.authorization);
  if (!actor.ok) {
    return {
      status: dependencies.statusFor(actor.error.code),
      body: { contractVersion: 1, error: actor.error },
    };
  }

  const input = dependencies.validate(request.body);
  if (!input.ok) {
    return {
      status: dependencies.statusFor(input.error.code),
      body: { contractVersion: 1, error: input.error },
    };
  }

  const idempotencyKey = request.headers["idempotency-key"];
  if (!idempotencyKey) {
    const error = {
      code: "idempotency_required" as const,
      message: "Idempotency-Key is required",
      retryable: false,
    };
    return {
      status: dependencies.statusFor(error.code),
      body: { contractVersion: 1, error },
    };
  }

  try {
    opaqueId("idempotency", idempotencyKey);
  } catch {
    const error = {
      code: "invalid_request" as const,
      message: "Idempotency-Key must be a UUID",
      retryable: false,
    };
    return {
      status: dependencies.statusFor(error.code),
      body: { contractVersion: 1, error },
    };
  }

  const context = {
    requestId: opaqueId("request", dependencies.createId()),
    receivedAt: utcInstant(dependencies.now()),
    actor: actor.value,
    idempotency: idempotencyEnvelope(
      idempotencyKey,
      await dependencies.hash(request.body),
    ),
  } satisfies RequestEnvelope;

  const result = await dependencies.execute(input.value, context);
  return result.ok
    ? { status: 200, body: { contractVersion: 1, data: result.value } }
    : {
        status: dependencies.statusFor(result.error.code),
        body: { contractVersion: 1, error: result.error },
      };
}

export async function handleV1ReadRequest<Input, Output, Code extends string>(
  request: ApiRequest,
  dependencies: ReadApiDependencies<Input, Output, Code>,
): Promise<ApiResponse> {
  const actor = await dependencies.authenticate(request.authorization);
  if (!actor.ok) {
    return {
      status: dependencies.statusFor(actor.error.code),
      body: { contractVersion: 1, error: actor.error },
    };
  }

  const input = dependencies.validate(request.body);
  if (!input.ok) {
    return {
      status: dependencies.statusFor(input.error.code),
      body: { contractVersion: 1, error: input.error },
    };
  }

  const result = await dependencies.execute(input.value, actor.value);
  return result.ok
    ? { status: 200, body: { contractVersion: 1, data: result.value } }
    : {
        status: dependencies.statusFor(result.error.code),
        body: { contractVersion: 1, error: result.error },
      };
}

type CommandDependencies<Input, Output, Code extends string> = Omit<
  ApiDependencies<Input, Output, Code>,
  "validate"
>;

type ReadDependencies<Input, Output, Code extends string> = Omit<
  ReadApiDependencies<Input, Output, Code>,
  "validate"
>;

interface RuntimeSchema<Input> {
  safeParse(
    value: unknown,
  ): { success: true; data: Input } | { success: false };
}

function validateWith<Input>(schema: RuntimeSchema<Input>) {
  return (body: unknown): Result<Input, "invalid_request"> => {
    const parsed = schema.safeParse(body);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          error: {
            code: "invalid_request",
            message: "Invalid request",
            retryable: false,
          },
        };
  };
}

function groupCommandHandler<Input, Output, Code extends string>(
  command: string,
  schema: RuntimeSchema<Input>,
) {
  return (
    request: ApiRequest,
    dependencies: CommandDependencies<Input, Output, Code>,
  ) =>
    handleV1Request(request, {
      ...dependencies,
      hash: (body) => dependencies.hash({ command, body }),
      validate: validateWith(schema),
    });
}

function groupReadHandler<Input, Output, Code extends string>(
  schema: RuntimeSchema<Input>,
) {
  return (
    request: ApiRequest,
    dependencies: ReadDependencies<Input, Output, Code>,
  ) =>
    handleV1ReadRequest(request, {
      ...dependencies,
      validate: validateWith(schema),
    });
}

export const handleSubmitWorkoutCheckin = groupCommandHandler(
  "submit_workout_checkin",
  submitWorkoutCheckinRequestSchema,
);
export const handleCurrentWeekProgress = groupReadHandler(groupRequestSchema);
export const handleCurrentGroupMembership = groupReadHandler(
  currentGroupMembershipRequestSchema,
);
export const handleMemberHome = groupReadHandler(
  currentGroupMembershipRequestSchema,
);
export const handleNotifications = groupReadHandler(
  currentGroupMembershipRequestSchema,
);
export const handleNotificationOpen = groupReadHandler(
  notificationOpenRequestSchema,
);
export const handleFinalizedWeeklyHistory =
  groupReadHandler(groupRequestSchema);

export const handleCreateGroup = groupCommandHandler(
  "create_group",
  createGroupRequestSchema,
);
export const handleCreateSocialInteraction = groupCommandHandler(
  "create_social_interaction",
  createSocialInteractionRequestSchema,
);
export const handleIssueGroupInvitation = groupCommandHandler(
  "issue_group_invitation",
  issueGroupInvitationRequestSchema,
);
export const handleRevokeGroupInvitation = groupCommandHandler(
  "revoke_group_invitation",
  revokeGroupInvitationRequestSchema,
);
export const handleAcceptGroupInvitation = groupCommandHandler(
  "accept_group_invitation",
  acceptGroupInvitationRequestSchema,
);
export const handleLeaveGroup = groupCommandHandler(
  "leave_group",
  leaveGroupRequestSchema,
);
export const handleRemoveGroupMember = groupCommandHandler(
  "remove_group_member",
  removeGroupMemberRequestSchema,
);
export const handleSetWeeklyTarget = groupCommandHandler(
  "set_weekly_target",
  setWeeklyTargetRequestSchema,
);
export const handleDeleteAccount = groupCommandHandler(
  "delete_account",
  deleteAccountRequestSchema,
);
