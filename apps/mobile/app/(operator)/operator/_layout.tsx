import { Tabs } from "expo-router";
import { operatorDestinations } from "../../../src/navigation";

export default function OperatorLayout() {
  return (
    <Tabs>
      {operatorDestinations.map(({ label, route }) => (
        <Tabs.Screen
          key={route}
          name={route.replace("/operator/", "")}
          options={{ title: label }}
        />
      ))}
    </Tabs>
  );
}
