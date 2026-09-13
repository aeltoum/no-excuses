// Local integration harness only. Never deploy or bind outside loopback.

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  acceptGroupInvitationRequestSchema,
  createGroupRequestSchema,
  groupRequestSchema,
  issueGroupInvitationRequestSchema,
  setWeeklyTargetRequestSchema,
  submitWorkoutCheckinRequestSchema,
} from "../packages/contracts/src/runtime.ts";

const origin = "http://127.0.0.1:4174";
const authUrl = "http://127.0.0.1:54321";
const databaseUrl = process.env.DATABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!databaseUrl || !anonKey || new URL(databaseUrl).hostname !== "127.0.0.1")
  throw new Error("Local DATABASE_URL and SUPABASE_ANON_KEY required");
const database = new URL(databaseUrl);
const pgEnvironment = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port,
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: database.pathname.slice(1),
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const q = (field) => `(:'payload'::jsonb->>'${field}')`;
const request = `:'request'::uuid`;
const key = `:'key'::uuid`;
const hash = `:'hash'::text`;
const failedTargetKeys = new Set();

const routes = [
  {
    method: "GET",
    pattern: /^\/v1\/group-memberships\/current$/,
    schema: null,
    sql: "select app_private.current_group_membership()",
  },
  {
    method: "POST",
    pattern: /^\/v1\/groups$/,
    schema: createGroupRequestSchema,
    sql: `select jsonb_build_object('membershipId', app_private.create_group_command(${key}, ${hash}, ${request}, ${q("groupId")}::uuid, ${q("membershipId")}::uuid, ${q("name")}, ${q("timeZone")}, ${q("weeklyTarget")}::integer, now()))`,
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-invitations\/accept$/,
    schema: acceptGroupInvitationRequestSchema,
    sql: `select jsonb_build_object('membershipId', app_private.accept_group_invitation_command(${key}, ${hash}, ${request}, ${q("tokenDigest")}, ${q("membershipId")}::uuid, ${q("recurringTarget")}::integer, ${q("currentTarget")}::integer, now()))`,
    prepare: (body) => ({
      ...body,
      tokenDigest: createHash("sha256").update(body.token).digest("hex"),
    }),
  },
  {
    method: "POST",
    pattern: /^\/v1\/group-invitations$/,
    schema: issueGroupInvitationRequestSchema,
    sql: `select jsonb_build_object('invitationId', t.invitation_id, 'expiresAt', t.expires_at, 'token', :'key') from app_private.issue_group_invitation_command(${key}, ${hash}, ${request}, ${q("invitationId")}::uuid, ${q("email")}, ${q("tokenDigest")}, now()) t`,
    prepare: (body, idempotencyKey) => ({
      ...body,
      tokenDigest: createHash("sha256").update(idempotencyKey).digest("hex"),
    }),
  },
  {
    method: "PUT",
    pattern: /^\/v1\/group-memberships\/weekly-target$/,
    schema: setWeeklyTargetRequestSchema,
    sql: `select jsonb_build_object('membershipId', t.membership_id, 'weeklyTarget', t.weekly_target) from app_private.set_weekly_target_command(${key}, ${hash}, ${request}, ${q("weeklyTarget")}::integer) t`,
  },
  {
    method: "POST",
    pattern: /^\/v1\/workout-check-ins$/,
    schema: submitWorkoutCheckinRequestSchema,
    sql: `select jsonb_build_object('workoutCheckinId', t.workout_checkin_id, 'currentWeekCount', t.current_week_count) from app_private.submit_workout_checkin(${key}, ${hash}, ${request}, ${q("workoutCheckinId")}::uuid, ${q("activityType")}::app_private.workout_activity_type, ${q("completedAt")}::timestamptz, ${q("durationMinutes")}::integer, ${q("perceivedIntensity")}::app_private.perceived_intensity, ${q("selfReportAttested")}::boolean, now()) t`,
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/current-week-progress$/,
    schema: groupRequestSchema,
    sql: `select coalesce(jsonb_agg(jsonb_build_object('membershipId', t.membership_id, 'lockedTarget', t.locked_target, 'completedWorkoutCount', t.completed_workout_count)), '[]'::jsonb) from app_private.current_week_progress(${q("groupId")}::uuid, now()) t`,
  },
  {
    method: "GET",
    pattern: /^\/v1\/groups\/([^/]+)\/finalized-weekly-history$/,
    schema: groupRequestSchema,
    sql: `select coalesce(jsonb_agg(jsonb_build_object('membershipId', t.membership_id, 'startsAt', t.starts_at, 'endsAt', t.ends_at, 'lockedTarget', t.locked_target, 'completedWorkoutCount', t.completed_workout_count, 'outcome', t.outcome)), '[]'::jsonb) from app_private.finalized_weekly_history(${q("groupId")}::uuid) t`,
  },
];

