import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { readMobileApiBaseUrl } from "../../../src/api-client";
import { FormAction } from "../../../src/FormAction";
import { createLocalMobileSupabaseClient } from "../../../src/native-supabase";
import {
  createOperatorCardsClient,
  MAX_VOID_REASON_LENGTH,
  OperatorCardsError,
  type OwedCard,
  owedLabel,
  validVoidReason,
  voidConfirmBody,
} from "../../../src/operator-cards";

async function client() {
  const auth = createLocalMobileSupabaseClient();
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) throw new Error("Session unavailable");
  return createOperatorCardsClient({
    baseUrl: readMobileApiBaseUrl(process.env),
    authorization: `Bearer ${data.session.access_token}`,
  });
}

const message = (error: unknown) =>
  error instanceof OperatorCardsError
    ? error.message
    : "Action failed. Try again.";

const confirmVoid = (card: OwedCard) =>
  new Promise<boolean>((resolve) =>
    Alert.alert("Remove this card?", voidConfirmBody(card), [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "Remove card",
        style: "destructive",
        onPress: () => resolve(true),
      },
    ]),
  );

// Operator work queue: owed Consequence cards an operator may void, one at a time.
export default function Work() {
  const [cards, setCards] = useState<OwedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCards(await (await client()).load());
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(card: OwedCard) {
    const reason = reasons[card.obligationId] ?? "";
    if (!validVoidReason(reason) || !(await confirmVoid(card))) return;
    // Destructive: the acting control waits for the server.
    setBusy(card.obligationId);
    try {
      setCards(await (await client()).void(card.obligationId, reason));
      setNotice(`Card removed from ${card.member}.`);
      setError(null);
    } catch (failure) {
      setNotice(null);
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Owed cards
      </Text>
      <Text style={styles.hint}>
        Remove a wrongly assigned, unsafe, or broken card. The member owes one
        fewer; the next owed card is offered as usual.
      </Text>
      {notice && <Text accessibilityLiveRegion="polite">{notice}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {cards === null && !error && <Text>Loading…</Text>}
      {cards?.length === 0 && (
        <Text style={styles.hint}>Nobody owes a card.</Text>
      )}
      {cards?.map((card) => {
        const reason = reasons[card.obligationId] ?? "";
        return (
          <View key={card.obligationId} style={styles.card}>
            <Text style={styles.cardTitle}>
              {card.member} · {card.card ?? "No card picked yet"}
            </Text>
            <Text style={styles.hint}>
              {card.group} · {owedLabel[card.reason]}
            </Text>
            <TextInput
              accessibilityLabel={`Why remove ${card.member}’s card`}
              placeholder="Reason"
              placeholderTextColor="#8A8A8A"
              maxLength={MAX_VOID_REASON_LENGTH}
              value={reason}
              editable={busy === null}
              onChangeText={(text) =>
                setReasons((current) => ({
                  ...current,
                  [card.obligationId]: text,
                }))
              }
              style={styles.input}
            />
            <FormAction
              secondary
              label={busy === card.obligationId ? "Removing…" : "Remove card"}
              disabled={busy !== null || !validVoidReason(reason)}
              onPress={() => void remove(card)}
            />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: "700" },
  hint: { color: "#8A8A8A" },
  error: { color: "#FF5A5A" },
  card: { borderColor: "#333", borderTopWidth: 1, gap: 8, paddingTop: 12 },
  cardTitle: { fontSize: 17, fontWeight: "700" },
  input: {
    borderColor: "#555",
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
});
