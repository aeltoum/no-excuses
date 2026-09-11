import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";

export function KeyboardAwareScreen({
  children,
  contentContainerStyle,
}: PropsWithChildren<{
  contentContainerStyle: StyleProp<ViewStyle>;
}>) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.screen}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={contentContainerStyle}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
