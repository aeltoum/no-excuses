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
