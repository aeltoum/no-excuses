import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";
import webpush from "web-push";
import {
  acceptGroupInvitationRequestSchema,
  consentRequestSchema,
  createGroupRequestSchema,
  currentGroupMembershipRequestSchema,
  deleteAccountRequestSchema,
  enrollmentRequestSchema,
  groupRequestSchema,
  invitationPreviewRequestSchema,
  issueGroupInvitationRequestSchema,
  leaveGroupRequestSchema,
  removeGroupMemberRequestSchema,
  revokeGroupInvitationRequestSchema,
  setDisplayNameRequestSchema,
  setWeeklyTargetRequestSchema,
  submitWorkoutCheckinRequestSchema,
} from "../../contracts/src/runtime.js";
import type { ApiRequest, ApiResponse } from "./api.js";
import { createV1HttpHandler } from "./http.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
};
const databaseUrl = required("DATABASE_URL");
const authUrl = required("SUPABASE_URL").replace(/\/$/, "");
const anonKey = required("SUPABASE_ANON_KEY");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const invitationSecret = required("INVITATION_SECRET");
if (Buffer.byteLength(invitationSecret) < 32)
  throw new Error("INVITATION_SECRET too short");
const allowedOrigin = required("PWA_ORIGIN");
const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushEnabled)
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:no-reply@example.com",
    vapidPublicKey,
    vapidPrivateKey,
  );

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
type Actor = { id: string; issuedAt: string; email: string };
const fail = (code: string, status: number): ApiResponse => ({
  status,
  body: {
    contractVersion: 1,
    error: {
      code,
      message: code === "unauthorized" ? "Unauthorized" : "Action unavailable",
      retryable: status >= 500,
    },
  },
});
const ok = (data: unknown, status = 200): ApiResponse => ({
  status,
  body: { contractVersion: 1, data },
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const invitationToken = (id: string) =>
  createHmac("sha256", invitationSecret).update(id).digest("base64url");
const tokenDigest = (token: string) => digest(token);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

async function authUser(
  authorization: string | undefined,
): Promise<Actor | null> {
  const token = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1];
  if (!token) return null;
  const response = await fetch(`${authUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: unknown; email?: unknown };
  if (!uuid(user.id) || typeof user.email !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  let issued: unknown;
  try {
    issued = (
      JSON.parse(Buffer.from(part, "base64url").toString()) as { iat?: unknown }
    ).iat;
  } catch {
    return null;
  }
  if (typeof issued !== "number" || !Number.isSafeInteger(issued)) return null;
  return {
    id: user.id,
    email: user.email.toLowerCase(),
    issuedAt: new Date(issued * 1000).toISOString(),
  };
}

async function query(
  actor: Actor,
  sql: string,
  values: unknown[],
): Promise<pg.QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query(
      "select set_config('app.auth_user_id', $1, true), set_config('app.token_issued_at', $2, true)",
      [actor.id, actor.issuedAt],
    );
    const access = await client.query(
      "select app_private.actor_account_id() as id",
    );
    if (!access.rows[0]?.id)
      throw Object.assign(new Error("Access denied"), { code: "42501" });
    const response = await client.query(sql, values);
    await client.query("commit");
    return response;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function adminUser(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
) {
  const response = await fetch(`${authUrl}/auth/v1/admin/users${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok && !(method === "DELETE" && response.status === 404))
    throw new Error("Auth admin operation failed");
  return method === "POST"
    ? ((await response.json()) as { id?: unknown })
    : null;
}

async function finishAuthDeletion(authUserId: string) {
  await adminUser("DELETE", `/${authUserId}`);
  await pool.query(
    "update app_private.accounts set auth_deleted_at=coalesce(auth_deleted_at,now()) where auth_user_id=$1 and status='deleted'",
    [authUserId],
  );
}

const proofBucket = "proof-photos";
async function storage(path: string, method: string, body: unknown) {
  const response = await fetch(`${authUrl}/storage/v1${path}`, {
    method,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Storage ${method} failed`);
  return response.json() as Promise<unknown>;
}

async function deleteExpiredProofMedia() {
  const due = await pool.query(
    "select path from app_private.proof_media_due(now())",
  );
  const paths = due.rows.map((row) => row.path as string);
  if (paths.length === 0) return;
  await storage(`/object/${proofBucket}`, "DELETE", { prefixes: paths });
  await pool.query("select app_private.mark_proof_media_deleted($1, now())", [
    paths,
  ]);
}

let delivering = false;
async function deliverPush() {
  if (!pushEnabled || delivering) return;
  delivering = true;
  try {
    await pool.query("select app_private.enqueue_push_notifications(now())");
    await pool.query("select app_private.enqueue_consequence_push(now())");
    const pending = await pool.query(
      "select o.outbox_id, o.title, o.body, s.endpoint, s.p256dh, s.auth from app_private.web_push_outbox o join app_private.web_push_subscriptions s on s.account_id=o.account_id where o.sent_at is null order by o.outbox_id limit 200",
    );
    const sent = new Set<string>();
    for (const row of pending.rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint as string,
            keys: { p256dh: row.p256dh as string, auth: row.auth as string },
          },
          JSON.stringify({ title: row.title, body: row.body }),
          { TTL: 86400 },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await pool.query(
            "delete from app_private.web_push_subscriptions where endpoint=$1",
            [row.endpoint],
          );
        else console.error("Push delivery failed", status ?? "unknown");
      }
      sent.add(String(row.outbox_id));
    }
    // Unsent rows for accounts without a live subscription are dropped too.
    await pool.query(
      "update app_private.web_push_outbox set sent_at=now() where sent_at is null and (outbox_id = any($1::bigint[]) or not exists (select 1 from app_private.web_push_subscriptions s where s.account_id=web_push_outbox.account_id))",
      [[...sent]],
    );
  } catch (error) {
    console.error(
      "Push delivery failed",
      (error as { code?: string }).code ?? "unknown",
    );
  } finally {
    delivering = false;
  }
}

async function maintenance() {
  try {
    await pool.query("select app_private.advance_true_mvp_weeks(now())");
    await pool.query("select app_private.advance_consequences(now())");
    const pending = await pool.query(
      "select auth_user_id from app_private.accounts where status='deleted' and auth_deleted_at is null limit 50",
    );
    for (const row of pending.rows) {
      try {
        await finishAuthDeletion(row.auth_user_id as string);
      } catch {
        console.error("Account Auth deletion pending retry");
      }
    }
    try {
      await deleteExpiredProofMedia();
    } catch {
      console.error("Proof media deletion pending retry");
    }
    await deliverPush();
  } catch (error) {
    console.error(
      "Weekly maintenance failed",
      (error as { code?: string }).code ?? "unknown",
    );
  }
}

async function enroll(
  email: string,
  token: string,
  organizer: boolean,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (
    !emailPattern.test(normalized) ||
    normalized.length > 254 ||
    (!organizer && !/^[A-Za-z0-9_-]{43}$/.test(token))
  )
    throw new Error("Invalid enrollment");
  const client = await pool.connect();
  let createdUser: string | null = null;
  try {
    await client.query("begin");
    if (organizer) {
      const existing = await client.query(
        "select 1 from app_private.accounts where organizer_seeded limit 1",
      );
      if (existing.rowCount) throw new Error("Organizer already seeded");
    } else {
      const invitation = await client.query(
        "select i.invitation_id from app_private.group_invitations i join app_private.groups g on g.group_id=i.group_id where i.email=$1 and i.token_digest=$2 and i.status='issued' and i.expires_at>now() and g.status<>'closed' for update of i",
        [normalized, tokenDigest(token)],
      );
      if (!invitation.rowCount) throw new Error("Invitation unavailable");
    }
    const existing = await client.query(
      "select 1 from app_private.accounts where email=$1",
      [normalized],
    );
    if (existing.rowCount) throw new Error("Account already enrolled");
    const user = await adminUser("POST", "", {
      email: normalized,
      email_confirm: true,
    });
    if (!uuid(user?.id)) throw new Error("Invalid Auth identity");
    createdUser = user.id;
    await client.query(
      "insert into app_private.accounts(account_id,auth_user_id,email,organizer_seeded) values($1,$2,$3,$4)",
      [randomUUID(), user.id, normalized, organizer],
    );
    await client.query("commit");
    createdUser = null;
  } catch (error) {
    await client.query("rollback");
    if (createdUser) {
      try {
        await adminUser("DELETE", `/${createdUser}`);
      } catch {
        console.error(
          "Enrollment Auth compensation failed; operator cleanup required",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function dbError(error: unknown): ApiResponse {
  const code = (error as { code?: string }).code;
  if (code === "42501" || code === "P0002") return fail("denied", 403);
  if (code === "23505" || code === "23514")
    return fail("idempotency_conflict", 409);
  if (code === "22023" || code === "22P02") return fail("invalid_request", 400);
  console.error("API database operation failed", code ?? "unknown");
  return fail("domain_failure", 500);
}

function protectedHandler(
  command: boolean,
  execute: (
    actor: Actor,
    body: Record<string, unknown>,
    context?: { key: string; hash: string; id: string; now: string },
  ) => Promise<unknown>,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
  commandName = "",
  statusForValue: (value: unknown) => number = () => 200,
) {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    let actor: Actor | null;
    try {
      actor = await authUser(request.authorization);
    } catch {
      return fail("domain_failure", 503);
    }
    if (!actor) return fail("unauthorized", 401);
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return fail("invalid_request", 400);
    const body = parsed.data as Record<string, unknown>;
    let context:
      | { key: string; hash: string; id: string; now: string }
      | undefined;
    if (command) {
      const key = request.headers["idempotency-key"];
      if (!uuid(key)) return fail("idempotency_required", 400);
      context = {
        key,
        hash: digest(JSON.stringify({ command: commandName, body })),
        id: randomUUID(),
        now: new Date().toISOString(),
      };
    }
    try {
      const value = await execute(actor, body, context);
      return ok(value, statusForValue(value));
    } catch (error) {
      return dbError(error);
    }
  };
}

const command = (
  sql: string,
  input: (body: Record<string, unknown>, now: string) => unknown[],
  output: (
    rows: Record<string, unknown>[],
    body: Record<string, unknown>,
  ) => unknown,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
  includeNow = true,
) =>
  protectedHandler(
    true,
    async (actor, body, context) => {
      if (!context) throw new Error("Missing context");
      const rows = (
        await query(actor, sql, [
          context.key,
          context.hash,
          context.id,
          ...input(body, context.now),
          ...(includeNow ? [context.now] : []),
        ])
      ).rows;
      if (rows.length === 0)
        throw Object.assign(new Error("Action denied"), { code: "42501" });
      return output(rows, body);
    },
    schema,
    sql,
  );
const read = (
  sql: string,
  input: (body: Record<string, unknown>) => unknown[],
  output: (rows: Record<string, unknown>[]) => unknown,
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
) =>
  protectedHandler(
    false,
    async (actor, body) => output((await query(actor, sql, input(body))).rows),
    schema,
  );
const membership = (rows: Record<string, unknown>[]) => ({
  membershipId: rows[0]?.id,
});
const group = (body: Record<string, unknown>) => [
  body.groupId,
  body.membershipId,
  body.name,
  body.timeZone,
  body.weeklyTarget,
];

const handlers = {
  getAccountDisplayName: read(
    "select app_private.current_account_display_name() as display_name",
    () => [],
    (rows) => ({ displayName: rows[0]?.display_name ?? null }),
    currentGroupMembershipRequestSchema,
  ),
  setAccountDisplayName: command(
    "select app_private.set_display_name_command($1,$2,$3,$4) as display_name",
    (body) => [body.displayName],
    (rows) => ({ displayName: rows[0]?.display_name }),
    setDisplayNameRequestSchema,
    false,
  ),
  createGroup: command(
    "select app_private.create_group_command($1,$2,$3,$4,$5,$6,$7,$8,$9) as id from app_private.accounts where auth_user_id=current_setting('app.auth_user_id')::uuid and organizer_seeded",
    group,
    membership,
    createGroupRequestSchema,
  ),
  issueGroupInvitation: command(
    "select * from app_private.issue_group_invitation_command($1,$2,$3,$4,$5,$6,$7)",
    (body) => [
      body.invitationId,
      body.email,
      tokenDigest(invitationToken(String(body.invitationId))),
    ],
    (rows, body) => ({
      invitationId: rows[0]?.invitation_id,
      token: invitationToken(String(body.invitationId)),
      expiresAt: new Date(String(rows[0]?.expires_at)).toISOString(),
    }),
    issueGroupInvitationRequestSchema,
  ),
  revokeGroupInvitation: command(
    "select app_private.revoke_group_invitation_command($1,$2,$3,$4,$5) as id",
    (body) => [body.invitationId],
    (rows) => ({ invitationId: rows[0]?.id, status: "revoked" }),
    revokeGroupInvitationRequestSchema,
  ),
  acceptGroupInvitation: command(
    "select app_private.accept_group_invitation_command($1,$2,$3,$4,$5,$6,$7,$8) as id",
    (body) => [
      tokenDigest(String(body.token)),
      body.membershipId,
      body.recurringTarget,
      body.currentTarget,
    ],
    membership,
    acceptGroupInvitationRequestSchema,
  ),
  previewGroupInvitation: read(
    "select g.name as group_name, count(m.membership_id)::integer as member_count, b.ends_at as week_ends_at from app_private.group_invitations i join app_private.groups g on g.group_id=i.group_id left join app_private.memberships m on m.group_id=g.group_id and m.ended_at is null cross join lateral app_private.accountability_week_bounds(now(),g.time_zone,g.week_starts) b where i.email=(select email from app_private.accounts where auth_user_id=current_setting('app.auth_user_id')::uuid) and i.token_digest=$1 and i.status='issued' and i.expires_at>now() and g.status<>'closed' group by g.name,b.ends_at",
    (body) => [tokenDigest(String(body.token))],
    (rows) => {
      if (!rows[0])
        throw Object.assign(new Error("Invitation unavailable"), {
          code: "42501",
        });
      return {
        groupName: rows[0].group_name,
        memberCount: rows[0].member_count,
        weekEndsAt: new Date(String(rows[0].week_ends_at)).toISOString(),
      };
    },
    invitationPreviewRequestSchema,
  ),
  leaveGroup: command(
    "select app_private.leave_group_command($1,$2,$3,$4) as id",
    () => [],
    membership,
    leaveGroupRequestSchema,
  ),
  removeGroupMember: command(
    "select app_private.remove_group_member_command($1,$2,$3,$4,$5,$6) as id",
    (body) => [body.groupId, body.membershipId],
    membership,
    removeGroupMemberRequestSchema,
  ),
  setWeeklyTarget: command(
    "select * from app_private.set_weekly_target_command($1,$2,$3,$4)",
    (body) => [body.weeklyTarget],
    (rows) => ({
      membershipId: rows[0]?.membership_id,
      weeklyTarget: rows[0]?.weekly_target,
    }),
    setWeeklyTargetRequestSchema,
    false,
  ),
  getWeeklyTarget: read(
    "select * from app_private.weekly_target_context(now())",
    () => [],
    (rows) => {
      if (!rows[0])
        throw Object.assign(new Error("Action denied"), { code: "42501" });
      return {
        membershipId: rows[0].membership_id,
        recurringTarget: rows[0].recurring_target,
        lockedTarget: rows[0].locked_target,
        nextWeekStartsAt: rows[0].next_week_starts_at
          ? new Date(String(rows[0].next_week_starts_at)).toISOString()
          : null,
        memberCount: rows[0].member_count,
        timeZone: rows[0].time_zone,
      };
    },
    currentGroupMembershipRequestSchema,
  ),
  submitWorkoutCheckin: command(
    "select * from app_private.submit_proof_checkin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    (body, now) => [
      body.workoutCheckinId,
      body.activityType,
      body.completedAt ?? now,
      body.durationMinutes,
      body.perceivedIntensity,
      body.selfReportAttested,
      body.activityPhotoPath,
      body.presencePhotoPath,
      body.mediaConsent,
    ],
    (rows) => {
      setImmediate(() => void deliverPush());
      return {
        workoutCheckinId: rows[0]?.workout_checkin_id,
        currentWeekCount: rows[0]?.current_week_count,
      };
    },
    submitWorkoutCheckinRequestSchema,
  ),
  deleteAccount: protectedHandler(
    true,
    async (actor, body, context) => {
      if (!context) throw new Error("Missing context");
      if (typeof body.otpCode !== "string" || !/^\d{6}$/.test(body.otpCode))
        throw Object.assign(new Error("Code required"), { code: "22023" });
      const verified = await fetch(`${authUrl}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({
          email: actor.email,
          token: body.otpCode,
          type: "email",
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!verified.ok)
        throw Object.assign(new Error("Code rejected"), { code: "42501" });
      const proof = (await verified.json()) as { user?: { id?: unknown } };
      if (proof.user?.id !== actor.id)
        throw Object.assign(new Error("Identity mismatch"), { code: "42501" });
      const rows = (
        await query(
          actor,
          "select app_private.delete_account_command($1,$2,$3,true,$4) as id",
          [context.key, context.hash, context.id, context.now],
        )
      ).rows;
      try {
        await finishAuthDeletion(actor.id);
        return { accountId: rows[0]?.id };
      } catch {
        console.error("Account Auth deletion pending retry");
        return { accountId: rows[0]?.id, authDeletion: "pending" as const };
      }
    },
    deleteAccountRequestSchema,
    "delete_account",
    (value) =>
      (value as { authDeletion?: string }).authDeletion === "pending"
        ? 202
        : 200,
  ),
  getCurrentGroupMembership: read(
    "select app_private.current_group_membership() as data",
    () => [],
    (rows) => rows[0]?.data,
    currentGroupMembershipRequestSchema,
  ),
  listGroupMembers: read(
    "select g.name as group_name, m.membership_id, coalesce(a.display_name, 'Member ' || left(m.membership_id::text,8)) as display_name, m.recurring_target as weekly_target, ga.membership_id is not null as creator from app_private.groups g join app_private.memberships m on m.group_id=g.group_id and m.ended_at is null join app_private.accounts a on a.account_id=m.account_id left join app_private.group_admins ga on ga.membership_id=m.membership_id where g.group_id=$1 and app_private.can_group_action(g.group_id,'group_read') order by (ga.membership_id is not null) desc,m.joined_at,m.membership_id",
    (body) => [body.groupId],
    (rows) => {
      if (!rows[0])
        throw Object.assign(new Error("Action denied"), { code: "42501" });
      return {
        groupName: rows[0].group_name,
        members: rows.map((row) => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
          weeklyTarget: row.weekly_target,
          creator: row.creator,
        })),
      };
    },
    groupRequestSchema,
  ),
  listPendingGroupInvitations: read(
    "with actor_group as (select m.group_id from app_private.memberships m join app_private.group_admins ga on ga.membership_id=m.membership_id where m.account_id=app_private.actor_account_id() and m.group_id=$1 and m.ended_at is null) select i.invitation_id,i.email,i.expires_at from actor_group ag left join app_private.group_invitations i on i.group_id=ag.group_id and i.status='issued' and i.expires_at>now() order by i.issued_at,i.invitation_id",
    (body) => [body.groupId],
    (rows) => {
      if (!rows[0])
        throw Object.assign(new Error("Action denied"), { code: "42501" });
      return rows
        .filter((row) => row.invitation_id)
        .map((row) => ({
          invitationId: row.invitation_id,
          email: row.email,
          expiresAt: new Date(String(row.expires_at)).toISOString(),
        }));
    },
    groupRequestSchema,
  ),
  getCurrentWeekProgress: read(
    "select * from app_private.current_week_progress($1,now())",
    (body) => [body.groupId],
    (rows) =>
      rows.map((row) => ({
        membershipId: row.membership_id,
        displayName: row.display_name,
        lockedTarget: row.locked_target,
        completedWorkoutCount: row.completed_workout_count,
        activityTypes: row.activity_types ?? [],
      })),
    groupRequestSchema,
  ),
  getFinalizedWeeklyHistory: read(
    "select * from app_private.finalized_weekly_history($1)",
    (body) => [body.groupId],
    (rows) =>
      rows.map((row) => ({
        membershipId: row.membership_id,
        displayName: row.display_name,
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString(),
        lockedTarget: row.locked_target,
        completedWorkoutCount: row.completed_workout_count,
        outcome: row.outcome,
      })),
    groupRequestSchema,
  ),
  getMemberHome: async () => fail("not_found", 404),
  getNotifications: async () => fail("not_found", 404),
  createSocialInteraction: async () => fail("not_found", 404),
  openNotification: async () => fail("not_found", 404),
};

const route = createV1HttpHandler(handlers);
async function enrollment(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  }
  const parsed = enrollmentRequestSchema.safeParse(body);
  if (!parsed.success)
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  try {
    await enroll(parsed.data.email, parsed.data.token, false);
  } catch {
    /* Same response for unknown, expired, revoked, and already enrolled. */
  }
  return Response.json({
    contractVersion: 1,
    data: { message: "If invitation is eligible, request a sign-in code." },
  });
}
async function consent(request: Request): Promise<Response> {
  let actor: Actor | null;
  try {
    actor = await authUser(request.headers.get("authorization") ?? undefined);
  } catch {
    return Response.json(fail("domain_failure", 503).body, { status: 503 });
  }
  if (!actor)
    return Response.json(fail("unauthorized", 401).body, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  }
  if (!consentRequestSchema.safeParse(body).success)
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  try {
    await query(
      actor,
      "select app_private.record_true_mvp_consent($1,$2,$3,now())",
      [true, true, true],
    );
    return Response.json(ok({ accepted: true }).body);
  } catch (error) {
    const response = dbError(error);
    return Response.json(response.body, { status: response.status });
  }
}

