import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, useAvatars } from "./avatars";
import type { ProofItem } from "./proof";
import { isSeen, useSeenVersion } from "./seen";

export type StoryMember = { membershipId: string; displayName: string };

const label = (value: string) => value[0]?.toUpperCase() + value.slice(1);
const time = (item: ProofItem) => Date.parse(item.submittedAt);
const ago = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

type Ring = {
  member: StoryMember;
  own: boolean;
  // Oldest first, the order the viewer plays them.
  posts: ProofItem[];
  // Live: lights and dims at once.
  lit: boolean;
  // Sort keys from the seen state at feed load, so rings never move under a tap.
  litAtLoad: boolean;
  newestUnseen: number;
  newest: number;
};

// Lit rings by newest unseen post, then the rest by most recent post, the viewer last.
// Order uses `seenAtLoad`; the lit state uses live `seen`.
export function orderRings(
  members: StoryMember[],
  viewerId: string,
  posts: ProofItem[],
  seen: (item: ProofItem) => boolean,
  ownSince: number | null,
  seenAtLoad: (item: ProofItem) => boolean = seen,
): Ring[] {
  const rings = members.map((member) => {
    const own = member.membershipId === viewerId;
    const mine = posts
      .filter(
        (item) =>
          item.authorMembershipId === member.membershipId &&
          (!own || ownSince === null || time(item) >= ownSince),
      )
      .sort((left, right) => time(left) - time(right));
    const unseen = own ? [] : mine.filter((item) => !seenAtLoad(item));
    return {
      member,
      own,
      posts: mine,
      lit: !own && mine.some((item) => !seen(item)),
      litAtLoad: unseen.length > 0,
      newestUnseen: unseen.length ? time(unseen[unseen.length - 1]) : 0,
      newest: mine.length ? time(mine[mine.length - 1]) : 0,
    };
  });
  return rings.sort(
    (left, right) =>
      Number(left.own) - Number(right.own) ||
      Number(right.litAtLoad) - Number(left.litAtLoad) ||
      (left.litAtLoad
        ? right.newestUnseen - left.newestUnseen
        : right.newest - left.newest) ||
      left.member.displayName.localeCompare(right.member.displayName),
  );
}

// Oldest unseen post, or the newest when all are seen; your own week plays from its start.
const startAt = (ring: Ring, seen: (item: ProofItem) => boolean) => {
  if (ring.own) return 0;
  const first = ring.posts.findIndex((item) => !seen(item));
  return first >= 0 ? first : Math.max(0, ring.posts.length - 1);
};

export function StoryRings({
  members,
  viewerId,
  posts,
  cacheKey,
  ownSince,
  seenAtLoad,
}: {
  members: StoryMember[];
  viewerId: string;
  posts: ProofItem[];
  cacheKey: string;
  ownSince: number | null;
  // Post ids seen when the feed loaded; the order re-sorts only when it changes.
  seenAtLoad: ReadonlySet<string>;
}) {
  useSeenVersion();
  const avatars = useAvatars();
  const seen = (item: ProofItem) => isSeen(cacheKey, item);
  const rings = orderRings(members, viewerId, posts, seen, ownSince, (item) =>
    seenAtLoad.has(item.workoutCheckinId),
  );
  const [open, setOpen] = useState<{ id: string; index: number } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus({ preventScroll: true });
  }, []);
  const ring = open && rings.find((r) => r.member.membershipId === open.id);
  if (rings.length === 0) return null;
  return (
    <>
      <section className="story-rings" aria-label="Stories">
        {rings.map((r) => {
          const name = r.own ? "You" : r.member.displayName;
          return (
            <button
              key={r.member.membershipId}
              type="button"
              className={`story-ring${r.lit ? " is-new" : ""}`}
              aria-label={`${name}, ${r.lit ? "new posts" : r.posts.length ? "all seen" : "no posts"}`}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen({ id: r.member.membershipId, index: startAt(r, seen) });
              }}
            >
              <span className="story-ring-disc">
                <Avatar
                  name={r.member.displayName}
                  url={avatars[r.member.membershipId]}
                />
              </span>
              <span className="story-ring-name" aria-hidden="true">
                {name}
              </span>
            </button>
          );
        })}
      </section>
      {ring && open && (
        <StoryViewer
          ring={ring}
          index={open.index}
          cacheKey={cacheKey}
          avatar={avatars[ring.member.membershipId]}
          onIndex={(index) => setOpen({ id: open.id, index })}
          onClose={close}
        />
      )}
    </>
  );
}

