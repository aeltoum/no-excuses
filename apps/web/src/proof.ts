import { ApiError, requestTimeoutMs } from "./api-client";
import { onClearPersisted } from "./persist";

export type ProofItem = {
  workoutCheckinId: string;
  authorMembershipId: string;
  authorName: string;
  mine: boolean;
  activityType: string;
  durationMinutes: number;
  perceivedIntensity: string;
  completedAt: string;
  submittedAt: string;
  reviewStatus: "pending" | "verified" | "questioned";
  reviewClosesAt: string | null;
  decisionClosesAt: string | null;
  hidden: boolean;
  myVote: "accept" | "reject" | "cannot_assess" | null;
  acceptVotes: number;
  rejectVotes: number;
  eligibleVoters: number;
  canReview: boolean;
  canVote: boolean;
  activityPhotoUrl: string | null;
  presencePhotoUrl: string | null;
  reactions: ReactionCount[];
  myReactions: string[];
};

export type ReactionCount = { emoji: string; count: number };
// Members may leave up to this many distinct emoji on one post.
export const reactionLimit = 6;

export type ProofAction =
  | "review"
  | "vote"
  | "withdraw"
  | "report"
  | "moderate";

async function call<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new ApiError("failure", "Connection failed. Try again.", true);
  }
  if (response.status === 401)
    throw new ApiError("unauthorized", "Access ended. Sign in again.");
  if (response.status === 403)
    throw new ApiError("denied", "That action is no longer available.");
  if (response.status === 409)
    throw new ApiError("conflict", "That changed. Refresh and try again.");
  if (!response.ok)
    throw new ApiError("failure", "Something went wrong. Try again.", true);
  return ((await response.json()) as { data: T }).data;
}

export async function loadProofFeed(baseUrl: string, token: string) {
  const items = await call<unknown>(baseUrl, token, "/v1/proof/feed", {
    method: "GET",
  });
  if (!Array.isArray(items))
    throw new ApiError("failure", "Couldn’t load the proof feed.", true);
  return items as ProofItem[];
}

export const actOnProof = (
  baseUrl: string,
  token: string,
  id: string,
  action: ProofAction,
  choice = "",
) =>
  call<{ status: string }>(baseUrl, token, `/v1/proof/${id}/${action}`, {
    method: "POST",
    body: { choice },
  });

export const reactToProof = (
  baseUrl: string,
  token: string,
  id: string,
  emoji: string,
  on: boolean,
) =>
  call<{ emoji: string; on: boolean }>(
    baseUrl,
    token,
    `/v1/proof/${id}/react`,
    { method: "POST", body: { emoji, on } },
  );

export type Reactor = { emoji: string; name: string; mine: boolean };

// Names cached per proof for the session; one request per proof at a time.
const reactorCache = new Map<string, Reactor[]>();
const reactorRequests = new Map<string, Promise<Reactor[]>>();
// Requests from before a sign-out neither fill the cache nor serve the next member.
let reactorGeneration = 0;
onClearPersisted(() => {
  reactorGeneration++;
  reactorCache.clear();
  reactorRequests.clear();
});

export const cachedReactors = (id: string) => reactorCache.get(id);

export function loadReactors(baseUrl: string, token: string, id: string) {
  const pending = reactorRequests.get(id);
  if (pending) return pending;
  const generation = reactorGeneration;
  const request = call<unknown>(baseUrl, token, `/v1/proof/${id}/reactions`, {
    method: "GET",
  })
    .then((rows) => {
      if (!Array.isArray(rows))
        throw new ApiError("failure", "Couldn’t load reactions.", true);
      if (generation === reactorGeneration)
        reactorCache.set(id, rows as Reactor[]);
      return rows as Reactor[];
    })
    .finally(() => {
      if (reactorRequests.get(id) === request) reactorRequests.delete(id);
    });
  reactorRequests.set(id, request);
  return request;
}

export const loadNudged = (baseUrl: string, token: string) =>
  call<string[]>(baseUrl, token, "/v1/nudges", { method: "GET" });

export const nudgeMember = (
  baseUrl: string,
  token: string,
  membershipId: string,
) =>
  call<{ membershipId: string }>(baseUrl, token, "/v1/nudges", {
    method: "POST",
    body: { membershipId },
  });

// Re-encoding through a canvas strips EXIF (including location) and bounds the upload size.
export async function compressPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8),
  );
  if (!blob) throw new ApiError("failure", "Couldn’t process that photo.");
  return blob;
}

export async function uploadProofPhoto(
  baseUrl: string,
  token: string,
  kind: "activity" | "presence",
  photo: Blob,
): Promise<string> {
  const target = await call<{ path: string; uploadUrl: string }>(
    baseUrl,
    token,
    "/v1/proof/uploads",
    { method: "POST", body: { kind } },
  );
  let response: Response;
  try {
    response = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "image/jpeg",
        "x-upsert": "false",
        // Proof photos never change once uploaded, so browsers may keep them.
        "cache-control": "max-age=31536000",
      },
      body: photo,
      // Photos are bounded to 1600 px, so a minute covers slow mobile links;
      // a stalled upload must fail, never spin forever.
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ApiError("failure", "Photo upload failed. Try again.", true);
  }
  if (!response.ok)
    throw new ApiError("failure", "Photo upload failed. Try again.", true);
  return target.path;
}
