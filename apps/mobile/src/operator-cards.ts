// Operator-only: list owed Consequence cards and void one with a reason.
export type OwedCard = Readonly<{
  obligationId: string;
  membershipId: string;
  member: string;
  group: string;
  reason: "missed_target" | "rejected_report" | "card_expiry";
  createdAt: string;
  card: string | null;
  expiresAt: string | null;
}>;

export const MAX_VOID_REASON_LENGTH = 200;

export const owedLabel: Record<OwedCard["reason"], string> = {
  missed_target: "Missed target",
  rejected_report: "Rejected report",
  card_expiry: "Expired card",
};

export class OperatorCardsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OperatorCardsError";
  }
}

export function validVoidReason(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed && reason.length <= MAX_VOID_REASON_LENGTH ? trimmed : null;
}

export function voidConfirmBody(card: OwedCard): string {
  return `${card.member} owes one card fewer${
    card.card ? ` and “${card.card}” closes` : ""
  }. Streaks and Crowns stay. This can’t be undone.`;
}

function readCards(value: unknown): OwedCard[] {
  const cards = (value as { data?: { cards?: unknown } } | null)?.data?.cards;
  if (cards === undefined) return [];
  if (!Array.isArray(cards))
    throw new OperatorCardsError("Unexpected console response");
  return cards as OwedCard[];
}

export function createOperatorCardsClient({
  baseUrl,
  authorization,
  fetch: fetchImplementation = globalThis.fetch,
}: Readonly<{ baseUrl: string; authorization: string; fetch?: typeof fetch }>) {
  const root = baseUrl.replace(/\/$/, "");
  async function send(path: string, init: RequestInit): Promise<OwedCard[]> {
    let response: Response;
    try {
      response = await fetchImplementation(`${root}${path}`, {
        ...init,
        headers: {
          authorization,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch {
      throw new OperatorCardsError("Network unavailable");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new OperatorCardsError(
        response.status === 403
          ? "This console is for the app’s operator only."
          : "Action failed. Try again.",
        response.status,
      );
    return readCards(payload);
  }
  return {
    load: () => send("/v1/operator", { method: "GET" }),
    void: (obligationId: string, reason: string) => {
      const valid = validVoidReason(reason);
      if (!valid) throw new OperatorCardsError("Reason required");
      return send("/v1/operator/void-card", {
        method: "POST",
        body: JSON.stringify({ obligationId, reason: valid }),
      });
    },
  };
}