function runSql(sql, variables) {
  return new Promise((resolve, reject) => {
    const args = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const statement =
      `begin; set local role service_role; select set_config('app.auth_user_id', :'actor', true); select set_config('app.token_issued_at', :'issued', true); ${sql}; commit;`.replace(
        /:'(actor|issued|payload|key|hash|request)'/g,
        (_, name) => quote(variables[name]),
      );
    const child = spawn("psql", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: pgEnvironment,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(
            new Error(
              err.includes("permission denied") || err.includes("required")
                ? "denied"
                : err.includes("duplicate key") || err.includes("idempotency")
                  ? "conflict"
                  : "failed",
            ),
          ),
    );
    child.stdin.end(`set standard_conforming_strings = on; ${statement}`);
  });
}

function reply(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, idempotency-key",
    vary: "origin",
  });
  response.end(JSON.stringify(body));
}

function error(response, status, code) {
  reply(response, status, {
    contractVersion: 1,
    error: {
      code,
      message:
        code === "unauthorized"
          ? "Access ended. Sign in again."
          : code === "denied"
            ? "Action denied."
            : "Action unavailable.",
      retryable: status >= 500,
    },
  });
}

createServer(async (incoming, response) => {
  if (incoming.headers.origin && incoming.headers.origin !== origin)
    return error(response, 403, "denied");
  if (incoming.method === "OPTIONS") return reply(response, 204, {});
  const pathname = new URL(incoming.url ?? "/", "http://127.0.0.1:8787")
    .pathname;
  const route = routes.find(
    (item) => item.method === incoming.method && item.pattern.test(pathname),
  );
  if (!route) return error(response, 404, "domain_failure");
  const token = incoming.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return error(response, 401, "unauthorized");
  try {
    const auth = await fetch(`${authUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!auth.ok) return error(response, 401, "unauthorized");
    const user = await auth.json();
    if (!uuid.test(user.id ?? "")) return error(response, 401, "unauthorized");
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    );
    if (!Number.isInteger(claims.iat))
      return error(response, 401, "unauthorized");
    let body = {};
    if (incoming.method !== "GET") {
      let raw = "";
      for await (const chunk of incoming) {
        raw += chunk;
        if (raw.length > 16_384) return error(response, 400, "invalid_request");
      }
      body = JSON.parse(raw || "{}");
    }
    const match = route.pattern.exec(pathname);
    if (match?.[1]) body.groupId = match[1];
    const parsed = route.schema?.safeParse(body);
    if (parsed && !parsed.success)
      return error(response, 400, "invalid_request");
    const idempotencyKey =
      route.schema && incoming.method !== "GET"
        ? incoming.headers["idempotency-key"]
        : randomUUID();
    if (typeof idempotencyKey !== "string" || !uuid.test(idempotencyKey))
      return error(response, 400, "idempotency_required");
    if (
      process.env.LOCAL_FAIL_ONCE_TARGET === "1" &&
      pathname === "/v1/group-memberships/weekly-target" &&
      !failedTargetKeys.has(idempotencyKey)
    ) {
      failedTargetKeys.add(idempotencyKey);
      return error(response, 503, "domain_failure");
    }
    const clean = parsed?.data ?? body;
    const payload = route.prepare
      ? route.prepare(clean, idempotencyKey)
      : clean;
    const result = await runSql(route.sql, {
      actor: user.id,
      issued: new Date(claims.iat * 1000).toISOString(),
      payload: JSON.stringify(payload),
      key: idempotencyKey,
      hash: createHash("sha256")
        .update(JSON.stringify({ command: pathname, body: clean }))
        .digest("hex"),
      request: randomUUID(),
    });
    const data = JSON.parse(result.split("\n").at(-1) ?? "null");
    const records = Array.isArray(data) ? data : [data];
    for (const record of records) {
      if (record && typeof record === "object")
        for (const field of ["expiresAt", "startsAt", "endsAt"])
          if (record[field])
            record[field] = new Date(record[field]).toISOString();
    }
    reply(response, 200, { contractVersion: 1, data });
  } catch (cause) {
    const kind =
      cause instanceof SyntaxError ? "invalid_request" : cause.message;
    error(
      response,
      kind === "denied"
        ? 403
        : kind === "conflict"
          ? 409
          : kind === "invalid_request"
            ? 400
            : 500,
      ["denied", "conflict", "invalid_request"].includes(kind)
        ? kind === "conflict"
          ? "idempotency_conflict"
          : kind
        : "domain_failure",
    );
  }
}).listen(8787, "127.0.0.1", () =>
  process.stdout.write("Local PWA API listening on http://127.0.0.1:8787\n"),
);