async function push(request: Request): Promise<Response> {
  if (request.method === "GET")
    return Response.json(
      ok({ publicKey: pushEnabled ? vapidPublicKey : null }).body,
    );
  let actor: Actor | null;
  try {
    actor = await authUser(request.headers.get("authorization") ?? undefined);
  } catch {
    return Response.json(fail("domain_failure", 503).body, { status: 503 });
  }
  if (!actor)
    return Response.json(fail("unauthorized", 401).body, { status: 401 });
  let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  }
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://"))
    return Response.json(fail("invalid_request", 400).body, { status: 400 });
  try {
    if (request.method === "DELETE") {
      await query(actor, "select app_private.delete_push_subscription($1)", [
        endpoint,
      ]);
    } else {
      const { p256dh, auth } = body.keys ?? {};
      if (typeof p256dh !== "string" || typeof auth !== "string")
        return Response.json(fail("invalid_request", 400).body, {
          status: 400,
        });
      await query(
        actor,
        "select app_private.save_push_subscription($1,$2,$3)",
        [endpoint, p256dh, auth],
      );
    }
    return Response.json(ok({ subscribed: request.method !== "DELETE" }).body);
  } catch (error) {
    const response = dbError(error);
    return Response.json(response.body, { status: response.status });
  }
}

const proofAction =
  /^\/v1\/proof\/([0-9a-f-]{36})\/(review|vote|withdraw|report|moderate)$/;
