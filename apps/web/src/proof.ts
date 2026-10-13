import { ApiError } from "./api-client";

export type ProofItem = {
  workoutCheckinId: string;
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
};

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

export const loadProofFeed = (baseUrl: string, token: string) =>
  call<ProofItem[]>(baseUrl, token, "/v1/proof/feed", { method: "GET" });

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
      headers: { "content-type": "image/jpeg", "x-upsert": "false" },
      body: photo,
    });
  } catch {
    throw new ApiError("failure", "Photo upload failed. Try again.", true);
  }
  if (!response.ok)
    throw new ApiError("failure", "Photo upload failed. Try again.", true);
  return target.path;
}
