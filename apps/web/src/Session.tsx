import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api-client";
import type { HomeExtras } from "./extras";
import { onClearPersisted } from "./persist";
import { call, compressPhoto } from "./proof";

export type Candidate = { id: string; blob: Blob; url: string };

// Photos taken during a session stay on this device until two are picked.
let candidates: Candidate[] = [];
const listeners = new Set<() => void>();
const publish = (next: Candidate[]) => {
  candidates = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useCandidates = () =>
  useSyncExternalStore(subscribe, () => candidates);
// Drops every candidate except those kept for the post.
export function clearCandidates(keep: string[] = []) {
  for (const item of candidates)
    if (!keep.includes(item.id)) URL.revokeObjectURL(item.url);
  publish([]);
}
onClearPersisted(() => clearCandidates());

const elapsed = (from: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(from)) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
};

type Notice = { kind: "success" | "error"; text: string };

// Home: start a timed workout, snap photos while it runs, then finish into the log sheet.
export function SessionCard({
  apiBaseUrl,
  token,
  extras,
  apply,
  onFinish,
  onNotice,
}: {
  apiBaseUrl: string;
  token: string;
  extras: HomeExtras;
  apply: (next: HomeExtras) => void;
  onFinish: (sessionId: string, minutes: number) => void;
  onNotice: (notice: Notice) => void;
}) {
  const session = extras.session;
  const [now, setNow] = useState(Date.now);
  const shots = useCandidates();
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);
  const fail = (previous: HomeExtras) => (error: unknown) => {
    apply(previous);
    onNotice({
      kind: "error",
      text:
        error instanceof ApiError ? error.message : "Couldn’t save. Try again.",
    });
  };
  const start = () => {
    const previous = extras;
    const id = crypto.randomUUID();
    // Optimistic: the timer runs at once.
    apply({ ...extras, session: { id, startedAt: new Date().toISOString() } });
    setNow(Date.now());
    call(apiBaseUrl, token, `/v1/sessions/${id}/start`, {
      method: "POST",
      body: {},
    }).catch(fail(previous));
  };
  const finish = () => {
    if (!session) return;
    const previous = extras;
    const minutes = Math.max(
      1,
      Math.round((Date.now() - Date.parse(session.startedAt)) / 60_000),
    );
    apply({ ...extras, session: null });
    onFinish(session.id, minutes);
    call(apiBaseUrl, token, `/v1/sessions/${session.id}/end`, {
      method: "POST",
      body: {},
    }).catch(fail(previous));
  };
  const snap = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const blob = await compressPhoto(file);
      publish([
        ...candidates,
        { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) },
      ]);
    } catch {
      onNotice({ kind: "error", text: "Couldn’t use that photo. Try again." });
    }
  };
  if (!session)
    return (
      <button
        type="button"
        className="text-button session-start"
        onClick={start}
      >
        Start a timed workout
      </button>
    );
  return (
    <section className="session-card" aria-label="Workout in progress">
      <p className="session-timer" role="timer">
        <span>Workout in progress</span>
        <strong>{elapsed(session.startedAt, now)}</strong>
      </p>
      {shots.length > 0 && (
        <ul className="session-shots" aria-label="Photos this session">
          {shots.map((shot, index) => (
            <li key={shot.id}>
              <img src={shot.url} alt={`Session shot ${index + 1}`} />
            </li>
          ))}
        </ul>
      )}
      <div className="session-actions">
        <label className="secondary-button session-snap">
          Gear photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void snap(event)}
          />
        </label>
        <label className="secondary-button session-snap">
          Selfie
          <input
            type="file"
            accept="image/*"
            capture="user"
            onChange={(event) => void snap(event)}
          />
        </label>
        <button type="button" onClick={finish}>
          Finish
        </button>
      </div>
      <p className="hint">
        Photos stay on your phone until you pick two for your post.
      </p>
    </section>
  );
}