async function proof(request: Request, path: string): Promise<Response> {
  const reply = (response: ApiResponse) =>
    Response.json(response.body, { status: response.status });
  let actor: Actor | null;
  try {
    actor = await authUser(request.headers.get("authorization") ?? undefined);
  } catch {
    return reply(fail("domain_failure", 503));
  }
  if (!actor) return reply(fail("unauthorized", 401));
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return reply(fail("invalid_request", 400));
    }
  }
  const now = new Date().toISOString();
  try {
    if (path === "/v1/proof/uploads" && request.method === "POST") {
      if (body.kind !== "activity" && body.kind !== "presence")
        return reply(fail("invalid_request", 400));
      const created = await query(
        actor,
        "select app_private.create_proof_upload($1,$2) as path",
        [body.kind, now],
      );
      const objectPath = created.rows[0]?.path as string;
      const signed = (await storage(
        `/object/upload/sign/${proofBucket}/${objectPath}`,
        "POST",
        {},
      )) as { url?: string };
      if (!signed.url) throw new Error("Storage sign failed");
      return reply(
        ok({
          path: objectPath,
          uploadUrl: `${authUrl}/storage/v1${signed.url}`,
        }),
      );
    }
    if (path === "/v1/proof/feed" && request.method === "GET") {
      const rows = (
        await query(actor, "select * from app_private.proof_feed($1)", [now])
      ).rows;
      const paths = rows.flatMap((row) => [
        row.activity_photo_path as string,
        row.presence_photo_path as string,
      ]);
      const urls = new Map<string, string>();
      if (paths.length > 0) {
        const signed = (await storage(`/object/sign/${proofBucket}`, "POST", {
          expiresIn: 3600,
          paths,
        })) as Array<{ path?: string; signedURL?: string }>;
        for (const item of signed)
          if (item.path && item.signedURL)
            urls.set(item.path, `${authUrl}/storage/v1${item.signedURL}`);
      }
      const iso = (value: unknown) =>
        value ? new Date(String(value)).toISOString() : null;
      return reply(
        ok(
          rows.map((row) => ({
            workoutCheckinId: row.workout_checkin_id,
            authorMembershipId: row.author_membership_id,
            authorName: row.author_name,
            mine: row.mine,
            activityType: row.activity_type,
            durationMinutes: row.duration_minutes,
            perceivedIntensity: row.perceived_intensity,
            completedAt: iso(row.completed_at),
            submittedAt: iso(row.submitted_at),
            reviewStatus: row.review_status,
            reviewClosesAt: iso(row.review_closes_at),
            decisionClosesAt: iso(row.decision_closes_at),
            hidden: row.hidden,
            myVote: row.my_vote,
            acceptVotes: row.accept_votes,
            rejectVotes: row.reject_votes,
            eligibleVoters: row.eligible_voters,
            canReview: row.can_review,
            canVote: row.can_vote,
            activityPhotoUrl:
              urls.get(row.activity_photo_path as string) ?? null,
            presencePhotoUrl:
              urls.get(row.presence_photo_path as string) ?? null,
          })),
        ),
      );
    }
    const match = proofAction.exec(path);
    if (match && request.method === "POST") {
      const [, id = "", action = ""] = match;
      const choice = String(body.choice ?? "");
      const allowed: Record<string, string[]> = {
        review: ["verify", "question"],
        vote: ["accept", "reject", "cannot_assess"],
        moderate: ["restore", "remove"],
        withdraw: [""],
        report: [""],
      };
      if (!allowed[action]?.includes(choice))
        return reply(fail("invalid_request", 400));
      const sql: Record<string, string> = {
        review:
          "select app_private.review_proof_checkin($1,$2,$3)::text as status",
        vote: "select app_private.vote_proof_checkin($1,$2::app_private.proof_vote,$3)::text as status",
        moderate:
          "select app_private.moderate_proof_checkin($1,$2,$3)::text as status",
        withdraw:
          "select app_private.withdraw_proof_checkin($1,$3)::text as status, $2::text as unused",
        report:
          "select app_private.report_proof_checkin($1,$3)::text as status, $2::text as unused",
      };
      const rows = (await query(actor, sql[action] ?? "", [id, choice, now]))
        .rows;
      setImmediate(() => void deliverPush());
      return reply(ok({ workoutCheckinId: id, status: rows[0]?.status }));
    }
    return reply(fail("not_found", 404));
  } catch (error) {
    return reply(dbError(error));
  }
}

