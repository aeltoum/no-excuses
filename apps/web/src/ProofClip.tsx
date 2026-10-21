import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError } from "./api-client";
import { Sheet } from "./Sheet";

type Challenge = {
  challengeId: string;
  code: string;
  action: string;
  receivedAt?: number;
};
// The server allows 2 minutes from issue to upload; renew a little early for clock and network slack.
const challengeLifeMs = 100_000;

export const maxClipSeconds = 30;
// Safari records MP4 and Chrome WebM; the first one the browser supports wins.
const clipTypes = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const pickClipType = () =>
  typeof MediaRecorder === "undefined"
    ? undefined
    : clipTypes.find((type) => MediaRecorder.isTypeSupported(type));

async function post<T>(
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("failure", "Connection failed. Try again.", true);
  }
  if (response.status === 401)
    throw new ApiError("unauthorized", "Access ended. Sign in again.");
  if (response.status === 403)
    throw new ApiError(
      "denied",
      "That code expired. Record again with a new code.",
    );
  if (!response.ok)
    throw new ApiError("failure", "Something went wrong. Try again.", true);
  return ((await response.json()) as { data: T }).data;
}

const clock = (seconds: number) => `0:${String(seconds).padStart(2, "0")}`;

// Live capture only: a server code and action on screen, up to 30 seconds, no gallery picker.
export function ProofClip({
  apiBaseUrl,
  token,
  attemptId,
  title,
  notice,
  onError,
  onClose,
  onSubmit,
}: {
  apiBaseUrl: string;
  token: string;
  attemptId: string;
  title: string;
  notice: ReactNode;
  onError: (error: unknown) => void;
  onClose: () => void;
  onSubmit: (clipPath: string) => Promise<boolean>;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const issued = useRef(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; type: string } | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [challengeFailed, setChallengeFailed] = useState(false);

  const newChallenge = useCallback(() => {
    // Each issue replaces the last on the server, so only the newest answer counts.
    const issue = ++issued.current;
    setChallenge(null);
    setChallengeFailed(false);
    post<Challenge>(apiBaseUrl, token, "/v1/consequences/challenge", {
      attemptId,
    })
      .then((next) => {
        if (issue === issued.current)
          setChallenge({ ...next, receivedAt: Date.now() });
      })
      .catch((error) => {
        if (issue !== issued.current) return;
        setChallengeFailed(true);
        onError(error);
      });
  }, [apiBaseUrl, token, attemptId, onError]);

  // Kept in a ref so a token refresh (e.g. on refocus after Android's permission prompt)
  // never tears down and reopens the camera, which Android reports as busy.
  const reportError = useRef(onError);
  reportError.current = onError;

  useEffect(() => {
    newChallenge();
  }, [newChallenge]);

  useEffect(() => {
    let live = true;
    const fail = (text: string) =>
      reportError.current(new ApiError("failure", text));
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      fail(
        "This browser can’t open the camera here. Use a secure (https) link.",
      );
      return;
    }
    // A permission prompt that never appears leaves getUserMedia pending forever.
    const stalled = window.setTimeout(
      () =>
        fail(
          "Camera didn’t open. Allow camera for this site in Chrome (Site settings › Camera) and try again.",
        ),
      10_000,
    );
    const denied = (error: unknown) =>
      error instanceof DOMException && error.name === "NotAllowedError";
    const open = (video: MediaTrackConstraints) =>
      media.getUserMedia({ video, audio: true });
    // Proof needs sound: a blocked mic fails the request even with camera allowed,
    // so probe the camera alone to tell the member which permission to allow.
    const blocked = () =>
      media
        .getUserMedia({ video: true })
        .then((probe) => {
          for (const track of probe.getTracks()) track.stop();
          return "microphone";
        })
        .catch(() => "camera");
    open({ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" })
      // Some Android cameras reject the sized request; fall back to defaults.
      .catch((error: unknown) =>
        denied(error) ? Promise.reject(error) : open({ facingMode: "user" }),
      )
      .then((granted) => {
        window.clearTimeout(stalled);
        if (!live) {
          for (const track of granted.getTracks()) track.stop();
          return;
        }
        stream.current = granted;
        if (preview.current) {
          preview.current.srcObject = granted;
          void preview.current.play().catch(() => {});
        }
        setCameraReady(true);
      })
      .catch(async (error: unknown) => {
        window.clearTimeout(stalled);
        if (!live) return;
        const missing = denied(error) ? await blocked() : null;
        if (!live) return;
        fail(
          missing === "microphone"
            ? "Proof needs sound. Allow microphone for this site in Chrome (Site settings › Microphone) and try again."
            : missing === "camera"
              ? "Camera access is needed to record proof. Allow it and try again."
              : error instanceof DOMException &&
                  error.name === "NotReadableError"
                ? "The camera or microphone is in use by another app. Close it and try again."
                : `Camera didn’t open. Try again.${
                    error instanceof DOMException ? ` (${error.name})` : ""
                  }`,
        );
      });
    return () => {
      live = false;
      window.clearTimeout(stalled);
      if (recorder.current?.state === "recording") recorder.current.stop();
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
    };
  }, []);

  // A code left on screen too long is swapped for a fresh one before recording starts.
  useEffect(() => {
    if (!challenge?.receivedAt || recording || clip) return;
    const timer = window.setTimeout(
      newChallenge,
      Math.max(0, challenge.receivedAt + challengeLifeMs - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [challenge, recording, clip, newChallenge]);

  useEffect(() => {
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob);
    setClipUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setClipUrl(null);
    };
  }, [clip]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const tick = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(Math.min(seconds, maxClipSeconds));
      if (seconds >= maxClipSeconds) recorder.current?.stop();
    }, 250);
    return () => window.clearInterval(tick);
  }, [recording]);

  const start = () => {
    const media = stream.current;
    const type = pickClipType();
    if (!media || !type) {
      onError(
        new ApiError("failure", "This browser can’t record video in the app."),
      );
      return;
    }
    const chunks: Blob[] = [];
    const next = new MediaRecorder(media, {
      mimeType: type,
      videoBitsPerSecond: 1_500_000,
      audioBitsPerSecond: 64_000,
    });
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = () => {
      setRecording(false);
      const base = type.split(";")[0] ?? type;
      setClip({ blob: new Blob(chunks, { type: base }), type: base });
    };
    recorder.current = next;
    setClip(null);
    setElapsed(0);
    next.start(1000);
    setRecording(true);
  };

  const send = async () => {
    if (!clip || !challenge || sending) return;
    if (Date.now() > (challenge.receivedAt ?? 0) + challengeLifeMs + 15_000) {
      onError(
        new ApiError(
          "denied",
          "That code expired. Record again with a new code.",
        ),
      );
      retake();
      return;
    }
    setSending(true);
    try {
      const target = await post<{ path: string; uploadUrl: string }>(
        apiBaseUrl,
        token,
        "/v1/consequences/clip-upload",
        { challengeId: challenge.challengeId, mimeType: clip.type },
      );
      let response: Response;
      try {
        response = await fetch(target.uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": clip.type,
            "x-upsert": "false",
            "cache-control": "max-age=31536000",
          },
          body: clip.blob,
          // Up to 12 MiB over a slow mobile link; a stalled upload must fail.
          signal: AbortSignal.timeout(180_000),
        });
      } catch {
        throw new ApiError("failure", "Video upload failed. Try again.", true);
      }
      if (!response.ok)
        throw new ApiError("failure", "Video upload failed. Try again.", true);
      if (await onSubmit(target.path)) onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSending(false);
    }
  };

  const retake = () => {
    setClip(null);
    setElapsed(0);
    newChallenge();
  };

  return (
    <Sheet open title="Record proof" onDismiss={onClose} dismissible={!sending}>
      <div className="proof-clip">
        <p className="clip-rules">
          Recorded right now, in the app, up to {maxClipSeconds} seconds. Start
          by saying the code and doing the action, then do {title}.
        </p>
        <div className="clip-challenge" aria-live="polite">
          {challenge ? (
            <>
              <span className="clip-code">
                <span className="visually-hidden">Your code </span>
                {challenge.code}
              </span>
              <span className="clip-action">{challenge.action}</span>
            </>
          ) : challengeFailed ? (
            <button
              type="button"
              className="secondary-button"
              onClick={newChallenge}
            >
              Get a code
            </button>
          ) : (
            <span className="clip-placeholder">Getting your code…</span>
          )}
        </div>
        <div className="clip-stage">
          <video
            ref={preview}
            className="clip-preview"
            hidden={Boolean(clipUrl)}
            muted
            autoPlay
            playsInline
            aria-label="Camera preview"
          />
          {clipUrl && (
            // biome-ignore lint/a11y/useMediaCaption: member-recorded proof has no captions
            <video
              className="clip-preview"
              src={clipUrl}
              controls
              playsInline
              aria-label="Your recorded proof"
            />
          )}
        </div>
        <p className="clip-timer" aria-live="off">
          {recording
            ? `Recording ${clock(elapsed)} · ${clock(maxClipSeconds - elapsed)} left`
            : clip
              ? `Recorded ${clock(elapsed)}`
              : `Up to ${clock(maxClipSeconds)}`}
        </p>
        <div className="proof-actions">
          {recording ? (
            <button type="button" onClick={() => recorder.current?.stop()}>
              Stop recording
            </button>
          ) : clip ? (
            <>
              <button
                type="button"
                disabled={sending}
                aria-busy={sending}
                onClick={() => void send()}
              >
                {sending ? "Sending…" : "Send proof"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={sending}
                onClick={retake}
              >
                Record again
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!cameraReady || !challenge}
              aria-busy={!cameraReady || !challenge}
              onClick={start}
            >
              {!cameraReady
                ? "Opening camera…"
                : challenge
                  ? "Start recording"
                  : "Getting code…"}
            </button>
          )}
        </div>
        {notice}
      </div>
    </Sheet>
  );
}
