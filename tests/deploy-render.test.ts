import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../scripts/deploy-render.mjs", import.meta.url),
  "utf8",
);
const sha = "a".repeat(40);
const live = { id: "dep-test", commit: { id: sha }, status: "live" };
function run(responses: unknown[], env = {}, argv: string[] = []) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Response) return next;
    return { ok: true, json: async () => next };
  });
  const finished = new Error("exit:0");
  const result: Promise<unknown> = runInNewContext(
    `(async () => {${source}\n})()`,
    {
      process: {
        argv,
        env: {
          RENDER_API_KEY: "test-secret",
          RENDER_SERVICE_ID: "srv-test",
          GITHUB_SHA: sha,
          ...env,
        },
        exit: () => {
          throw finished;
        },
      },
      fetch: fetcher,
      AbortSignal,
      console: { info: vi.fn() },
      setTimeout: (resolve: () => void) => resolve(),
    },
  );
  return { result, calls, finished };
}
describe("coordinated Render deployment", () => {
  it("waits for the requested commit to become live", async () => {
    const runResult = run([
      { autoDeployTrigger: "off" },
      { id: "dep-test" },
      { ...live, status: "build_in_progress" },
      live,
    ]);
    await expect(runResult.result).rejects.toBe(runResult.finished);
    expect(runResult.calls.map((call) => call.init.method)).toEqual([
      "GET",
      "POST",
      "GET",
      "GET",
    ]);
    expect(JSON.parse(String(runResult.calls[1]?.init.body))).toEqual({
      commitId: sha,
    });
    expect(runResult.calls[3]?.url).toBe(
      "https://api.render.com/v1/services/srv-test/deploys/dep-test",
    );
  });
  it("blocks independent auto-deploys before starting a deploy", async () => {
    const { result, calls } = run([
      { autoDeployTrigger: "checksPass", autoDeploy: "yes" },
    ]);
    await expect(result).rejects.toThrow("Disable Render Auto-Deploy first");
    expect(calls).toHaveLength(1);
  });
  it("checks configuration without triggering a deployment", async () => {
    const { result, calls, finished } = run(
      [{ autoDeployTrigger: "off" }],
      {},
      ["--check"],
    );
    await expect(result).rejects.toBe(finished);
    expect(calls.map((call) => call.init.method)).toEqual(["GET"]);
  });
  it("disables independent auto-deploy once and confirms it without deploying", async () => {
    const { result, calls, finished } = run(
      [
        { autoDeployTrigger: "commit" },
        { autoDeployTrigger: "off" },
        { autoDeployTrigger: "off" },
      ],
      {},
      ["--disable-auto-deploy"],
    );
    await expect(result).rejects.toBe(finished);
    expect(calls.map((call) => call.init.method)).toEqual([
      "GET",
      "PATCH",
      "GET",
    ]);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      autoDeployTrigger: "off",
    });
    expect(
      calls.every(
        (call) => call.url === "https://api.render.com/v1/services/srv-test",
      ),
    ).toBe(true);
  });
  it("stops setup when Render rejects the setting change", async () => {
    const { result, calls } = run(
      [
        { autoDeployTrigger: "commit" },
        new Response("permission denied", { status: 403 }),
      ],
      {},
      ["--disable-auto-deploy"],
    );
    await expect(result).rejects.toThrow("Render PATCH failed: HTTP 403");
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "PATCH"]);
  });
  it("stops setup if Render still reports independent auto-deploy enabled", async () => {
    const { result, calls } = run(
      [{ autoDeployTrigger: "commit" }, {}, { autoDeployTrigger: "commit" }],
      {},
      ["--disable-auto-deploy"],
    );
    await expect(result).rejects.toThrow("Disable Render Auto-Deploy first");
    expect(calls.map((call) => call.init.method)).toEqual([
      "GET",
      "PATCH",
      "GET",
    ]);
  });
  it("prefers the current auto-deploy field over the legacy field", async () => {
    const { result, calls } = run([
      { autoDeployTrigger: "commit", autoDeploy: "no" },
    ]);
    await expect(result).rejects.toThrow("Disable Render Auto-Deploy first");
    expect(calls).toHaveLength(1);
  });
  it("rejects a live deploy of another commit", async () => {
    const { result } = run([
      { autoDeployTrigger: "off" },
      { id: "dep-test" },
      { ...live, commit: { id: "b".repeat(40) } },
    ]);
    await expect(result).rejects.toThrow("different commit");
  });
  it.each([
    "build_failed",
    "update_failed",
    "pre_deploy_failed",
    "canceled",
    "deactivated",
  ])("blocks publishing after %s", async (status) => {
    const { result } = run([
      { autoDeployTrigger: "off" },
      { id: "dep-test" },
      { ...live, status },
    ]);
    await expect(result).rejects.toThrow(`Render deploy ended: ${status}`);
  });
  it("rejects missing credentials before any network request", async () => {
    const { result, calls } = run([], { RENDER_API_KEY: "" });
    await expect(result).rejects.toThrow("required");
    expect(calls).toEqual([]);
  });
});
