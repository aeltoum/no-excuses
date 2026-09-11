import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  type MemberReadState,
  memberRoute,
  reduceMemberReadState,
} from "../apps/mobile/src/member-read-state.js";

describe("M7 mobile member read states", () => {
  it("exposes every required non-success state without discarding its explanation", () => {
    let state: MemberReadState<string[]> = { status: "loading" };
    const events = [
      { type: "empty", message: "Nothing needs you" },
      { type: "denied", message: "Current Group membership required" },
      { type: "failure", message: "Could not refresh", retryable: true },
      { type: "conflict", message: "Review current state" },
      { type: "pending", message: "Still working" },
    ] as const;
    for (const event of events) {
      state = reduceMemberReadState(state, event);
      expect(state.status).toBe(event.type);
      expect("message" in state && state.message).toBe(event.message);
    }
  });

  it("keeps stale data explicit and makes malformed deep links recover safely", () => {
    const state = reduceMemberReadState<string[]>(
      { status: "loading" },
      {
        type: "loaded",
        value: ["current week"],
        staleAt: "2026-09-10T12:00:00Z",
      },
    );
    expect(state).toEqual({
      status: "ready",
      value: ["current week"],
      staleAt: "2026-09-10T12:00:00Z",
    });
    expect(memberRoute("task")).toBe("/home?notice=unavailable");
    expect(memberRoute("task", "a/b")).toBe("/tasks/a%2Fb");
  });

  it("presents notification groups, authority, and every degraded state", async () => {
    const source = await readFile(
      new URL("../apps/mobile/app/(member)/notifications.tsx", import.meta.url),
      "utf8",
    );
    for (const text of [
      "Notifications",
      'title="Unread"',
      'title="Read"',
      "No current notifications.",
      'type: "denied"',
      'type: "failure"',
      'type: "conflict"',
      'type: "pending"',
      "In-app status stays available even when device notifications are off.",
      "Offline. Showing Notifications saved",
      "readCachedNotifications",
      'error.kind === "network"',
      "/home?notice=unavailable",
    ]) {
      expect(source).toContain(text);
    }
  });

  it("keeps Home task-first and limits cached rendering to network failure", async () => {
    const source = await readFile(
      new URL("../apps/mobile/app/(member)/home.tsx", import.meta.url),
      "utf8",
    );
    const orderedSections = [
      '<Section title="Needs you">',
      '<Section title="Your weekly progress">',
      '<Section title="Friend activity">',
      '<Section title="Season standings">',
    ];
    let prior = -1;
    for (const section of orderedSections) {
      const position = source.indexOf(section);
      expect(position).toBeGreaterThan(prior);
      prior = position;
    }
    for (const text of [
      "accountId = data.session.user.id",
      "writeCachedHome",
      ").catch(() => undefined)",
      'error.kind === "network"',
      "readCachedHome",
      "staleAt: cached.cachedAt",
      "Offline. Showing Home saved",
      "error.status === 401 || error.status === 403",
      "error.status === 409",
    ]) {
      expect(source).toContain(text);
    }
    const networkFallback = source.indexOf('error.kind === "network"');
    expect(networkFallback).toBeGreaterThan(-1);
    expect(source.indexOf("readCachedHome", networkFallback)).toBeGreaterThan(
      networkFallback,
    );
    expect(source).not.toContain("access_token,");
  });
});
