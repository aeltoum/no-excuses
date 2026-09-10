import { useRouter } from "expo-router";
import { type ReactNode, useEffect, useReducer, useRef } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  createMobileApiClient,
  readMobileApiBaseUrl,
} from "../../src/api-client";
import { FormAction } from "../../src/FormAction";
import {
  buildGroupSubmission,
  groupEntryReducer,
  initialGroupEntryState,
  MAX_GROUP_NAME_LENGTH,
  MAX_INVITATION_TOKEN_LENGTH,
  MAX_TARGET_INPUT_LENGTH,
  MAX_TIME_ZONE_LENGTH,
} from "../../src/group-entry-state";
import { createLocalMobileSupabaseClient } from "../../src/native-supabase";

function Field({
  label,
  value,
  onChangeText,
  maxLength,
  numeric = false,
  disabled = false,
}: Readonly<{
  label: string;
  value: string;
  onChangeText(value: string): void;
  maxLength: number;
  numeric?: boolean;
  disabled?: boolean;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        keyboardType={numeric ? "number-pad" : "default"}
        maxLength={maxLength}
        onChangeText={onChangeText}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

export default function Group() {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    groupEntryReducer,
    initialGroupEntryState,
  );
  const errorSummary = useRef<Text>(null);
  const submitting = useRef(false);
  const submissionIds = useRef<
    | {
        idempotencyKey: string;
        membershipId: string;
        groupId?: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    if (state.screen === "success") router.replace("/home");
  }, [router, state]);

  useEffect(() => {
    if ((state.screen === "create" || state.screen === "join") && state.error) {
      errorSummary.current?.focus();
    }
  }, [state]);

  async function submit() {
    if (
      (state.screen !== "create" && state.screen !== "join") ||
      state.busy ||
      submitting.current
    )
      return;
    submitting.current = true;
    dispatch({ type: "submit-start" });
    try {
      if (!globalThis.crypto?.randomUUID)
        throw new Error("Secure identifier generation unavailable");
      submissionIds.current ??= {
        idempotencyKey: globalThis.crypto.randomUUID(),
        membershipId: globalThis.crypto.randomUUID(),
        groupId:
          state.screen === "create"
            ? globalThis.crypto.randomUUID()
            : undefined,
      };
      const submission = buildGroupSubmission(state, submissionIds.current);
      const auth = createLocalMobileSupabaseClient();
      const { data, error } = await auth.auth.getSession();
      if (error || !data.session) throw new Error("Session unavailable");
      const api = createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      });
      const result =
        submission.kind === "create"
          ? await api.createGroup({
              authorization: `Bearer ${data.session.access_token}`,
              idempotencyKey: submission.idempotencyKey,
              body: submission.body,
            })
          : await api.acceptGroupInvitation({
              authorization: `Bearer ${data.session.access_token}`,
              idempotencyKey: submission.idempotencyKey,
              body: submission.body,
            });
      dispatch({
        type: "submit-success",
        membershipId: result.data.membershipId,
      });
    } catch (error) {
      submitting.current = false;
      dispatch({ type: "submit-failure", error });
    }
  }

  const edit = (field: string) => (value: string) => {
    submissionIds.current = undefined;
    dispatch({ type: "edit", field, value });
  };

  const back = () => {
    submissionIds.current = undefined;
    dispatch({ type: "back" });
  };

  let content: ReactNode;
  if (state.screen === "choice") {
    content = (
      <>
        <Text accessibilityRole="header" style={styles.title}>
          Train together.
        </Text>
        <Text style={styles.body}>
          Create a private Group or join friends using an invitation token.
        </Text>
        <FormAction
          label="Create Group"
          onPress={() =>
            dispatch({
              type: "choose-create",
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
          }
        />
        <FormAction
          label="Join Group"
          onPress={() => dispatch({ type: "choose-join" })}
          secondary
        />
      </>
    );
  } else if (state.screen === "success") {
    content = (
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        Group membership confirmed. Opening Home.
      </Text>
    );
  } else {
    const create = state.screen === "create";
    content = (
      <>
        <Text accessibilityRole="header" style={styles.title}>
          {create ? "Create Group" : "Join Group"}
        </Text>
        <Text style={styles.body}>
          {create
            ? "Set Group basics and your first Weekly target."
            : "Set your recurring and reduced joining-week targets before accepting."}
        </Text>
        {state.error ? (
          <Text
            ref={errorSummary}
            accessible
            accessibilityRole="alert"
            style={styles.error}
          >
            There is a problem. {state.error}
          </Text>
        ) : null}
        {create ? (
          <>
            <Field
              label="Group name"
              value={state.name}
              onChangeText={edit("name")}
              maxLength={MAX_GROUP_NAME_LENGTH}
              disabled={state.busy}
            />
            <Field
              label="Group time zone"
              value={state.timeZone}
              onChangeText={edit("timeZone")}
              maxLength={MAX_TIME_ZONE_LENGTH}
              disabled={state.busy}
            />
            <Field
              label="Weekly target"
              value={state.weeklyTarget}
              onChangeText={edit("weeklyTarget")}
              maxLength={MAX_TARGET_INPUT_LENGTH}
              numeric
              disabled={state.busy}
            />
          </>
        ) : (
          <>
            <Field
              label="Invitation token"
              value={state.token}
              onChangeText={edit("token")}
              maxLength={MAX_INVITATION_TOKEN_LENGTH}
              disabled={state.busy}
            />
            <Field
              label="Recurring Weekly target"
              value={state.recurringTarget}
              onChangeText={edit("recurringTarget")}
              maxLength={MAX_TARGET_INPUT_LENGTH}
              numeric
              disabled={state.busy}
            />
            <Field
              label="Joining-week target"
              value={state.currentTarget}
              onChangeText={edit("currentTarget")}
              maxLength={MAX_TARGET_INPUT_LENGTH}
              numeric
              disabled={state.busy}
            />
          </>
        )}
        <FormAction
          label={
            state.busy ? "Submitting…" : create ? "Create Group" : "Join Group"
          }
          onPress={submit}
          disabled={state.busy}
        />
        <FormAction
          label="Back"
          onPress={back}
          disabled={state.busy}
          secondary
        />
      </>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.panel}>{content}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0A0A0A",
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  panel: { alignSelf: "center", gap: 12, maxWidth: 520, width: "100%" },
  title: {
    color: "#E8E8E8",
    fontSize: 40,
    fontWeight: "900",
    lineHeight: 44,
    textTransform: "uppercase",
  },
  body: { color: "#E8E8E8", fontSize: 17, lineHeight: 26, marginBottom: 12 },
  field: { gap: 6 },
  label: { color: "#E8E8E8", fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: "#111111",
    borderColor: "#898989",
    borderWidth: 1,
    color: "#E8E8E8",
    fontSize: 18,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  error: {
    borderColor: "#FF8A80",
    borderLeftWidth: 4,
    color: "#E8E8E8",
    fontSize: 16,
    lineHeight: 24,
    padding: 12,
  },
});
