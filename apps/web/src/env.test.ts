import { describe, expect, it } from "vitest";
import { readPublicEnvironment } from "./env";

const valid = {
  VITE_API_BASE_URL: "http://127.0.0.1:8787",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "local-public-key",
};

describe("readPublicEnvironment", () => {
  it("accepts only required public client configuration", () => {
    expect(readPublicEnvironment({ ...valid, DATABASE_URL: "secret" })).toEqual(
      {
        apiBaseUrl: valid.VITE_API_BASE_URL,
        supabaseUrl: valid.VITE_SUPABASE_URL,
        supabaseAnonKey: valid.VITE_SUPABASE_ANON_KEY,
      },
    );
  });
  it("rejects missing and non-http endpoint values", () => {
    expect(() =>
      readPublicEnvironment({ ...valid, VITE_API_BASE_URL: "" }),
    ).toThrow("Missing public environment variable: VITE_API_BASE_URL");
    expect(() =>
      readPublicEnvironment({
        ...valid,
        VITE_SUPABASE_URL: "file:///private/key",
      }),
    ).toThrow("VITE_SUPABASE_URL must use http or https");
  });
});
