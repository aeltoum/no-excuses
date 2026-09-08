export type OpaqueId<Kind extends string> = string & {
  readonly __opaqueId: Kind;
};

export function opaqueId<Kind extends string>(
  kind: Kind,
  value: string,
): OpaqueId<Kind> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${kind} must be a UUID`);
  }
  return value as OpaqueId<Kind>;
}

export type UtcInstant = string & { readonly __utcInstant: true };

export function utcInstant(value: string): UtcInstant {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error("UTC instant must be an ISO 8601 timestamp ending in Z");
  }
  const parsed = new Date(value);
  const normalized = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_match, fraction: string | undefined) =>
      `.${(fraction ?? "").padEnd(3, "0")}Z`,
  );
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error("UTC instant must represent a real date and time");
  }
  return value as UtcInstant;
}

export type GroupZoneFact = Readonly<{
  timeZone: string;
  recordedAt: UtcInstant;
}>;

export function groupZoneFact(
  timeZone: string,
  recordedAt: UtcInstant,
): GroupZoneFact {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error("Group time zone must be an IANA time-zone name");
  }
  return { timeZone, recordedAt };
}

export type ActorKind = "member" | "operator" | "service";

export type ActorEnvelope = Readonly<{
  actorId: OpaqueId<"actor">;
  kind: ActorKind;
}>;

export type IdempotencyEnvelope = Readonly<{
  key: OpaqueId<"idempotency">;
  requestHash: string;
}>;

export function idempotencyEnvelope(
  key: string,
  requestHash: string,
): IdempotencyEnvelope {
  if (!/^[0-9a-f]{64}$/.test(requestHash)) {
    throw new Error("Request hash must be 64 lowercase hexadecimal characters");
  }
  return { key: opaqueId("idempotency", key), requestHash };
}

export type RequestEnvelope = Readonly<{
  requestId: OpaqueId<"request">;
  receivedAt: UtcInstant;
  actor: ActorEnvelope;
  idempotency: IdempotencyEnvelope;
}>;

export type AggregateVersion = number & { readonly __aggregateVersion: true };

export function aggregateVersion(value: number): AggregateVersion {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Aggregate version must be a non-negative safe integer");
  }
  return value as AggregateVersion;
}

export type Success<Value> = Readonly<{ ok: true; value: Value }>;
export type Failure<Code extends string> = Readonly<{
  ok: false;
  error: Readonly<{ code: Code; message: string; retryable: boolean }>;
}>;
export type Result<Value, Code extends string> = Success<Value> | Failure<Code>;

export const success = <Value>(value: Value): Success<Value> => ({
  ok: true,
  value,
});

export const failure = <Code extends string>(
  code: Code,
  message: string,
  retryable = false,
): Failure<Code> => ({ ok: false, error: { code, message, retryable } });

export type EventEnvelope<Payload> = Readonly<{
  eventId: OpaqueId<"event">;
  aggregateId: OpaqueId<"aggregate">;
  aggregateVersion: AggregateVersion;
  eventType: string;
  occurredAt: UtcInstant;
  payload: Payload;
}>;

export interface TransactionHandle {
  execute<Result>(
    operation: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
}

export interface Transaction {
  execute<Rows>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<Rows>;
  addEvent<Payload>(event: EventEnvelope<Payload>): Promise<void>;
}
