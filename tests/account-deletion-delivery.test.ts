import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  deleteAccountRequestSchema,
  deletedAccountResponseSchema,
} from "../packages/contracts/src/runtime.js";
import {
  type ApiRequest,
  handleDeleteAccount,
} from "../packages/delivery/src/api.js";
import {
  failure,
  opaqueId,
  type RequestEnvelope,
  success,
} from "../packages/shared-kernel/src/index.js";

const accountId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "018f63c2-7d33-7f54-9fa7-9f55d735ae35";
const body = { confirmation: true } as const;
const request = (requestBody: unknown = body): ApiRequest => ({
  authorization: "Bearer local",
  body: requestBody,
  headers: { "idempotency-key": idempotencyKey },
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

function dependencies() {
  const completed = new Map<string, { hash: string; accountId: string }>();
  let writes = 0;
  const hash = vi.fn(async (value: unknown) =>
    JSON.stringify(value) ===
    JSON.stringify({ command: "delete_account", body })
      ? "a".repeat(64)
      : "b".repeat(64),
  );
  return {
    authenticate: async () =>
      success({
        actorId: opaqueId("actor", accountId),
        kind: "member" as const,
      }),
    createId: () => "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
    now: () => "2026-09-09T10:00:00.000Z",
    hash,
    execute: async (_input: typeof body, context: RequestEnvelope) => {
      const previous = completed.get(context.idempotency.key);
      if (previous) {
        return previous.hash === context.idempotency.requestHash
          ? success({ accountId: previous.accountId })
          : failure("idempotency_conflict" as const, "Key reused");
      }
      writes += 1;
      completed.set(context.idempotency.key, {
        hash: context.idempotency.requestHash,
        accountId,
      });
      return success({ accountId });
    },
    statusFor,
    hashSpy: hash,
    writes: () => writes,
  };
}

describe("Account deletion API contract", () => {
  it("publishes authenticated idempotent version 1 deletion", async () => {
    const source = await readFile(
      new URL("../packages/contracts/openapi.yaml", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("  /v1/account:");
    const end = source.indexOf("\n  /", start + 1);
    const operation = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(operation).toContain("operationId: deleteAccount");
    expect(operation).toContain("security:");
    expect(operation).toContain("#/components/parameters/IdempotencyKey");
    expect(operation).toContain("#/components/schemas/DeleteAccountRequest");
    expect(operation).toContain("#/components/schemas/DeletedAccountResponse");
    expect(operation).toContain('"409":');
  });

  it("requires exact confirmation and bounds result", () => {
    expect(deleteAccountRequestSchema.parse(body)).toEqual(body);
    for (const invalid of [
      {},
      { confirmation: false },
      { confirmation: true, extra: true },
    ]) {
      expect(deleteAccountRequestSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      deletedAccountResponseSchema.parse({
        contractVersion: 1,
        data: { accountId },
      }),
    ).toEqual({ contractVersion: 1, data: { accountId } });
    expect(
      deletedAccountResponseSchema.safeParse({
        contractVersion: 1,
        data: { accountId, email: "deleted@example.test" },
      }).success,
    ).toBe(false);
  });
});

describe("Account deletion delivery entrypoint", () => {
  it("fails closed for unauthenticated, invalid, and missing or bad idempotency", async () => {
    const deps = dependencies();
    expect(
      await handleDeleteAccount(
        { ...request(), authorization: undefined },
        {
          ...deps,
          authenticate: async () => failure("unauthorized" as const, "Sign in"),
        },
      ),
    ).toMatchObject({ status: 401, body: { error: { code: "unauthorized" } } });
    for (const invalid of [
      {},
      { confirmation: false },
      { confirmation: true, extra: true },
    ]) {
      expect(await handleDeleteAccount(request(invalid), deps)).toMatchObject({
        status: 400,
        body: { error: { code: "invalid_request" } },
      });
    }
    expect(
      await handleDeleteAccount({ ...request(), headers: {} }, deps),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "idempotency_required" } },
    });
    expect(
      await handleDeleteAccount(
        { ...request(), headers: { "idempotency-key": "bad" } },
        deps,
      ),
    ).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
    expect(deps.writes()).toBe(0);
  });

  it("returns bounded success and delegates replay and changed-body conflict", async () => {
    const deps = dependencies();
    const first = await handleDeleteAccount(request(), deps);
    expect(first).toEqual({
      status: 200,
      body: { contractVersion: 1, data: { accountId } },
    });
    expect(await handleDeleteAccount(request(), deps)).toEqual(first);
    expect(deps.writes()).toBe(1);
    expect(deps.hashSpy).toHaveBeenCalledWith({
      command: "delete_account",
      body,
    });
    expect(
      await handleDeleteAccount(request({ confirmation: true }), {
        ...deps,
        hash: async () => "b".repeat(64),
      }),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "idempotency_conflict" } },
    });
    expect(deps.writes()).toBe(1);
  });
});