const focusable = "button:not([disabled])";

function StoryViewer({
  ring,
  index,
  cacheKey,
  avatar,
  onIndex,
  onClose,
}: {
  ring: Ring;
  index: number;
  cacheKey: string;
  avatar?: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const name = ring.own ? "You" : ring.member.displayName;
  const count = ring.posts.length;
  const item = ring.posts[Math.min(index, count - 1)];
  const next = useCallback(
    () => (index + 1 < count ? onIndex(index + 1) : onClose()),
    [index, count, onIndex, onClose],
  );
  const back = useCallback(
    () => onIndex(Math.max(0, index - 1)),
    [index, onIndex],
  );
  useEffect(() => {
    closeRef.current?.focus();
    document.documentElement.classList.add("post-viewer-open");
    return () => document.documentElement.classList.remove("post-viewer-open");
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight" && count) {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && count) {
        event.preventDefault();
        back();
      } else if (event.key === "Tab" && root.current) {
        const controls = [
          ...root.current.querySelectorAll<HTMLElement>(focusable),
        ];
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!root.current.contains(active)) {
          event.preventDefault();
          first?.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, back, count, onClose]);
  return (
    <div
      ref={root}
      className="story-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${ring.own ? "Your" : `${ring.member.displayName}’s`} story`}
    >
      {count > 0 && (
        <div className="story-ticks" aria-hidden="true">
          {ring.posts.map((post, k) => (
            <span
              key={post.workoutCheckinId}
              className={
                k < index ? "is-done" : k === index ? "is-on" : undefined
              }
            />
          ))}
        </div>
      )}
      <header className="story-head">
        <Avatar name={ring.member.displayName} url={avatar} size="md" />
        <strong>{name}</strong>
        {item && (
          <time dateTime={item.submittedAt}>{ago(item.submittedAt)}</time>
        )}
        <button
          ref={closeRef}
          type="button"
          className="story-close"
          aria-label="Close story"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      {item ? (
        <>
          <figure
            key={item.workoutCheckinId}
            className="story-frame"
            data-unseen={
              isSeen(cacheKey, item) ? undefined : item.workoutCheckinId
            }
          >
            {item.activityPhotoUrl ? (
              <img
                className="story-photo"
                src={item.activityPhotoUrl}
                alt={`${ring.own ? "Your" : `${ring.member.displayName}'s`} workout activity`}
                decoding="async"
                crossOrigin="anonymous"
              />
            ) : (
              <span className="story-photo" />
            )}
            {item.presencePhotoUrl && (
              <img
                className="story-inset"
                src={item.presencePhotoUrl}
                alt={`${name} at the workout`}
                decoding="async"
                crossOrigin="anonymous"
              />
            )}
            <figcaption className="story-cap">
              <strong>
                {item.hidden
                  ? "Reported"
                  : `${label(item.activityType)} · ${item.durationMinutes} min`}
              </strong>
              <span>{label(item.perceivedIntensity)} intensity</span>
            </figcaption>
          </figure>
          <p className="visually-hidden" aria-live="polite">
            Post {index + 1} of {count}
          </p>
          <div className="story-taps">
            <button
              type="button"
              className="story-tap"
              aria-label="Previous post"
              onClick={back}
            />
            <button
              type="button"
              className="story-tap"
              aria-label={
                index + 1 < count ? "Next post" : "Close after last post"
              }
              onClick={next}
            />
          </div>
        </>
      ) : (
        <button type="button" className="story-empty" onClick={onClose}>
          {ring.own
            ? "You haven’t posted this week."
            : `${ring.member.displayName} hasn’t posted this week or last.`}
          <span>Tap to close</span>
        </button>
      )}
    </div>
  );
}
