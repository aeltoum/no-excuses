// Deploy the same commit as the database and web release. Never print API responses:
// provider error bodies can contain service configuration.
const { RENDER_API_KEY, RENDER_SERVICE_ID, GITHUB_SHA } = process.env;
if (
  !RENDER_API_KEY ||
  !RENDER_SERVICE_ID ||
  !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? "")
)
  throw new Error(
    "RENDER_API_KEY, RENDER_SERVICE_ID and full GITHUB_SHA required",
  );
const base = `https://api.render.com/v1/services/${encodeURIComponent(RENDER_SERVICE_ID)}`;
async function request(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${RENDER_API_KEY}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Render ${method} failed: HTTP ${response.status}`);
  return response.json();
}
const service = await request("");
if (
  service.autoDeployTrigger !== undefined
    ? service.autoDeployTrigger !== "off"
    : service.autoDeploy !== "no"
)
  throw new Error(
    "Disable Render Auto-Deploy first; GitHub controls release ordering",
  );
if (process.argv.includes("--check")) process.exit(0);
const deploy = await request("/deploys", "POST", { commitId: GITHUB_SHA });
if (typeof deploy.id !== "string")
  throw new Error("Render returned no deploy ID");
const terminal = new Set([
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
  "canceled",
  "deactivated",
]);
const deadline = Date.now() + 20 * 60_000;
let previous;
while (Date.now() < deadline) {
  const state = await request(`/deploys/${encodeURIComponent(deploy.id)}`);
  if (state.commit?.id !== GITHUB_SHA)
    throw new Error("Render deployed a different commit");
  if (state.status !== previous)
    console.info(`Render deploy ${deploy.id}: ${state.status}`);
  previous = state.status;
  if (state.status === "live") process.exit(0);
  if (terminal.has(state.status))
    throw new Error(`Render deploy ended: ${state.status}`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
throw new Error("Render deploy did not become live within 20 minutes");
