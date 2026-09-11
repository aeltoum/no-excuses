import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createSocialInteractionRequestSchema,
  socialInteractionResponseSchema,
} from "../packages/contracts/src/runtime.js";

const interactionId = "50000000-0000-4000-8000-000000000003";
const recipientMembershipId = "40000000-0000-4000-8000-000000000002";

describe("social interaction contracts", () => {
  it("accepts only strict reaction and trimmed-length message bodies", () => {
    expect(
      createSocialInteractionRequestSchema.safeParse({
        interactionId,
        recipientMembershipId,
        kind: "reaction",
        body: "fire",
      }).success,
    ).toBe(true);
    expect(
      createSocialInteractionRequestSchema.safeParse({
        interactionId,
        recipientMembershipId,
        kind: "message",
        body: "x".repeat(280),
      }).success,
    ).toBe(true);

    for (const invalid of [
      { interactionId, recipientMembershipId, kind: "reaction", body: "like" },
      { interactionId, recipientMembershipId, kind: "message", body: "   " },
      {
        interactionId,
        recipientMembershipId,
        kind: "message",
        body: " surrounded ",
      },
      {
        interactionId,
        recipientMembershipId,
        kind: "message",
        body: "x".repeat(281),
      },
      {
        interactionId: "visible-id",
        recipientMembershipId,
        kind: "reaction",
        body: "strong",
      },
      {
        interactionId,
        recipientMembershipId,
        kind: "reaction",
        body: "strong",
        extra: true,
      },
    ]) {
      expect(
        createSocialInteractionRequestSchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("requires a strict opaque interaction result", () => {
    expect(
      socialInteractionResponseSchema.safeParse({
        contractVersion: 1,
        data: { interactionId },
      }).success,
    ).toBe(true);
    expect(
      socialInteractionResponseSchema.safeParse({
        contractVersion: 1,
        data: { interactionId, body: "private" },
      }).success,
    ).toBe(false);
  });

  it("keeps Home social controls labeled and private-copy safe", async () => {
    const source = await readFile(
      new URL("../apps/mobile/app/(member)/home.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Send strong reaction");
    expect(source).toContain("Send motivation");
    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toContain("commandIdentities.current[kind]");
    expect(source).toContain("idempotencyKey: identity.idempotencyKey");
    expect(source).toContain("interactionId: identity.interactionId");
    expect(source).toContain(
      "if (definitive) delete commandIdentities.current[kind]",
    );
    expect(source).not.toContain("interactionId}</Text>");
    expect(source).not.toContain("membershipId}</Text>");
  });
});
