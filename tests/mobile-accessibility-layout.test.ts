import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const mobileFile = (path: string) =>
  readFile(new URL(`../apps/mobile/${path}`, import.meta.url), "utf8");

describe("mobile accessibility and responsive layout contracts", () => {
  it("keeps form screens inside the shared keyboard-aware scrolling surface", async () => {
    const wrapper = await mobileFile("src/KeyboardAwareScreen.tsx");
    for (const contract of [
      "<KeyboardAvoidingView",
      'behavior={Platform.OS === "ios" ? "padding" : "height"}',
      "<ScrollView",
      "automaticallyAdjustKeyboardInsets",
      'keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}',
      'keyboardShouldPersistTaps="handled"',
    ]) {
      expect(wrapper).toContain(contract);
    }

    for (const path of [
      "app/index.tsx",
      "app/(member)/group.tsx",
      "app/(member)/home.tsx",
      "app/(member)/you.tsx",
    ]) {
      const source = await mobileFile(path);
      expect(source).toContain("<KeyboardAwareScreen");
      expect(source).toContain("</KeyboardAwareScreen>");
      expect(source).not.toContain("<ScrollView");
    }
  });

  it("moves accessibility focus only when a native text node exists", async () => {
    const helper = await mobileFile("src/accessibility.ts");
    expect(helper).toContain("const node = findNodeHandle(element);");
    expect(helper).toContain(
      "if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);",
    );

    const focusTargets = {
      "app/index.tsx": ["errorSummary.current", "screenTitle.current"],
      "app/(member)/group.tsx": [
        "errorSummary.current",
        "successReceipt.current",
      ],
      "app/(member)/home.tsx": ["actionStatus.current"],
      "app/(member)/you.tsx": ["resultStatus.current"],
    };
    for (const [path, targets] of Object.entries(focusTargets)) {
      const source = await mobileFile(path);
      const importPath = path === "app/index.tsx" ? "../src" : "../../src";
      expect(source).toContain(`from "${importPath}/accessibility"`);
      for (const target of targets) {
        expect(source).toContain(`focusAccessibleText(${target})`);
      }
    }
  });

  it("preserves button semantics, 48-point targets, and wrapping labels", async () => {
    const source = await mobileFile("src/FormAction.tsx");
    for (const contract of [
      'accessibilityRole="button"',
      "accessibilityState={{ disabled }}",
      "disabled={disabled}",
      "minHeight: 48",
      "minWidth: 48",
      "flexShrink: 1",
      'textAlign: "center"',
    ]) {
      expect(source).toContain(contract);
    }
  });

  it("pairs live-region announcements with programmatic focus targets", async () => {
    const expectedTargets = {
      "app/(member)/group.tsx": ["ref={errorSummary}", "ref={successReceipt}"],
      "app/(member)/home.tsx": ["ref={actionStatus}"],
      "app/(member)/you.tsx": ["ref={resultStatus}"],
    };
    for (const [path, targets] of Object.entries(expectedTargets)) {
      const source = await mobileFile(path);
      expect(source).toContain('accessibilityLiveRegion="polite"');
      expect(source).toContain("accessible");
      for (const target of targets) expect(source).toContain(target);
    }
  });

  it("stacks Home metrics and lets narrow-screen content reflow", async () => {
    const source = await mobileFile("app/(member)/home.tsx");
    const rowStyle = source.slice(
      source.indexOf("  row: {"),
      source.indexOf("  rowLabel:"),
    );
    expect(rowStyle).toContain('alignItems: "flex-start"');
    expect(rowStyle).toContain("gap: 6");
    expect(rowStyle).not.toContain('flexDirection: "row"');
    expect(rowStyle).not.toContain('justifyContent: "space-between"');
  });
});
