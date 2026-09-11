import type {
  NotificationCenterResult,
  NotificationOpenResult,
} from "@no-excuses/contracts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import {
  readCachedNotifications,
  writeCachedNotifications,
} from "../../src/notification-cache";

const initialState: MemberReadState<NotificationCenterResult> = {
  status: "loading",
};

const notificationLabels: Readonly<Record<string, string>> = {
  deadline_due: "An accountability action needs you.",
  generic: "Your accountability status changed.",
  social_response: "New friend activity is waiting.",
};

function StateMessage({
  message,
  retry,
}: Readonly<{ message: string; retry?: () => void }>) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.stateCard}>
      <Text style={styles.detail}>{message}</Text>
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

function NotificationGroup({
  title,
  items,
  open,
}: Readonly<{
  title: string;
  items: NotificationCenterResult["unread"];
  open: (notificationId: string) => void;
}>) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {items.length === 0 ? (
        <Text style={styles.detail}>None.</Text>
      ) : (
        items.map((item) => (
          <Pressable
            accessibilityHint="Opens current authorized destination"
            accessibilityRole="button"
            key={item.notificationId}
            onPress={() => open(item.notificationId)}
            style={styles.item}
          >
            <Text style={styles.itemText}>
              {notificationLabels[item.templateKey] ??
                "Your accountability status changed."}
            </Text>
            <Text style={styles.itemMeta}>{item.createdAt}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

export default function Notifications() {
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const [state, dispatch] = useReducer(
    reduceMemberReadState<NotificationCenterResult>,
    initialState,
  );

  const authorizedClient = useCallback(async () => {
    const auth = createLocalMobileSupabaseClient();
    const { data, error } = await auth.auth.getSession();
    if (error || !data.session) throw new Error("session_required");
    return {
      authorization: `Bearer ${data.session.access_token}`,
      accountId: data.session.user.id,
      api: createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      }),
    };
  }, []);

  const load = useCallback(async () => {
    dispatch({ type: "load" });
    let accountId: string | undefined;
    const pendingTimer = setTimeout(
      () =>
        dispatch({
          type: "pending",
          message:
            "Still working. You can safely leave Notifications and return later.",
        }),
      5_000,
    );
    try {
      const authorized = await authorizedClient();
      accountId = authorized.accountId;
      const { api, authorization } = authorized;
      const value = (await api.getNotifications({ authorization })).data;
      void writeCachedNotifications(
        AsyncStorage,
        accountId,
        value,
        new Date().toISOString(),
      ).catch(() => undefined);
      dispatch(
        value.unread.length === 0 && value.read.length === 0
          ? {
              type: "empty",
              message: "No current notifications.",
            }
          : { type: "loaded", value },
      );
    } catch (error) {
      if (error instanceof MobileApiClientError && error.kind === "network") {
        const cached = accountId
          ? await readCachedNotifications(AsyncStorage, accountId)
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
      const event: MemberReadEvent<NotificationCenterResult> =
        (!(error instanceof MobileApiClientError) &&
          error instanceof Error &&
          error.message === "session_required") ||
        (error instanceof MobileApiClientError &&
          (error.status === 401 || error.status === 403))
          ? {
              type: "denied",
              message:
                "Sign in with a current Group membership to view Notifications.",
            }
          : error instanceof MobileApiClientError && error.status === 409
            ? {
                type: "conflict",
                message: "Notifications changed. Review current state.",
              }
            : {
                type: "failure",
                message: "Could not refresh Notifications.",
                retryable: true,
              };
      dispatch(event);
    } finally {
      clearTimeout(pendingTimer);
    }
  }, [authorizedClient]);

  const open = useCallback(
    async (notificationId: string) => {
      try {
        const { api, authorization } = await authorizedClient();
        const destination: NotificationOpenResult = (
          await api.openNotification({ authorization, notificationId })
        ).data;
        router.replace(destination.route);
      } catch {
        router.replace("/home?notice=unavailable");
      }
    },
    [authorizedClient, router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  let content: ReactNode;
  if (state.status === "loading")
    content = (
      <View accessible={false} style={styles.loading}>
        <ActivityIndicator color="#E8FF00" />
        <Text style={styles.detail}>Loading Notifications…</Text>
      </View>
    );
  else if (state.status === "ready")
    content = (
      <>
        <NotificationGroup
          title="Unread"
          items={state.value.unread}
          open={open}
        />
        <NotificationGroup title="Read" items={state.value.read} open={open} />
        {state.staleAt ? (
          <StateMessage
            message={`Offline. Showing Notifications saved ${state.staleAt}. Refresh when online.`}
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
      <Text style={styles.eyebrow}>NEEDS YOU. THEN UPDATES.</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Notifications
      </Text>
      {notice ? (
        <StateMessage message="That notification is no longer current. Showing Notifications safely." />
      ) : null}
      <Text style={styles.detail}>
        In-app status stays available even when device notifications are off.
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
  item: {
    borderColor: "#555",
    borderTopWidth: 1,
    gap: 5,
    paddingVertical: 14,
  },
  itemText: { color: "#FAFAF5", fontSize: 17, fontWeight: "700" },
  itemMeta: { color: "#B8B8B2", fontSize: 12 },
  detail: { color: "#D6D6CF", fontSize: 15, lineHeight: 21 },
  stateCard: {
    backgroundColor: "#232323",
    borderColor: "#555",
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    borderColor: "#E8FF00",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  secondaryButtonText: { color: "#E8FF00", fontWeight: "800" },
});
