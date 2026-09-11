import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { memberDestinations } from "../../src/navigation";

export default function MemberLayout() {
  return (
    <View style={{ flex: 1 }}>
      <View accessibilityLiveRegion="polite" accessibilityRole="summary">
        <Text>Service status: Available</Text>
      </View>
      <Tabs>
        {memberDestinations.map(({ label, route }) => (
          <Tabs.Screen
            key={route}
            name={route.slice(1)}
            options={{ title: label }}
          />
        ))}
        <Tabs.Screen
          name="notifications"
          options={{ href: null, title: "Notifications" }}
        />
      </Tabs>
    </View>
  );
}
