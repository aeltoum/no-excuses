import type {
  CurrentWeekProgressItem,
  FinalizedWeeklyHistoryItem,
  MemberHomeResult,
} from "@no-excuses/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { focusAccessibleText } from "../../src/accessibility";
import {
  createMobileApiClient,
  MobileApiClientError,
  readMobileApiBaseUrl,
} from "../../src/api-client";
import { FormAction } from "../../src/FormAction";
import { readCachedHome, writeCachedHome } from "../../src/home-cache";
import { KeyboardAwareScreen } from "../../src/KeyboardAwareScreen";
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

type CommandIdentity = Readonly<{
  idempotencyKey: string;
  resourceId?: string;
  occurredAt?: string;
}>;

function MemberHome({
  value,
  progress,
  history,
  onRefresh,
}: Readonly<{
  value: MemberHomeResult;
  progress: readonly CurrentWeekProgressItem[];
  history: readonly FinalizedWeeklyHistoryItem[];
  onRefresh(): Promise<void>;
}>) {
  const [target, setTarget] = useState(String(value.lockedTarget ?? ""));
  const [activityType, setActivityType] = useState("strength");
  const [duration, setDuration] = useState("30");
  const [intensity, setIntensity] = useState("moderate");
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const targetIdentity = useRef<CommandIdentity>();
  const workoutIdentity = useRef<CommandIdentity>();
  const actionStatus = useRef<Text>(null);

  useEffect(() => {
    if (status && !busy) focusAccessibleText(actionStatus.current);
  }, [busy, status]);

  async function authorization() {
    const { data, error } =
      await createLocalMobileSupabaseClient().auth.getSession();
    if (error || !data.session) throw new Error("Session unavailable");
    return `Bearer ${data.session.access_token}`;
  }

  async function runCommand(
    kind: "target" | "workout",
    execute: (
      authorization: string,
      identity: CommandIdentity,
    ) => Promise<void>,
  ) {
    if (busy) return;
    setBusy(true);
    setStatus("Submitting…");
    const timer = setTimeout(
      () => setStatus("Still submitting. Retry is safe if result is unclear."),
      5_000,
    );
    const identityRef = kind === "target" ? targetIdentity : workoutIdentity;
    try {
      if (!globalThis.crypto?.randomUUID) throw new Error("UUID unavailable");
      identityRef.current ??= {
        idempotencyKey: globalThis.crypto.randomUUID(),
        resourceId:
          kind === "workout" ? globalThis.crypto.randomUUID() : undefined,
        occurredAt: kind === "workout" ? new Date().toISOString() : undefined,
      };
      await execute(await authorization(), identityRef.current);
      identityRef.current = undefined;
      setStatus(
        kind === "target" ? "Weekly target saved." : "Workout counted.",
      );
      void onRefresh().catch(() => undefined);
    } catch (error) {
      const definitive =
        error instanceof MobileApiClientError &&
        (error.status === 400 ||
          error.status === 401 ||
          error.status === 403 ||
          error.status === 409);
      if (definitive) identityRef.current = undefined;
      setStatus(
        definitive
          ? "Request was not accepted. Review current values."
          : "Could not confirm result. Try again to safely retry same command.",
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  const api = () =>
    createMobileApiClient({ baseUrl: readMobileApiBaseUrl(process.env) });
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
        <Text style={styles.inputLabel}>Weekly target</Text>
        <TextInput
          accessibilityLabel="Weekly target"
          editable={!busy}
          keyboardType="number-pad"
          onChangeText={(next) => {
            targetIdentity.current = undefined;
            setTarget(next);
          }}
          style={styles.input}
          value={target}
        />
        <Text style={styles.inputHelp}>Enter a whole number of 1 or more.</Text>
        <FormAction
          disabled={
            busy || !Number.isInteger(Number(target)) || Number(target) < 1
          }
          label="Save Weekly target"
          onPress={() =>
            void runCommand("target", async (auth, identity) => {
              await api().setWeeklyTarget({
                authorization: auth,
                idempotencyKey: identity.idempotencyKey,
                body: { weeklyTarget: Number(target) },
              });
            })
          }
        />
      </Section>
      <Section title="Log workout">
        <Text style={styles.detail}>
          Self-reported workouts count immediately.
        </Text>
        <Text style={styles.inputLabel}>Activity type</Text>
        <TextInput
          accessibilityLabel="Activity type"
          editable={!busy}
          onChangeText={(v) => {
            workoutIdentity.current = undefined;
            setActivityType(v);
          }}
          style={styles.input}
          value={activityType}
        />
        <Text style={styles.inputLabel}>Duration in minutes</Text>
        <TextInput
          accessibilityLabel="Duration in minutes"
          editable={!busy}
          keyboardType="number-pad"
          onChangeText={(v) => {
            workoutIdentity.current = undefined;
            setDuration(v);
          }}
          style={styles.input}
          value={duration}
        />
        <Text style={styles.inputLabel}>Perceived intensity</Text>
        <TextInput
          accessibilityLabel="Perceived intensity"
          editable={!busy}
          onChangeText={(v) => {
            workoutIdentity.current = undefined;
            setIntensity(v);
          }}
          style={styles.input}
          value={intensity}
        />
        <Text style={styles.inputHelp}>
          Activity: strength, cardio, class, sport, or mixed. Intensity: low,
          moderate, or high. Duration: whole minutes of 1 or more.
        </Text>
        <FormAction
          disabled={
            busy ||
            !["strength", "cardio", "class", "sport", "mixed"].includes(
              activityType,
            ) ||
            !["low", "moderate", "high"].includes(intensity) ||
            !Number.isInteger(Number(duration)) ||
            Number(duration) < 1
          }
          label="Attest and count workout"
          onPress={() =>
            void runCommand("workout", async (auth, identity) => {
              await api().submitWorkoutCheckin({
                authorization: auth,
                idempotencyKey: identity.idempotencyKey,
                body: {
                  workoutCheckinId: identity.resourceId as string,
                  activityType: activityType as
                    | "strength"
                    | "cardio"
                    | "class"
                    | "sport"
                    | "mixed",
                  completedAt: identity.occurredAt as string,
                  durationMinutes: Number(duration),
                  perceivedIntensity: intensity as "low" | "moderate" | "high",
                  selfReportAttested: true,
                },
              });
            })
          }
        />
        {status ? (
          <Text
            ref={actionStatus}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityRole="summary"
            style={styles.actionStatus}
          >
            {status}
          </Text>
        ) : null}
      </Section>
      <Section title="Group progress">
        {progress.length === 0 ? (
          <Text style={styles.detail}>No current Group progress yet.</Text>
        ) : (
          progress.map((member) => (
            <View key={member.membershipId} style={styles.row}>
              <Text style={styles.rowLabel}>
                {member.membershipId === value.membershipId
                  ? "You"
                  : "Group member"}
              </Text>
              <Text style={styles.rowValue}>
                {member.completedWorkoutCount} / {member.lockedTarget}
              </Text>
            </View>
          ))
        )}
      </Section>
      <Section title="Weekly history">
        {history.length === 0 ? (
          <Text style={styles.detail}>No finalized weeks yet.</Text>
        ) : (
          history.map((week) => (
            <View
              key={`${week.membershipId}-${week.startsAt}`}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>
                {week.membershipId === value.membershipId
                  ? "You"
                  : "Group member"}{" "}
                · {new Date(week.startsAt).toLocaleDateString()}
              </Text>
              <Text style={styles.rowValue}>
                {week.outcome === "attained" ? "Met" : "Missed"} ·{" "}
                {week.completedWorkoutCount}/{week.lockedTarget}
              </Text>
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
  const [progress, setProgress] = useState<readonly CurrentWeekProgressItem[]>(
    [],
  );
  const [history, setHistory] = useState<readonly FinalizedWeeklyHistoryItem[]>(
    [],
  );
  const load = useCallback(async (background = false) => {
    if (!background) dispatch({ type: "load" });
    let accountId: string | undefined;
    const pendingTimer = setTimeout(() => {
      if (!background)
        dispatch({
          type: "pending",
          message: "Still working. You can safely leave Home and return later.",
        });
    }, 5_000);
    try {
      const auth = createLocalMobileSupabaseClient();
      const { data, error } = await auth.auth.getSession();
      if (error || !data.session) {
        if (background) return;
        dispatch({
          type: "denied",
          message: "Sign in with a current Group membership to view Home.",
        });
        return;
      }
      accountId = data.session.user.id;
      const api = createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      });
      const value = (
        await api.getMemberHome({
          authorization: `Bearer ${data.session.access_token}`,
        })
      ).data;
      const [progressResult, historyResult] = await Promise.all([
        api.getCurrentWeekProgress({
          authorization: `Bearer ${data.session.access_token}`,
          groupId: value.groupId,
        }),
        api.getFinalizedWeeklyHistory({
          authorization: `Bearer ${data.session.access_token}`,
          groupId: value.groupId,
        }),
      ]);
      setProgress(progressResult.data);
      setHistory(historyResult.data);
      void writeCachedHome(
        AsyncStorage,
        accountId,
        value,
        new Date().toISOString(),
      ).catch(() => undefined);
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
      if (background) return;
      if (error instanceof MobileApiClientError && error.kind === "network") {
        const cached = accountId
          ? await readCachedHome(AsyncStorage, accountId)
          : undefined;
        if (cached) {
          dispatch({
            type: "loaded",
            value: cached.value,
            staleAt: cached.cachedAt,
          });
          return;
        }
      }
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
        <MemberHome
          value={state.value}
          progress={progress}
          history={history}
          onRefresh={() => load(true)}
        />
        {state.staleAt ? (
          <StateMessage
            message={`Offline. Showing Home saved ${state.staleAt}. Refresh when online.`}
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
    <KeyboardAwareScreen contentContainerStyle={styles.container}>
      {notice ? (
        <StateMessage message="No longer available. Returned safely to Home." />
      ) : null}
      <Text style={styles.eyebrow}>EVERY REP COUNTS.</Text>
      <Text accessibilityRole="header" style={styles.title}>
        This week
      </Text>
      {content}
    </KeyboardAwareScreen>
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
    alignItems: "flex-start",
    borderTopColor: "#444",
    borderTopWidth: 1,
    minHeight: 48,
    gap: 6,
    paddingVertical: 10,
  },
  rowLabel: { color: "#FAFAF5", flex: 1, fontSize: 16 },
  rowValue: { color: "#E8FF00", fontSize: 16, fontWeight: "700" },
  inputLabel: { color: "#FAFAF5", fontSize: 16, fontWeight: "700" },
  inputHelp: { color: "#C8C8C0", fontSize: 14, lineHeight: 20 },
  actionStatus: { color: "#C8C8C0", fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: "#171717",
    borderColor: "#898989",
    borderWidth: 1,
    color: "#FAFAF5",
    fontSize: 17,
    minHeight: 48,
    paddingHorizontal: 12,
  },
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
