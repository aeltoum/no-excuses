import type { MemberHomeResult } from "@no-excuses/contracts";
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
import { FormAction } from "../../src/FormAction";
import { readCachedHome, writeCachedHome } from "../../src/home-cache";
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

type SocialKind = "reaction" | "message";
type SocialActionState = Readonly<{
  kind: SocialKind;
  status: "loading" | "pending" | "success" | "error" | "conflict" | "denied";
}>;
type SocialCommandIdentity = Readonly<{
  interactionId: string;
  idempotencyKey: string;
}>;

function SocialActions({
  recipientMembershipId,
}: Readonly<{ recipientMembershipId: string }>) {
  const [state, setState] = useState<SocialActionState>();
  const commandIdentities = useRef<
    Partial<Record<SocialKind, SocialCommandIdentity>>
  >({});

  const send = useCallback(
    async (kind: SocialKind) => {
      setState({ kind, status: "loading" });
      const pendingTimer = setTimeout(
        () => setState({ kind, status: "pending" }),
        5_000,
      );
      try {
        const auth = createLocalMobileSupabaseClient();
        const { data, error } = await auth.auth.getSession();
        if (error || !data.session) {
          delete commandIdentities.current[kind];
          setState({ kind, status: "denied" });
          return;
        }
        if (!globalThis.crypto?.randomUUID) throw new Error("UUID unavailable");
        let identity = commandIdentities.current[kind];
        if (!identity) {
          identity = {
            interactionId: globalThis.crypto.randomUUID(),
            idempotencyKey: globalThis.crypto.randomUUID(),
          };
          commandIdentities.current[kind] = identity;
        }
        const api = createMobileApiClient({
          baseUrl: readMobileApiBaseUrl(process.env),
        });
        await api.createSocialInteraction({
          authorization: `Bearer ${data.session.access_token}`,
          idempotencyKey: identity.idempotencyKey,
          body: {
            interactionId: identity.interactionId,
            recipientMembershipId,
            kind,
            body: kind === "reaction" ? "strong" : "You've got this.",
          },
        });
        delete commandIdentities.current[kind];
        setState({ kind, status: "success" });
      } catch (error) {
        const definitive =
          error instanceof MobileApiClientError &&
          (error.status === 401 ||
            error.status === 403 ||
            error.status === 409);
        if (definitive) delete commandIdentities.current[kind];
        setState({
          kind,
          status:
            error instanceof MobileApiClientError &&
            (error.status === 401 || error.status === 403)
              ? "denied"
              : error instanceof MobileApiClientError && error.status === 409
                ? "conflict"
                : "error",
        });
      } finally {
        clearTimeout(pendingTimer);
      }
    },
    [recipientMembershipId],
  );

  const busy = state?.status === "loading" || state?.status === "pending";
  const message =
    state?.status === "loading"
      ? "Sending…"
      : state?.status === "pending"
        ? "Still sending. You can safely leave Home."
        : state?.status === "success"
          ? state.kind === "reaction"
            ? "Reaction sent."
            : "Motivation sent."
          : state?.status === "denied"
            ? "Current Group membership required."
            : state?.status === "conflict"
              ? "Action changed. Review and try again."
              : state?.status === "error"
                ? "Could not send. Try again."
                : undefined;

  return (
    <View style={styles.socialActions}>
      <FormAction
        disabled={busy}
        label="Send strong reaction"
        onPress={() => void send("reaction")}
        secondary
      />
      <FormAction
        disabled={busy}
        label="Send motivation"
        onPress={() => void send("message")}
        secondary
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.actionStatus}>
          {message}
        </Text>
      ) : null}
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
            <View key={friend.membershipId} style={styles.friendCard}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Group member</Text>
                <Text style={styles.rowValue}>
                  {friend.completedWorkoutCount} / {friend.lockedTarget ?? "—"}
                </Text>
              </View>
              <SocialActions recipientMembershipId={friend.membershipId} />
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
    let accountId: string | undefined;
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
      accountId = data.session.user.id;
      const api = createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      });
      const value = (
        await api.getMemberHome({
          authorization: `Bearer ${data.session.access_token}`,
        })
      ).data;
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
        <MemberHome value={state.value} />
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
  friendCard: { gap: 8 },
  socialActions: { gap: 8 },
  actionStatus: { color: "#C8C8C0", fontSize: 14, lineHeight: 20 },
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
