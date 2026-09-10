import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MAX_PUBLIC_KEY_LENGTH = 4096;

export type MobileSupabaseConfig = Readonly<{
  url: string;
  anonymousKey: string;
}>;

export type SecureStoreApi = Readonly<{
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}>;

export class MobileSupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileSupabaseConfigError";
  }
}

function decodeBase64Url(value: string): string | undefined {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  let bits = 0;
  let bitCount = 0;
  let output = "";
  for (const character of normalized.replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) return undefined;
    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }
  return output;
}

function isPrivilegedKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(decodeBase64Url(payload) ?? "") as {
      role?: unknown;
    };
    return claims.role === "service_role";
  } catch {
    return false;
  }
}

export function readMobileSupabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): MobileSupabaseConfig {
  const urlSource = environment.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonymousKey = environment.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!urlSource || !anonymousKey) {
    throw new MobileSupabaseConfigError(
      "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required",
    );
  }

  let url: URL;
  try {
    url = new URL(urlSource);
  } catch {
    throw new MobileSupabaseConfigError("Supabase URL must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new MobileSupabaseConfigError("Supabase URL must be public HTTP(S)");
  }
  if (
    anonymousKey.length > MAX_PUBLIC_KEY_LENGTH ||
    isPrivilegedKey(anonymousKey)
  ) {
    throw new MobileSupabaseConfigError(
      "Privileged Supabase keys are forbidden",
    );
  }

  return { url: url.toString().replace(/\/$/, ""), anonymousKey };
}

export function createSecureSessionStorage(secureStore: SecureStoreApi) {
  return {
    getItem: (key: string) => secureStore.getItemAsync(key),
    setItem: (key: string, value: string) =>
      secureStore.setItemAsync(key, value),
    removeItem: (key: string) => secureStore.deleteItemAsync(key),
  };
}

export function createMobileSupabaseClient(
  config: MobileSupabaseConfig,
  storage: ReturnType<typeof createSecureSessionStorage>,
): SupabaseClient {
  return createClient(config.url, config.anonymousKey, {
    auth: mobileSupabaseAuthOptions(storage),
  });
}

export function mobileSupabaseAuthOptions(
  storage: ReturnType<typeof createSecureSessionStorage>,
) {
  return {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  } as const;
}
