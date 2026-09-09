import { describe, expect, it } from "vitest";
import {
  type ApiDependencies,
  type ApiRequest,
  type ApiResponse,
  handleAcceptGroupInvitation,
  handleCreateGroup,
  handleIssueGroupInvitation,
  handleLeaveGroup,
  handleRemoveGroupMember,
  handleRevokeGroupInvitation,
} from "../packages/delivery/src/api.js";
import {
  failure,
  opaqueId,
  type RequestEnvelope,
  success,
} from "../packages/shared-kernel/src/index.js";

type CommandError = "denied" | "idempotency_conflict" | "domain_failure";
type CommandResult = { commandId: string };
type Dependencies<Input> = Omit<
  ApiDependencies<Input, CommandResult, CommandError>,
  "validate"
>;

const request = (body: unknown): ApiRequest => ({
  authorization: "Bearer local",
  body,
  headers: { "idempotency-key": "018f63c2-7d33-7f54-9fa7-9f55d735ae35" },
});

async function exerciseCommand<Input>(
  handler: (
    request: ApiRequest,
    dependencies: Dependencies<Input>,
  ) => Promise<ApiResponse>,
  body: Input,
  changedBody?: Input,
) {
  const completed = new Map<string, { hash: string; result: CommandResult }>();
  let writes = 0;
  const dependencies: Dependencies<Input> = {
    authenticate: async () =>
      success({
        actorId: opaqueId("actor", "018f63c2-7d33-7f54-9fa7-9f55d735ae36"),
        kind: "member" as const,
      }),
    createId: () => "018f63c2-7d33-7f54-9fa7-9f55d735ae37",
    now: () => "2026-03-05T10:00:00.000Z",
    hash: async (value) =>
      JSON.stringify(value) === JSON.stringify({ command: commandName, body })
        ? "a".repeat(64)
        : "b".repeat(64),
    execute: async (_input: Input, context: RequestEnvelope) => {
      const key = context.idempotency.key;
      const previous = completed.get(key);
      if (previous) {
        return previous.hash === context.idempotency.requestHash
          ? success(previous.result)
          : failure(
              "idempotency_conflict" as const,
              "Key already used for another request",
            );
      }
      writes += 1;
      const result = { commandId: `result-${writes}` };
      completed.set(key, { hash: context.idempotency.requestHash, result });
      return success(result);
    },
    statusFor: (code) =>
      ({
        unauthorized: 401,
        invalid_request: 400,
        idempotency_required: 400,
        denied: 403,
        idempotency_conflict: 409,
        domain_failure: 500,
      })[code],
  };
  const first = await handler(request(body), dependencies);
  expect(first.status).toBe(200);
  expect(await handler(request(body), dependencies)).toEqual(first);
  expect(writes).toBe(1);
  expect(
    await handler(
      { ...request(body), authorization: undefined },
      {
        ...dependencies,
        authenticate: async () => failure("unauthorized" as const, "Sign in"),
      },
    ),
  ).toMatchObject({ status: 401 });
  expect(
    await handler({ ...request(body), headers: {} }, dependencies),
  ).toMatchObject({ status: 400 });
  if (changedBody) {
    expect(await handler(request(changedBody), dependencies)).toMatchObject({
      status: 409,
    });
    expect(writes).toBe(1);
  }
}

let commandName = "";

describe("Group command delivery entrypoints", () => {
  it("binds every command to auth, strict validation, and replay/conflict handling", async () => {
    commandName = "create_group";
    await exerciseCommand(
      handleCreateGroup,
      {
        groupId: "10000000-0000-4000-8000-000000000001",
        membershipId: "40000000-0000-4000-8000-000000000001",
        name: "Friends",
        timeZone: "UTC",
        weeklyTarget: 3,
      },
      {
        groupId: "10000000-0000-4000-8000-000000000001",
        membershipId: "40000000-0000-4000-8000-000000000001",
        name: "Other friends",
        timeZone: "UTC",
        weeklyTarget: 3,
      },
    );
    commandName = "issue_group_invitation";
    await exerciseCommand(
      handleIssueGroupInvitation,
      {
        invitationId: "50000000-0000-4000-8000-000000000001",
        email: "peer@example.test",
      },
      {
        invitationId: "50000000-0000-4000-8000-000000000001",
        email: "other@example.test",
      },
    );
    commandName = "revoke_group_invitation";
    await exerciseCommand(
      handleRevokeGroupInvitation,
      { invitationId: "50000000-0000-4000-8000-000000000001" },
      { invitationId: "50000000-0000-4000-8000-000000000002" },
    );
    commandName = "accept_group_invitation";
    await exerciseCommand(
      handleAcceptGroupInvitation,
      {
        token: "opaque-token",
        membershipId: "40000000-0000-4000-8000-000000000002",
        recurringTarget: 3,
        currentTarget: 2,
      },
      {
        token: "opaque-token",
        membershipId: "40000000-0000-4000-8000-000000000002",
        recurringTarget: 3,
        currentTarget: 1,
      },
    );
    commandName = "leave_group";
    await exerciseCommand(handleLeaveGroup, {});
    commandName = "remove_group_member";
    await exerciseCommand(
      handleRemoveGroupMember,
      {
        groupId: "10000000-0000-4000-8000-000000000001",
        membershipId: "40000000-0000-4000-8000-000000000002",
      },
      {
        groupId: "10000000-0000-4000-8000-000000000001",
        membershipId: "40000000-0000-4000-8000-000000000003",
      },
    );
  });
});
