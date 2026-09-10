import * as SecureStore from "expo-secure-store";
import {
  createMobileSupabaseClient,
  createSecureSessionStorage,
  readMobileSupabaseConfig,
} from "./supabase";

export function createLocalMobileSupabaseClient() {
  return createMobileSupabaseClient(
    readMobileSupabaseConfig(process.env),
    createSecureSessionStorage(SecureStore),
  );
}