const consequenceAction =
  /^\/v1\/consequences\/(redraw|select|claim|pause|resume|respond)$/;
async function consequences(request: Request, path: string): Promise<Response> {
  const reply = (response: ApiResponse) =>
    Response.json(response.body, { status: response.status });
  let actor: Actor | null;
  try {
    actor = await authUser(request.headers.get("authorization") ?? undefined);
  } catch {
    return reply(fail("domain_failure", 503));
  }
  if (!actor) return reply(fail("unauthorized", 401));
  const now = new Date().toISOString();
  try {
    if (path === "/v1/consequences" && request.method === "GET") {
      const rows = (
        await query(actor, "select app_private.consequence_home($1) as home", [
          now,
        ])
      ).rows;
      return reply(ok(rows[0]?.home));
    }
    const action = consequenceAction.exec(path)?.[1];
    if (!action || request.method !== "POST")
      return reply(fail("not_found", 404));
    let body: { target?: unknown; choice?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return reply(fail("invalid_request", 400));
    }
    if (!uuid(body?.target)) return reply(fail("invalid_request", 400));
    const choice = typeof body.choice === "string" ? body.choice : "";
    if (action === "select" && !uuid(choice))
      return reply(fail("invalid_request", 400));
    const rows = (
      await query(
        actor,
        "select app_private.consequence_command($1,$2,$3,$4) as home",
        [action, body.target, choice, now],
      )
    ).rows;
    setImmediate(() => void deliverPush());
    return reply(ok(rows[0]?.home));
  } catch (error) {
    return reply(dbError(error));
  }
}

