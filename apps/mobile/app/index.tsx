import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { focusAccessibleText } from "../src/accessibility";
import {
  observeMobileSession,
  requestEmailOtp,
  resolveMobileSessionAccess,
  verifyEmailOtp,
} from "../src/auth";
import {
  authEntryReducer,
  initialAuthEntryState,
  MAX_EMAIL_INPUT_LENGTH,
  MAX_OTP_INPUT_LENGTH,
} from "../src/auth-entry-state";
import { FormAction } from "../src/FormAction";
import { KeyboardAwareScreen } from "../src/KeyboardAwareScreen";
import { createLocalMobileSupabaseClient } from "../src/native-supabase";

export default function Index() {
  const router = useRouter();
  const [state, dispatch] = useReducer(authEntryReducer, initialAuthEntryState);
  const [client] = useState(() => {
    try {
      return createLocalMobileSupabaseClient();
    } catch {
      return undefined;
    }
  });
  const errorSummary = useRef<Text>(null);
  const screenTitle = useRef<Text>(null);
  const previousScreen = useRef(state.screen);

  useEffect(() => {
    if (!client) {
      dispatch({ type: "session", session: { status: "failure" } });
      return;
    }
    const observer = observeMobileSession({
      client,
      resolveAccess: (session) => resolveMobileSessionAccess(client, session),
      onChange: (session) => dispatch({ type: "session", session }),
    });
    return observer.stop;
  }, [client]);

  useEffect(() => {
    if (state.screen === "launch" && state.session.status === "signed-in") {
      router.replace("/home");
    }
  }, [router, state]);

  useEffect(() => {
    if (state.screen !== "launch" && state.error)
      focusAccessibleText(errorSummary.current);
  }, [state.error, state.screen]);

  useEffect(() => {
    if (
      state.screen !== previousScreen.current &&
      state.screen !== "launch" &&
      !state.error
    )
      focusAccessibleText(screenTitle.current);
    previousScreen.current = state.screen;
  }, [state.error, state.screen]);

  async function sendCode() {
    if (!client || state.screen !== "request" || state.busy) return;
    dispatch({ type: "request-start" });
    try {
      await requestEmailOtp(client, state.email);
      dispatch({ type: "request-success" });
    } catch (error) {
      dispatch({ type: "request-failure", error });
    }
  }

  async function verifyCode() {
    if (!client || state.screen !== "verify" || state.busy) return;
    dispatch({ type: "verify-start" });
    try {
      await verifyEmailOtp(client, { email: state.email, token: state.code });
      router.replace("/home");
    } catch (error) {
      dispatch({ type: "verify-failure", error });
    }
  }

  let content: ReactNode;
  if (state.screen === "launch") {
    const copy = {
      checking: ["Checking session", "Restoring secure account access."],
      "signed-out": [
        "Sign in",
        "Use the email address from your Group invitation.",
      ],
      "signed-in": ["Session restored", "Opening your member home."],
      revoked: [
        "Access revoked",
        "This session no longer has access. Sign in again with an invited email.",
      ],
      "service-unavailable": [
        "Service unavailable",
        "Authentication is temporarily unavailable. Try again.",
      ],
      failure: [
        "Could not restore session",
        "Try again. No account information was changed.",
      ],
    }[state.session.status];
    content = (
      <View accessibilityLiveRegion="polite" style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>
          {copy[0]}
        </Text>
        <Text style={styles.body}>{copy[1]}</Text>
        {state.session.status === "checking" ||
        state.session.status === "signed-in" ? (
          <ActivityIndicator
            accessibilityLabel={copy[0]}
            color="#FFD400"
            size="large"
          />
        ) : (
          <FormAction
            label="Continue to sign in"
            onPress={() => dispatch({ type: "open-request" })}
          />
        )}
      </View>
    );
  } else if (state.screen === "request") {
    content = (
      <View style={styles.panel}>
        <Text ref={screenTitle} accessibilityRole="header" style={styles.title}>
          Sign in
        </Text>
        <Text style={styles.body}>
          Enter email address from your Group invitation. We will send a
          six-digit code if it is eligible.
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
        <Text style={styles.label}>Email address</Text>
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!state.busy}
          keyboardType="email-address"
          maxLength={MAX_EMAIL_INPUT_LENGTH}
          onChangeText={(email) => dispatch({ type: "edit-email", email })}
          style={[styles.input, state.error && styles.inputError]}
          value={state.email}
        />
        {state.error ? (
          <Text style={styles.inlineError}>Email address: {state.error}</Text>
        ) : null}
        <FormAction
          label={state.busy ? "Sending code…" : "Send code"}
          disabled={state.busy}
          onPress={sendCode}
        />
      </View>
    );
  } else {
    content = (
      <View style={styles.panel}>
        <Text ref={screenTitle} accessibilityRole="header" style={styles.title}>
          Enter your code
        </Text>
        <Text style={styles.body}>
          Code sent to {state.email}. Enter all six digits. You can request
          another code after 60 seconds.
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
        <Text style={styles.label}>Six-digit code</Text>
        <TextInput
          accessibilityLabel="Six-digit code"
          autoComplete="one-time-code"
          editable={!state.busy}
          keyboardType="number-pad"
          maxLength={MAX_OTP_INPUT_LENGTH}
          onChangeText={(code) => dispatch({ type: "edit-code", code })}
          style={[styles.input, state.error && styles.inputError]}
          value={state.code}
        />
        {state.error ? (
          <Text style={styles.inlineError}>Six-digit code: {state.error}</Text>
        ) : null}
        <FormAction
          label={state.busy ? "Verifying…" : "Verify code"}
          disabled={state.busy}
          onPress={verifyCode}
        />
        <FormAction
          label="Use a different email"
          disabled={state.busy}
          onPress={() => dispatch({ type: "back-to-email" })}
          secondary
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScreen contentContainerStyle={styles.container}>
        {content}
      </KeyboardAwareScreen>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#0A0A0A", flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: 20 },
  panel: { alignSelf: "center", gap: 12, maxWidth: 520, width: "100%" },
  title: {
    color: "#E8E8E8",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0.4,
    lineHeight: 44,
    textTransform: "uppercase",
  },
  body: { color: "#E8E8E8", fontSize: 17, lineHeight: 26, marginBottom: 12 },
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
  inputError: { borderColor: "#FF8A80", borderWidth: 2 },
  error: {
    borderColor: "#FF8A80",
    borderLeftWidth: 4,
    color: "#E8E8E8",
    fontSize: 16,
    lineHeight: 24,
    padding: 12,
  },
  inlineError: { color: "#FFB4AB", fontSize: 15, lineHeight: 22 },
});
