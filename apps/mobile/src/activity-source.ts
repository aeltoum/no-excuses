export type ActivityPlatform = "healthkit" | "health_connect";
export type ActivityPermission =
  | "not_requested"
  | "granted"
  | "limited"
  | "denied";
export type ActivitySourceState = "connected" | "disconnected" | "changed";

export type ActivityInterval = Readonly<{
  startsAt: string;
  endsAt: string;
}>;

export type StepsAggregate = Readonly<{
  kind: "steps";
  steps: number;
}>;

export type CardioAggregate = Readonly<{
  kind: "cardio";
  benchmark: string;
  comparison: "fixed_distance" | "fixed_duration";
  distanceMetres: number;
  durationSeconds: number;
}>;

export type ActivityAggregate = StepsAggregate | CardioAggregate;

export type AggregateRead = Readonly<{
  platform: ActivityPlatform;
  permission: ActivityPermission;
  sourceState: ActivitySourceState;
  interval: ActivityInterval;
  completeness: "complete" | "partial";
  aggregate: ActivityAggregate | null;
}>;

/** App-owned, read-only boundary. Implementations may return aggregates only. */
export interface ActivityAggregateSource {
  readonly platform: ActivityPlatform;
  permission(): Promise<ActivityPermission>;
  read(interval: ActivityInterval): Promise<AggregateRead>;
}

function intervalKey(interval: ActivityInterval) {
  return `${interval.startsAt}/${interval.endsAt}`;
}

function immutable<Value>(value: Value): Value {
  return Object.freeze(structuredClone(value));
}

/** Deterministic test adapter. Reads never mutate fixtures or infer missing values as zero. */
export class FakeActivityAggregateSource implements ActivityAggregateSource {
  readonly platform: ActivityPlatform;
  readonly #permission: ActivityPermission;
  readonly #reads: ReadonlyMap<string, AggregateRead>;

  constructor(
    platform: ActivityPlatform,
    permission: ActivityPermission,
    reads: readonly AggregateRead[],
  ) {
    this.platform = platform;
    this.#permission = permission;
    this.#reads = new Map(
      reads.map((read) => [intervalKey(read.interval), immutable(read)]),
    );
  }

  async permission() {
    return this.#permission;
  }

  async read(interval: ActivityInterval) {
    const found = this.#reads.get(intervalKey(interval));
    if (found) return immutable(found);
    return immutable<AggregateRead>({
      platform: this.platform,
      permission: this.#permission,
      sourceState: "connected",
      interval,
      completeness: "partial",
      aggregate: null,
    });
  }
}
