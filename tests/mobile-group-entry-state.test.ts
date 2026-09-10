import { describe, expect, it } from "vitest";
import { MobileApiClientError } from "../apps/mobile/src/api-client.js";
import {
  buildGroupSubmission,
  groupEntryReducer,
  initialGroupEntryState,
  MAX_GROUP_NAME_LENGTH,
  MAX_INVITATION_TOKEN_LENGTH,
} from "../apps/mobile/src/group-entry-state.js";

const ids = {
  idempotencyKey: "018f63c2-7d33-7f54-9fa7-9f55d735ae35",
  membershipId: "40000000-0000-4000-8000-000000000002",
  groupId: "10000000-0000-4000-8000-000000000001",
};

function edit(
  state: ReturnType<typeof groupEntryReducer>,
  field: string,
  value: string,
) {
  return groupEntryReducer(state, { type: "edit", field, value });
}

describe("mobile Group entry state", () => {
  it("builds a normalized atomic create submission", () => {
    let state = groupEntryReducer(initialGroupEntryState, {
      type: "choose-create",
      timeZone: "America/Chicago",
    });
    state = edit(state, "name", `  ${"A".repeat(100)}  `);
    state = edit(state, "weeklyTarget", "3");
    expect(buildGroupSubmission(state, ids)).toEqual({
      kind: "create",
      idempotencyKey: ids.idempotencyKey,
      body: {
        groupId: ids.groupId,
        membershipId: ids.membershipId,
        name: "A".repeat(MAX_GROUP_NAME_LENGTH - 2),
        timeZone: "America/Chicago",
        weeklyTarget: 3,
      },
    });
  });

  it("builds a bounded atomic join submission", () => {
    let state = groupEntryReducer(initialGroupEntryState, {
      type: "choose-join",
    });
    state = edit(state, "token", ` ${"t".repeat(300)} `);
    state = edit(state, "recurringTarget", "5");
    state = edit(state, "currentTarget", "2");
    expect(buildGroupSubmission(state, ids)).toMatchObject({
      kind: "join",
      idempotencyKey: ids.idempotencyKey,
      body: {
        token: "t".repeat(MAX_INVITATION_TOKEN_LENGTH - 1),
        membershipId: ids.membershipId,
        recurringTarget: 5,
        currentTarget: 2,
      },
    });
  });

  it("rejects a non-positive weekly target without imposing a product maximum", () => {
    let state = groupEntryReducer(initialGroupEntryState, {
      type: "choose-create",
      timeZone: "America/Chicago",
    });
    state = edit(edit(state, "name", "Crew"), "weeklyTarget", "0");
    expect(() => buildGroupSubmission(state, ids)).toThrow(
      "Weekly target must be a whole number of 1 or more",
    );
    state = edit(state, "weeklyTarget", "15");
    expect(buildGroupSubmission(state, ids)).toMatchObject({
      body: { weeklyTarget: 15 },
    });
  });

  it("rejects invalid zones and joining targets above recurring targets", () => {
    let create = groupEntryReducer(initialGroupEntryState, {
      type: "choose-create",
      timeZone: "not/a-zone",
    });
    create = edit(edit(create, "name", "Crew"), "weeklyTarget", "3");
    expect(() => buildGroupSubmission(create, ids)).toThrow(
      "Enter a valid IANA time zone",
    );

    let join = groupEntryReducer(initialGroupEntryState, {
      type: "choose-join",
    });
    join = edit(join, "token", "secret");
    join = edit(join, "recurringTarget", "3");
    join = edit(join, "currentTarget", "4");
    expect(() => buildGroupSubmission(join, ids)).toThrow(
      "Joining-week target cannot exceed recurring target",
    );
  });

  it("retains inputs after a sanitized failure", () => {
    let state = groupEntryReducer(initialGroupEntryState, {
      type: "choose-join",
    });
    state = edit(state, "token", "secret");
    state = groupEntryReducer(state, { type: "submit-start" });
    expect(state).toMatchObject({
      screen: "join",
      token: "secret",
      busy: true,
    });
    state = groupEntryReducer(state, {
      type: "submit-failure",
      error: new MobileApiClientError("api", "private detail", {
        status: 403,
        apiError: {
          code: "denied",
          message: "private detail",
          retryable: false,
        },
      }),
    });
    expect(state).toMatchObject({
      screen: "join",
      token: "secret",
      busy: false,
      error: "This Account cannot complete that Group action.",
    });
    expect(JSON.stringify(state)).not.toContain("private detail");
  });

  it("records acknowledged membership before routing", () => {
    expect(
      groupEntryReducer(initialGroupEntryState, {
        type: "submit-success",
        membershipId: ids.membershipId,
      }),
    ).toEqual({ screen: "success", membershipId: ids.membershipId });
  });
});
