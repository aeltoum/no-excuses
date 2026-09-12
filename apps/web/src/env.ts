export type PublicEnvironment = {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const allowedKeys = [
  "VITE_API_BASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
] as const;

export function readPublicEnvironment(
  source: Record<string, string | boolean | undefined>,
): PublicEnvironment {
  const values = Object.fromEntries(
    allowedKeys.map((key) => {
      const value = source[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Missing public environment variable: ${key}`);
      }
      return [key, value];
    }),
  ) as Record<(typeof allowedKeys)[number], string>;

  for (const key of ["VITE_API_BASE_URL", "VITE_SUPABASE_URL"] as const) {
    const url = new URL(values[key]);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error(`${key} must use http or https`);
  }
  return {
    apiBaseUrl: values.VITE_API_BASE_URL,
    supabaseUrl: values.VITE_SUPABASE_URL,
    supabaseAnonKey: values.VITE_SUPABASE_ANON_KEY,
  };
}
