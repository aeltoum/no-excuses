import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  createMobileApiClient,
  MobileApiClientError,
  readMobileApiBaseUrl,
} from "../../src/api-client";
import { FormAction } from "../../src/FormAction";
import { createLocalMobileSupabaseClient } from "../../src/native-supabase";

export default function You() {
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const idempotencyKey = useRef<string>();

  async function removeAccount() {
    if (busy) return;
    setBusy(true);
    setStatus("Deleting Account…");
    const timer = setTimeout(
      () =>
        setStatus(
          "Deletion still pending. Retry is safe if result is unclear.",
        ),
      5_000,
    );
    try {
      if (!globalThis.crypto?.randomUUID) throw new Error("UUID unavailable");
      idempotencyKey.current ??= globalThis.crypto.randomUUID();
      const { data, error } =
        await createLocalMobileSupabaseClient().auth.getSession();
      if (error || !data.session) throw new Error("Session unavailable");
      await createMobileApiClient({
        baseUrl: readMobileApiBaseUrl(process.env),
      }).deleteAccount({
        authorization: `Bearer ${data.session.access_token}`,
        idempotencyKey: idempotencyKey.current,
        body: { confirmation: true },
      });
      idempotencyKey.current = undefined;
      setDeleted(true);
      setStatus(undefined);
    } catch (error) {
      const definitive =
        error instanceof MobileApiClientError &&
        (error.status === 400 ||
          error.status === 401 ||
          error.status === 403 ||
          error.status === 409);
      if (definitive) idempotencyKey.current = undefined;
      setStatus(
        definitive
          ? "Account was not deleted. Review current access before trying again."
          : "Could not confirm deletion. Try again to safely retry same request.",
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        You
      </Text>
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.heading}>
          Account deletion
        </Text>
        {deleted ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.body}>
              Account deleted. Membership ended; personal identifiers removed.
            </Text>
            <Text style={styles.receipt}>Deletion completed.</Text>
          </>
        ) : reviewing ? (
          <>
            <Text style={styles.body}>
              This permanently ends Group membership and removes personal
              account identifiers. Finalized Group history remains
              de-identified.
            </Text>
            <FormAction
              disabled={busy}
              label={busy ? "Deleting…" : "Confirm Account deletion"}
              onPress={() => void removeAccount()}
            />
            <FormAction
              disabled={busy}
              label="Cancel"
              onPress={() => {
                idempotencyKey.current = undefined;
                setReviewing(false);
                setStatus(undefined);
              }}
              secondary
            />
            {status ? (
              <Text accessibilityLiveRegion="polite" style={styles.status}>
                {status}
              </Text>
            ) : null}
          </>
        ) : (
          <FormAction
            label="Review Account deletion"
            onPress={() => setReviewing(true)}
            secondary
          />
        )}
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
  status: { color: "#FAFAF5", fontSize: 15, lineHeight: 22 },
  receipt: { color: "#C8C8C0", fontSize: 14 },
});
