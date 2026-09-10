export type MemberReadState<T> =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "empty"; message: string }>
  | Readonly<{ status: "denied"; message: string }>
  | Readonly<{ status: "failure"; message: string; retryable: boolean }>
  | Readonly<{ status: "conflict"; message: string }>
  | Readonly<{ status: "pending"; message: string }>
  | Readonly<{ status: "ready"; value: T; staleAt?: string }>;

export type MemberReadEvent<T> =
  | Readonly<{ type: "load" }>
  | Readonly<{ type: "empty"; message: string }>
  | Readonly<{ type: "denied"; message: string }>
  | Readonly<{ type: "failure"; message: string; retryable: boolean }>
  | Readonly<{ type: "conflict"; message: string }>
  | Readonly<{ type: "pending"; message: string }>
  | Readonly<{ type: "loaded"; value: T; staleAt?: string }>;

export function reduceMemberReadState<T>(
  _state: MemberReadState<T>,
  event: MemberReadEvent<T>,
): MemberReadState<T> {
  switch (event.type) {
    case "load":
      return { status: "loading" };
    case "empty":
      return { status: "empty", message: event.message };
    case "denied":
      return { status: "denied", message: event.message };
    case "failure":
      return {
        status: "failure",
        message: event.message,
        retryable: event.retryable,
      };
    case "conflict":
      return { status: "conflict", message: event.message };
    case "pending":
      return { status: "pending", message: event.message };
    case "loaded":
      return { status: "ready", value: event.value, staleAt: event.staleAt };
  }
}

export type MemberRouteKind = "home" | "task" | "notification" | "season";

export function memberRoute(kind: MemberRouteKind, id?: string): string {
  if (kind === "home") return "/home";
  if (kind === "season") return "/season";
  if (!id) return "/home?notice=unavailable";
  return kind === "task"
    ? `/tasks/${encodeURIComponent(id)}`
    : `/notifications?id=${encodeURIComponent(id)}`;
}
