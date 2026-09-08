import { describe, expect, it, vi } from "vitest";
import { handleV1Request } from "../packages/delivery/src/api.js";
import { loadServiceConfig } from "../packages/delivery/src/config.js";
import { runWorkerOnce } from "../packages/delivery/src/worker.js";
import type {
  RequestEnvelope,
  Transaction,
  TransactionHandle,
} from "../packages/shared-kernel/src/index.js";
import { opaqueId, success } from "../packages/shared-kernel/src/index.js";

describe("delivery shells", () => {
  it("requires environment-bound service configuration", () => {
    expect(
      loadServiceConfig({
        APP_ENVIRONMENT: "local",
        DATABASE_URL: "postgresql://local",
      }),
    ).toEqual({
      environment: "local",
      databaseUrl: "postgresql://local",
    });
    expect(() => loadServiceConfig({})).toThrow("required");
  });
  it("authenticates, validates, creates context, delegates, and translates API results", async () => {
    const execute = vi.fn(
      async (_input: { value: string }, context: RequestEnvelope) =>
        success(context.requestId),
    );
    const response = await handleV1Request(
      {
        authorization: "Bearer local",
        body: { value: "accepted" },
        headers: { "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35" },
      },
      {
        authenticate: async () =>
          success({
            actorId: opaqueId("actor", "018f63c2-7d33-7f54-9fa7-9f55d735ae36"),
            kind: "member",
          }),
        validate: (body) => success(body as { value: string }),
        createId: () => "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
        now: () => "2026-09-07T12:34:56.000Z",
        hash: async () => "a".repeat(64),
        execute,
        statusFor: () => 400,
      },
    );

    expect(response).toEqual({
      status: 200,
      body: {
        contractVersion: 1,
        data: "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
      },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not call a command when authentication fails", async () => {
    const execute = vi.fn();
    const response = await handleV1Request(
      { authorization: undefined, body: {}, headers: {} },
      {
        authenticate: async () => ({
          ok: false,
          error: { code: "unauthorized", message: "Sign in", retryable: false },
        }),
        validate: () => success({}),
        createId: () => "unused",
        now: () => "unused",
        hash: async () => "unused",
        execute,
        statusFor: () => 401,
      },
    );
    expect(response.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("claims, delegates, and marks due work delivered", async () => {
    const markDelivered = vi.fn(async () => undefined);
    const deliver = vi.fn(async () => success(undefined));
    let transactionCalls = 0;
    const transaction: TransactionHandle = {
      async execute<Value>(
        operation: (activeTransaction: Transaction) => Promise<Value>,
      ) {
        transactionCalls += 1;
        return operation({ execute: vi.fn(), addEvent: vi.fn() });
      },
    };
    const result = await runWorkerOnce(
      transaction,
      { claimDue: async () => ({ id: "work-1", payload: {} }), markDelivered },
      { deliver },
    );
    expect(result).toEqual({ ok: true, value: "delivered" });
    expect(deliver).toHaveBeenCalledOnce();
    expect(markDelivered).toHaveBeenCalledWith("work-1", expect.anything());
    expect(transactionCalls).toBe(1);
  });

  it("does not mark failed work delivered", async () => {
    const markDelivered = vi.fn();
    const transaction = { execute: vi.fn() };
    const result = await runWorkerOnce(
      transaction,
      { claimDue: async () => ({ id: "work-1", payload: {} }), markDelivered },
      {
        deliver: async () => ({
          ok: false,
          error: {
            code: "temporarily_unavailable",
            message: "Retry",
            retryable: true,
          },
        }),
      },
    );
    expect(result.ok).toBe(false);
    expect(markDelivered).not.toHaveBeenCalled();
    expect(transaction.execute).not.toHaveBeenCalled();
  });
});
