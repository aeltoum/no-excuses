import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(path, "utf8");

describe("hosted beta deployment configuration", () => {
  it("publishes Cloudflare Pages SPA fallback in the Vite output", async () => {
    expect(await read("apps/web/public/_redirects")).toBe(
      "/* /index.html 200\n",
    );
  });

  it("pins the approved Cloudflare Workers Free API shape without secret values", async () => {
    const source = await read("packages/delivery/wrangler.jsonc");
    const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));

    expect(config).toMatchObject({
      name: "no-excuses-api",
      main: "src/cloudflare.ts",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: true,
      keep_vars: true,
      triggers: { crons: ["* * * * *"] },
      hyperdrive: [{ binding: "HYPERDRIVE" }],
      placement: { mode: "targeted", region: "aws:us-east-1" },
    });
    // Secrets are set in Cloudflare, never committed as vars.
    expect(config.vars).toBeUndefined();
    for (const key of [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "INVITATION_SECRET",
      "PWA_ORIGIN",
    ])
      expect(source).toContain(key);
  });

  it("deploys the API Worker only after migrations, then checks health before the PWA", async () => {
    const workflow = await read(".github/workflows/deploy-web.yml");
    const order = [
      "pnpm api:deploy --dry-run",
      "supabase db push",
      'pnpm api:deploy --message "${{ github.sha }}"',
      "/v1/health",
      "wrangler pages deploy",
    ].map((step) => workflow.indexOf(step));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(workflow).not.toMatch(/render/i);
  });

  it("deploys every push to main from one locked workflow; Workers Builds stands down", async () => {
    const workflow = await read(".github/workflows/deploy-web.yml");
    expect(workflow).toMatch(/on:\s+push:\s+branches: \[main\]/);
    expect(workflow).toContain("group: production-release");
    expect(workflow).toContain("cancel-in-progress: false");
    const script = await read("scripts/deploy-production.sh");
    const skip = script.indexOf('if [ -n "${WORKERS_CI:-}" ]');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(script.indexOf("supabase db push"));
  });
});
