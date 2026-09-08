import type {
  Result,
  Transaction,
  TransactionHandle,
} from "../../shared-kernel/src/index.js";

export type DueWork = Readonly<{ id: string; payload: unknown }>;

export interface WorkQueue {
  claimDue(): Promise<DueWork | undefined>;
  markDelivered(id: string, transaction: Transaction): Promise<void>;
}

export interface WorkDelivery<Code extends string> {
  deliver(work: DueWork): Promise<Result<void, Code>>;
}

export async function runWorkerOnce<Code extends string>(
  transaction: TransactionHandle,
  queue: WorkQueue,
  delivery: WorkDelivery<Code>,
): Promise<Result<"idle" | "delivered", Code>> {
  const work = await queue.claimDue();
  if (!work) return { ok: true, value: "idle" };

  const result = await delivery.deliver(work);
  if (!result.ok) return result;

  await transaction.execute(async (activeTransaction) =>
    queue.markDelivered(work.id, activeTransaction),
  );
  return { ok: true, value: "delivered" };
}
