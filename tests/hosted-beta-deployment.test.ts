import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("hosted beta deployment configuration", () => {
  it("publishes Cloudflare Pages SPA fallback in the Vite output", async () => {
    expect(await read("apps/web/public/_redirects")).toBe(
      "/* /index.html 200\n",
    );
  });

  it("pins the approved Render Free API shape without secret values", async () => {
    const blueprint = await read("render.yaml");

    expect(blueprint).toContain("runtime: node");
    expect(blueprint).toContain("plan: free");
    expect(blueprint).toContain("region: virginia");
    expect(blueprint).toContain("value: 24.19.0");
    expect(blueprint).toContain("value: 0.0.0.0");
    expect(blueprint).toContain(
      "buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm api:build",
    );
    expect(blueprint).toContain(
      "startCommand: node dist/api/delivery/src/server.js",
    );
    expect(blueprint).toContain("healthCheckPath: /v1/health");
    expect(blueprint).toContain("autoDeployTrigger: checksPass");

    for (const key of [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "INVITATION_SECRET",
      "PWA_ORIGIN",
    ]) {
      expect(blueprint).toContain(`- key: ${key}\n        sync: false`);
    }
  });
});
