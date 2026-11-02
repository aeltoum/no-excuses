import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { Avatar } from "./avatars";
import { ClipPlayer } from "./ClipPlayer";
import { useFreshness } from "./freshness";
import { PostText } from "./PostText";
import { persistentMap } from "./persist";
import {
  cachedReactors,
  call,
  loadClipReactors,
  type ProofMessage,
  postClipMessage,
  type ReactionCount,
  reactToClip,
} from "./proof";
import { Reactions } from "./Reactions";
import { Sheet } from "./Sheet";

// An approved Consequence claim, shown on the Wall as a clip post.
export type ConsequencePost = {
  claimId: string;
  authorMembershipId: string;
  authorName: string;
  mine: boolean;
  cardTitle: string;
  submittedAt: string;
  approvedAt: string;
  clipUrl: string | null;
  reactions?: ReactionCount[];
  myReactions?: string[];
  messages?: ProofMessage[];
};

type Notice = { kind: "success" | "error"; text: string };

export const clipPostId = (post: ConsequencePost) => `clip:${post.claimId}`;

const saved = persistentMap<ConsequencePost[]>("consequence-feed");

// The Group's approved Consequence clips; the last list shows at once.
export function useConsequencePosts(
  apiBaseUrl: string,
  token: string,
  cacheKey: string,
  revision: number,
) {
  const [posts, setPosts] = useState<ConsequencePost[]>(
    () => saved.get(cacheKey) ?? [],
  );
  const fresh = useFreshness();
  useEffect(() => {
    void fresh;
    void revision;
    let active = true;
    call<ConsequencePost[]>(apiBaseUrl, token, "/v1/consequences/feed", {
      method: "GET",
    })
      .then((list) => {
        if (!active || !Array.isArray(list)) return;
        saved.set(cacheKey, list);
        setPosts(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [apiBaseUrl, token, cacheKey, revision, fresh]);
  return posts;
}

// First frames as small JPEGs, per claim, so a reopened Wall shows tiles at once.
const thumbs = persistentMap<string>("consequence-thumbs");
const thumbLimit = 40;

function grabFrame(video: HTMLVideoElement) {
  const width = 240;
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  if (!height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // A cross-origin frame without CORS taints the canvas; keep the video.
    return null;
  }
}

// A cached frame shows at once; otherwise the clip loads only near the viewport.
function ClipThumb({ post }: { post: ConsequencePost }) {
  const [thumb, setThumb] = useState(() => thumbs.get(post.claimId));
  const [near, setNear] = useState(false);
  // Without CORS headers the clip still plays as a plain poster video.
  const [plain, setPlain] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (thumb || near || !post.clipUrl) return;
    const element = holder.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [thumb, near, post.clipUrl]);
  if (thumb) return <img className="day-tile-photo" src={thumb} alt="" />;
  if (!post.clipUrl || !near)
    return <span ref={holder} className="day-tile-photo" />;
  return (
    <video
      className="day-tile-photo"
      src={post.clipUrl}
      crossOrigin={plain ? undefined : "anonymous"}
      onError={() => setPlain(true)}
      muted
      playsInline
      preload="auto"
      // Seek past a black first frame; the frame is grabbed once it lands.
      onLoadedData={(event) => {
        event.currentTarget.currentTime = 0.1;
      }}
      onSeeked={(event) => {
        const frame = grabFrame(event.currentTarget);
        if (!frame) return;
        for (const key of [...thumbs.keys()].slice(
          0,
          Math.max(0, thumbs.size - thumbLimit + 1),
        ))
          thumbs.delete(key);
        thumbs.set(post.claimId, frame);
        setThumb(frame);
      }}
    />
  );
}

export function ConsequenceTile({
  post,
  onOpen,
}: {
  post: ConsequencePost;
  onOpen: (from: HTMLElement) => void;
}) {
  const who = post.mine ? "You" : post.authorName;
  return (
    <li className="day-tile">
      <button
        type="button"
        className="day-tile-open"
        aria-label={`${who}, Consequence: ${post.cardTitle}. Open post`}
        onClick={(event) => onOpen(event.currentTarget)}
      >
        <ClipThumb post={post} />
        <span className="day-tile-play" aria-hidden="true" />
        <span className="day-tile-cap" aria-hidden="true">
          <strong className="day-tile-name">{who}</strong>
          <span className="day-tile-workout">{post.cardTitle}</span>
        </span>
        <span className="day-tile-verdict is-consequence" aria-hidden="true">
          Consequence
        </span>
      </button>
    </li>
  );
}

export function ConsequencePostView({
  post,
  avatarUrl,
  ago,
  apiBaseUrl,
  token,
  ensureConduct,
  confirmReport,
  onNotice,
  onRevoked,
}: {
  post: ConsequencePost;
  avatarUrl?: string;
  ago: (iso: string) => string;
  apiBaseUrl: string;
  token: string;
  ensureConduct: () => Promise<boolean>;
  confirmReport: () => Promise<boolean>;
  onNotice: (notice: Notice) => void;
  onRevoked: () => void;
}) {
  const who = post.mine ? "You" : post.authorName;
  const id = clipPostId(post);
  // Optimistic reactions; a refetched post resets them to the server's.
  const [reactions, setReactions] = useState(post.reactions ?? []);
  const [mine, setMine] = useState(post.myReactions ?? []);
  useEffect(() => {
    setReactions(post.reactions ?? []);
    setMine(post.myReactions ?? []);
  }, [post.reactions, post.myReactions]);
  const [askComment, setAskComment] = useState(0);
  const apply = (emoji: string, add: boolean) => {
    const step = add ? 1 : -1;
    setReactions((current) =>
      (current.some((entry) => entry.emoji === emoji)
        ? current.map((entry) =>
            entry.emoji === emoji
              ? { ...entry, count: entry.count + step }
              : entry,
          )
        : [...current, { emoji, count: 1 }]
      ).filter((entry) => entry.count > 0),
    );
    setMine((current) =>
      add ? [...current, emoji] : current.filter((entry) => entry !== emoji),
    );
  };
  const react = (emoji: string, on: boolean) => {
    apply(emoji, on);
    reactToClip(apiBaseUrl, token, post.claimId, emoji, on).catch((error) => {
      apply(emoji, !on);
      if (error instanceof ApiError && error.kind === "unauthorized")
        onRevoked();
      onNotice({
        kind: "error",
        text:
          error instanceof ApiError
            ? error.message
            : "Couldn’t save. Try again.",
      });
    });
  };
  return (
    <li className="proof-post consequence-post" data-post={id}>
      <header>
        <Avatar name={who} url={avatarUrl} />
        <span className="proof-byline">
          <strong>{who}</strong>
          <time dateTime={post.approvedAt}>{ago(post.approvedAt)}</time>
        </span>
        <span className="proof-status proof-consequence">Consequence ✓</span>
      </header>
      <div className="consequence-clip">
        <span className="proof-consequence-label">Consequence</span>
        {post.clipUrl ? (
          <ClipPlayer url={post.clipUrl} label={`${who}’s Consequence clip`} />
        ) : (
          <p className="consequence-clip-missing">Clip unavailable</p>
        )}
      </div>
      <p className="consequence-card-title">
        <strong>{post.cardTitle}</strong>
        <span>Approved by the Group. Card cleared.</span>
      </p>
      <Reactions
        reactions={reactions}
        mine={mine}
        readOnly={post.mine}
        onToggle={react}
        loadReactors={() => loadClipReactors(apiBaseUrl, token, post.claimId)}
        cachedReactors={() => cachedReactors(id)}
        trailing={
          <button
            type="button"
            className="proof-reaction proof-comment"
            aria-label="Comment"
            onClick={() => setAskComment((count) => count + 1)}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z" />
            </svg>
          </button>
        }
      />
      <PostText
        item={{ workoutCheckinId: id, caption: null, messages: post.messages }}
        authorName={who}
        askComment={askComment}
        apiBaseUrl={apiBaseUrl}
        token={token}
        ensureConduct={ensureConduct}
        confirmReport={confirmReport}
        onNotice={onNotice}
        postComment={(messageId, body) =>
          postClipMessage(apiBaseUrl, token, post.claimId, messageId, body)
        }
      />
    </li>
  );
}

// Celebrated claims, per device: the pop-up shows once for each.
const celebrated = persistentMap<string[]>("consequence-celebrated");

// The next open after the viewer's own card is approved says so, once.
export function CardClearedPopup({ posts }: { posts: ConsequencePost[] }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(
    () => new Set(celebrated.get("ids") ?? []),
  );
  const week = 7 * 86_400_000;
  const due = posts.find(
    (post) =>
      post.mine &&
      !shown.has(post.claimId) &&
      Date.now() - Date.parse(post.approvedAt) < week,
  );
  const close = () => {
    if (!due) return;
    const next = new Set(shown).add(due.claimId);
    celebrated.set("ids", [...next].slice(-50));
    setShown(next);
  };
  return (
    <Sheet open={Boolean(due)} title="Card cleared" onDismiss={close}>
      {due && (
        <div className="card-cleared">
          <p className="card-cleared-verdict">
            <strong>Approved</strong>
            <span>{due.cardTitle}</span>
          </p>
          <p className="card-cleared-body">
            The Group approved your Consequence clip. It’s on the Wall so
            everyone can see you did it.
          </p>
          <button type="button" className="recap-done" onClick={close}>
            Nice
          </button>
        </div>
      )}
    </Sheet>
  );
}
