import { useEffect, useState } from "react";
import { Avatar } from "./avatars";
import { ClipPlayer } from "./ClipPlayer";
import { useFreshness } from "./freshness";
import { persistentMap } from "./persist";
import { call } from "./proof";
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
};

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
        {post.clipUrl ? (
          // The first frame stands in for a poster.
          <video
            className="day-tile-photo"
            src={`${post.clipUrl}#t=0.1`}
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <span className="day-tile-photo" />
        )}
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
}: {
  post: ConsequencePost;
  avatarUrl?: string;
  ago: (iso: string) => string;
}) {
  const who = post.mine ? "You" : post.authorName;
  return (
    <li className="proof-post consequence-post" data-post={clipPostId(post)}>
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
