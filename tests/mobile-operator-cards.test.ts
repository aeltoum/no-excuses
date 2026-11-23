import { describe, expect, it, vi } from "vitest";
import {
  createOperatorCardsClient,
  validVoidReason,
  voidConfirmBody,
} from "../apps/mobile/src/operator-cards.js";

const card = {
  obligationId: "92000000-0000-4000-8000-000000000001",
  membershipId: "30000000-0000-4000-8000-000000000002",
  member: "Maya",
  group: "6AM Crew",
  reason: "missed_target" as const,
  createdAt: "2026-10-19T10:00:00.000Z",
  card: "Wall sit 60s",
  expiresAt: null,
};
const reply = (status: number, data: unknown) =>
  new Response(JSON.stringify({ contractVersion: 1, data }), { status });

describe("mobile operator cards", () => {
  it("requires a reason and explains the effect", () => {
    expect(validVoidReason("   ")).toBeNull();
    expect(validVoidReason("x".repeat(201))).toBeNull();
    expect(validVoidReason(" Unsafe ")).toBe("Unsafe");
    expect(voidConfirmBody(card)).toContain("Maya owes one card fewer");
  });

  it("loads cards and voids one with a trimmed reason", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { cards: [card] }))
      .mockResolvedValueOnce(reply(200, { cards: [] }));
    const api = createOperatorCardsClient({
      baseUrl: "http://127.0.0.1:8787/",
      authorization: "Bearer t",
      fetch,
    });
    expect(await api.load()).toEqual([card]);
    expect(await api.void(card.obligationId, " Unsafe ")).toEqual([]);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:8787/v1/operator/void-card",
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toEqual({
      obligationId: card.obligationId,
      reason: "Unsafe",
    });
    expect(() => api.void(card.obligationId, "")).toThrow("Reason required");
  });

  it("reports non-operators", async () => {
    const api = createOperatorCardsClient({
      baseUrl: "http://x",
      authorization: "Bearer t",
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 403 })),
    });
    await expect(api.load()).rejects.toThrow("operator only");
  });
});
