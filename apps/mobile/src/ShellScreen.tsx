import { StyleSheet, Text, View } from "react-native";

export function ShellScreen({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text>This area is ready for a future milestone.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 12 },
});
