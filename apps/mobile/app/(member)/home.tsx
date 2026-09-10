import type { MemberHomeResult } from "@no-excuses/contracts";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useCallback, useEffect, useReducer } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  createMobileApiClient,
  MobileApiClientError,
  readMobileApiBaseUrl,
} from "../../src/api-client";
import {
  type MemberReadEvent,
  type MemberReadState,
  reduceMemberReadState,
} from "../../src/member-read-state";
import { createLocalMobileSupabaseClient } from "../../src/native-supabase";

const initialState: MemberReadState<MemberHomeResult> = { status: "loading" };

function StateMessage({
  message,
  retry,
}: Readonly<{ message: string; retry?: () => void }>) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.stateCard}>
      <Text style={styles.stateText}>{message}</Text>
      {retry ? (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Section({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function MemberHome({ value }: Readonly<{ value: MemberHomeResult }>) {
  const remaining = Math.max(
    0,
    (value.lockedTarget ?? 0) - value.completedWorkoutCount,
  );
  return (
    <>
      <Section title="Needs you">
        <Text style={styles.needsYou}>
          {value.needsYouCount > 0
            ? `${remaining} workout${remaining === 1 ? "" : "s"} left this week.`
            : "Nothing needs you right now."}
        </Text>
      </Section>
      <Section title="Your weekly progress">
        <Text style={styles.metric}>
          {value.completedWorkoutCount} / {value.lockedTarget ?? "—"} workouts
        </Text>
        <Text style={styles.detail}>
          {value.weekStatus ?? "No active accountability week"}
        </Text>
      </Section>
      <Section title="Friend activity">
        {value.friendActivity.length === 0 ? (
          <Text style={styles.detail}>No friend activity yet.</Text>
        ) : (
          value.friendActivity.map((friend) => (
            <View key={friend.membershipId} style={styles.row}>
              <Text style={styles.rowLabel}>Group member</Text>
              <Text style={styles.rowValue}>
                {friend.completedWorkoutCount} / {friend.lockedTarget ?? "—"}
              </Text>
            </View>
          ))
        )}
      </Section>
      <Section title="Season standings">
        {value.seasonStandings.length === 0 ? (
          <Text style={styles.detail}>No current standings yet.</Text>
        ) : (
          value.seasonStandings.map((standing) => (
            <View key={standing.membershipId} style={styles.row}>
              <Text style={styles.rowLabel}>
                {standing.rank}.{" "}
                {standing.membershipId === value.membershipId
                  ? "You"
                  : "Group member"}
              </Text>
              <Text style={styles.rowValue}>{standing.crowns} Crowns</Text>
            </View>
          ))
        )}
      </Section>
    </>
  );
}

export default function Home() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [state, dispatch] = useReducer(
    reduceMemberReadState<MemberHomeResult>,
    initialState,
  );
  const load = useCallback(async () => {
    dispatch({ type: "load" });
    const pendingTimer = setTimeout(
      () =>
        dispatch({
          type: "pending",
          message: "Still working. You can safely leave Home and return later.",
        }),
      5_000,
    );
    try {
      const auth = createLocalMobileSupabaseClient();
      const { data, error } = await auth.auth.getSession();
      if (error || !data.session) {
        dispatch({
          type: "denied",
          message: "Sign in with a current Group membership to view Home.",
        });
        return;
      }
      const api = createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      });
      const value = (
        await api.getMemberHome({
          authorization: `Bearer ${data.session.access_token}`,
        })
      ).data;
      const empty =
        value.accountabilityWeekId === null &&
        value.friendActivity.length === 0 &&
        value.seasonStandings.length === 0;
      dispatch(
        empty
          ? {
              type: "empty",
              message: "Home has no current week or Group activity yet.",
            }
          : { type: "loaded", value },
      );
    } catch (error) {
      const event: MemberReadEvent<MemberHomeResult> =
        error instanceof MobileApiClientError &&
        (error.status === 401 || error.status === 403)
          ? { type: "denied", message: "Current Group membership required." }
          : error instanceof MobileApiClientError && error.status === 409
            ? {
                type: "conflict",
                message: "Home changed. Review current state.",
              }
            : {
                type: "failure",
                message: "Could not refresh Home.",
                retryable: true,
              };
      dispatch(event);
    } finally {
      clearTimeout(pendingTimer);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  let content: ReactNode;
  if (state.status === "loading")
    content = (
      <View accessible={false} style={styles.loading}>
        <ActivityIndicator color="#E8FF00" />
        <Text style={styles.detail}>Loading Home…</Text>
      </View>
    );
  else if (state.status === "ready")
    content = (
      <>
        <MemberHome value={state.value} />
        {state.staleAt ? (
          <StateMessage
            message={`Showing stale data from ${state.staleAt}. Refresh when online.`}
            retry={load}
          />
        ) : null}
      </>
    );
  else if (state.status === "failure")
    content = (
      <StateMessage
        message={state.message}
        retry={state.retryable ? load : undefined}
      />
    );
  else content = <StateMessage message={state.message} />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {notice ? (
        <StateMessage message="No longer available. Returned safely to Home." />
      ) : null}
      <Text style={styles.eyebrow}>EVERY REP COUNTS.</Text>
      <Text accessibilityRole="header" style={styles.title}>
        This week
      </Text>
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#171717", flexGrow: 1, gap: 16, padding: 20 },
  eyebrow: {
    color: "#E8FF00",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { color: "#FAFAF5", fontSize: 34, fontWeight: "900" },
  loading: { alignItems: "center", gap: 12, paddingVertical: 48 },
  section: {
    backgroundColor: "#232323",
    borderColor: "#444",
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  sectionTitle: {
    color: "#E8FF00",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  needsYou: {
    color: "#FAFAF5",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
  },
  metric: { color: "#FAFAF5", fontSize: 28, fontWeight: "800" },
  detail: { color: "#C8C8C0", fontSize: 16, lineHeight: 22 },
  row: {
    alignItems: "center",
    borderTopColor: "#444",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingVertical: 10,
  },
  rowLabel: { color: "#FAFAF5", flex: 1, fontSize: 16 },
  rowValue: { color: "#E8FF00", fontSize: 16, fontWeight: "700" },
  stateCard: {
    backgroundColor: "#2B2B2B",
    borderLeftColor: "#E8FF00",
    borderLeftWidth: 4,
    gap: 12,
    padding: 16,
  },
  stateText: { color: "#FAFAF5", fontSize: 16, lineHeight: 22 },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#FAFAF5",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: "#FAFAF5", fontSize: 16, fontWeight: "700" },
});
