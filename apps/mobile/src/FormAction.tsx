import { Pressable, StyleSheet, Text } from "react-native";

export function FormAction({
  label,
  disabled,
  onPress,
  secondary = false,
}: Readonly<{
  label: string;
  disabled?: boolean;
  onPress(): void;
  secondary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: "#FFD400",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  actionText: { color: "#0A0A0A", fontSize: 17, fontWeight: "800" },
  secondary: {
    backgroundColor: "transparent",
    borderColor: "#E8E8E8",
    borderWidth: 1,
  },
  secondaryText: { color: "#E8E8E8" },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
