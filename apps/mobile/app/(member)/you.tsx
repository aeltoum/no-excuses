import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function You() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        You
      </Text>
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.heading}>
          Account deletion
        </Text>
        <Text style={styles.body}>
          Account deletion is unavailable in the native app until fresh email
          code verification is supported. Use the PWA Account page to delete
          your Account.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#171717", flexGrow: 1, gap: 18, padding: 20 },
  title: { color: "#FAFAF5", fontSize: 34, fontWeight: "900" },
  panel: {
    backgroundColor: "#232323",
    borderColor: "#444",
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  heading: {
    color: "#E8FF00",
    fontSize: 16,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  body: { color: "#FAFAF5", fontSize: 16, lineHeight: 24 },
});
