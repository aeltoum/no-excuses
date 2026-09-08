import { describe, expect, it } from "vitest";
import {
  memberDestinations,
  operatorDestinations,
} from "../apps/mobile/src/navigation.js";

describe("navigation shells", () => {
  it("keeps the member and operator routes separate", () => {
    expect(memberDestinations.map(({ label }) => label)).toEqual([
      "Home",
      "Wall",
      "Group",
      "Season",
      "You",
    ]);
    expect(operatorDestinations.map(({ label }) => label)).toEqual([
      "Work queue",
      "Service health",
      "Procedures",
      "Audit",
    ]);
    expect(
      memberDestinations.every(({ route }) => !route.startsWith("/operator")),
    ).toBe(true);
    expect(
      operatorDestinations.every(({ route }) => route.startsWith("/operator")),
    ).toBe(true);
  });
});