const server = createServer(async (incoming, outgoing) => {
  const origin = incoming.headers.origin;
  if (origin && origin !== allowedOrigin) {
    outgoing.writeHead(403).end();
    return;
  }
  outgoing.setHeader("access-control-allow-origin", allowedOrigin);
  outgoing.setHeader(
    "access-control-allow-headers",
    "authorization,content-type,idempotency-key",
  );
  outgoing.setHeader(
    "access-control-allow-methods",
    "GET,POST,PUT,DELETE,OPTIONS",
  );
  if (incoming.method === "OPTIONS") {
    outgoing.writeHead(204).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 16384) throw new Error("Body too large");
      chunks.push(chunk);
    }
    const request = new Request(`http://localhost:${port}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as HeadersInit,
      body: ["GET", "HEAD"].includes(incoming.method ?? "")
        ? undefined
        : Buffer.concat(chunks),
    });
    const path = new URL(request.url).pathname;
    const response =
      path === "/v1/enrollment" && request.method === "POST"
        ? await enrollment(request)
        : path === "/v1/consent" && request.method === "POST"
          ? await consent(request)
          : path === "/v1/push" &&
              ["GET", "POST", "DELETE"].includes(request.method)
            ? await push(request)
            : path.startsWith("/v1/proof/")
              ? await proof(request, path)
              : path === "/v1/consequences" ||
                  path.startsWith("/v1/consequences/")
                ? await consequences(request, path)
                : await route(request);
    outgoing
      .writeHead(response.status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(await response.text());
  } catch (error) {
    console.error(
      "API request failed",
      error instanceof SyntaxError ? "malformed request" : "internal error",
    );
    const invalid =
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === "Body too large");
    const response = fail(
      invalid ? "invalid_request" : "domain_failure",
      invalid ? 400 : 500,
    );
    outgoing
      .writeHead(response.status, { "content-type": "application/json" })
      .end(JSON.stringify(response.body));
  }
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await pool.end();
}
process.on("SIGTERM", () => {
  void close();
});
process.on("SIGINT", () => {
  void close();
});
if (process.argv[2] === "seed-organizer") {
  const email = required("SEED_ORGANIZER_EMAIL");
  enroll(email, "", true)
    .then(() =>
      console.log(
        "Organizer seeded; age and consent remain required before Group creation",
      ),
    )
    .catch(() => {
      console.error(
        "Organizer seed failed; check whether already seeded or Auth/DB unavailable",
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
} else {
  server.listen(port, host, () => {
    console.log(`PWA API listening on ${port}`);
    void maintenance();
  });
  setInterval(() => {
    void maintenance();
  }, 60_000).unref();
}
