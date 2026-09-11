import { AccessibilityInfo, findNodeHandle, type Text } from "react-native";

export function focusAccessibleText(element: Text | null) {
  const node = findNodeHandle(element);
  if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
}
