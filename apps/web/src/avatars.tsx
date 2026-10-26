import { useSyncExternalStore } from "react";
import { onClearPersisted, persistentMap } from "./persist";
import { call, compressPhoto, uploadProofPhoto } from "./proof";

type Avatars = Record<string, string>;

// Profile photos by membership id, kept across launches so faces show at once.
const saved = persistentMap<Avatars>("avatars");
let avatars: Avatars = saved.get("group") ?? {};
const listeners = new Set<() => void>();
const publish = (next: Avatars) => {
  avatars = next;
  saved.set("group", next);
  for (const listener of listeners) listener();
};
onClearPersisted(() => {
  avatars = {};
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Home extras carry the Group's photos; keep a URL whose file is unchanged so
// the browser reuses the cached image.
export function publishAvatars(loaded: Record<string, unknown>) {
  const next: Avatars = {};
  for (const [id, url] of Object.entries(loaded))
    if (typeof url === "string")
      next[id] =
        avatars[id]?.split("?")[0] === url.split("?")[0] ? avatars[id] : url;
  if (JSON.stringify(next) !== JSON.stringify(avatars)) publish(next);
}

export function useAvatars() {
  return useSyncExternalStore(subscribe, () => avatars);
}

// Optimistic: the new photo shows at once; a failure restores the old one.
export async function setAvatar(
  apiBaseUrl: string,
  token: string,
  membershipId: string,
  file: Blob | null,
) {
  const previous = avatars;
  const next = { ...avatars };
  if (file) next[membershipId] = URL.createObjectURL(file);
  else delete next[membershipId];
  publish(next);
  try {
    const path = file
      ? await uploadProofPhoto(
          apiBaseUrl,
          token,
          "avatar",
          await compressPhoto(file, 480),
        )
      : null;
    await call(apiBaseUrl, token, "/v1/avatars", {
      method: "POST",
      body: { path },
    });
  } catch (error) {
    publish(previous);
    throw error;
  }
}

export function Avatar({
  name,
  url,
  size = "md",
}: {
  name: string;
  url?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {url ? (
        <img src={url} alt="" decoding="async" />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

// Account: tap the photo to take or pick a new one.
export function ProfilePhoto({
  apiBaseUrl,
  token,
  membershipId,
  name,
  onNotice,
}: {
  apiBaseUrl: string;
  token: string;
  membershipId: string;
  name: string;
  onNotice: (notice: { kind: "success" | "error"; text: string }) => void;
}) {
  const url = useAvatars()[membershipId];
  const save = (file: Blob | null) =>
    setAvatar(apiBaseUrl, token, membershipId, file).then(
      () =>
        onNotice({
          kind: "success",
          text: file ? "Photo saved." : "Photo removed.",
        }),
      (error) =>
        onNotice({
          kind: "error",
          text:
            error instanceof Error && error.message
              ? error.message
              : "Couldn’t save your photo. Try again.",
        }),
    );
  return (
    <span className="profile-photo">
      <label className="profile-photo-pick">
        <Avatar name={name} url={url} size="lg" />
        <span className="profile-photo-badge" aria-hidden="true">
          +
        </span>
        <span className="visually-hidden">
          {url ? "Change profile photo" : "Add profile photo"}
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void save(file);
          }}
        />
      </label>
      {url && (
        <button
          type="button"
          className="text-button profile-photo-remove"
          onClick={() => void save(null)}
        >
          Remove photo
        </button>
      )}
    </span>
  );
}
