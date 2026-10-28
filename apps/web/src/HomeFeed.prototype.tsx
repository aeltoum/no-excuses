// PROTOTYPE — throwaway. Feed-first Home layout variants (map #266, ticket #270).
// Open /?proto=home&variant=a|b|c in dev. Mock data only, no mutations.
import { type CSSProperties, useEffect, useState } from "react";
import "./HomeFeed.prototype.css";

type Activity = "strength" | "cardio" | "class" | "sport";
type Post = {
  id: string;
  member: string;
  activity: Activity;
  title: string;
  detail: string;
  when: string;
  day: number; // 0 = Mon
  seen: boolean;
  question?: { by: string; reason: string; accept: number; reject: number; voters: number };
};

const plate: Record<Activity, string> = {
  strength: "var(--activity-strength)",
  cardio: "var(--activity-cardio)",
  class: "var(--activity-class)",
  sport: "var(--activity-sport)",
};

const POSTS: Post[] = [
  { id: "q", member: "Sam", activity: "cardio", title: "5K run", detail: "28:10, felt like a 7", when: "Tuesday", day: 1, seen: false, question: { by: "Lee", reason: "The presence photo doesn't show Sam", accept: 1, reject: 1, voters: 4 } },
  { id: "1", member: "Rae", activity: "strength", title: "Squat day", detail: "Back squat 5 × 5 at 100 kg", when: "2 h ago", day: 3, seen: false },
  { id: "2", member: "Lee", activity: "class", title: "Spin class", detail: "45 min, felt like an 8", when: "5 h ago", day: 3, seen: false },
  { id: "5", member: "Rae", activity: "cardio", title: "Easy row", detail: "2,000 m in 7:58", when: "This morning", day: 3, seen: false },
  { id: "3", member: "Jo", activity: "sport", title: "5-a-side", detail: "60 min, felt like a 6", when: "Yesterday", day: 2, seen: true },
  { id: "4", member: "Lee", activity: "strength", title: "Pull day", detail: "Weighted pull-up 4 × 6 at +10 kg", when: "Monday", day: 0, seen: true },
];
const MEMBERS = ["Rae", "Lee", "Sam", "Jo", "You"];
const latestUnseen = (m: string) => POSTS.find((p) => p.member === m && !p.seen);
const ringOrder = [...MEMBERS].sort((a, b) => Number(!!latestUnseen(b)) - Number(!!latestUnseen(a)));
const pinned = POSTS.filter((p) => p.question);
const unseen = POSTS.filter((p) => !p.question && !p.seen);
const seen = POSTS.filter((p) => !p.question && p.seen);
const WEEK = { done: 2, target: 4, left: "3 days left" };

function Photo({ p, className = "" }: { p: Post; className?: string }) {
  return (
    <div className={`hp-photo ${className}`} style={{ "--plate": plate[p.activity] } as CSSProperties}>
      <span className="hp-photo-inset" aria-hidden />
    </div>
  );
}

function PlateRing({ m, onOpen }: { m: string; onOpen: () => void }) {
  const p = latestUnseen(m);
  return (
    <button type="button" className={`hp-plate ${p ? "is-new" : ""}`} onClick={onOpen}
      style={{ "--plate": p ? "var(--chalk)" : "var(--bar)" } as CSSProperties}
      aria-label={p ? `${m}, new post` : `${m}, all seen`}>
      <span className="hp-plate-disc"><span className="hp-plate-hub">{m[0]}</span></span>
      <span className="hp-plate-name">{m}</span>
    </button>
  );
}
const Rings = ({ open }: { open: (m: string) => void }) => (
  <nav className="hp-rings" aria-label="Stories">
    {ringOrder.map((m) => <PlateRing key={m} m={m} onOpen={() => open(m)} />)}
  </nav>
);

// Week status as a loaded bar: one plate per verified workout, empty sleeve slots for the rest.
function BarChip() {
  return (
    <div className="hp-bar" role="status" aria-label={`${WEEK.done} of ${WEEK.target} workouts this week`}>
      <span className="hp-bar-sleeve">
        {Array.from({ length: WEEK.target }, (_, i) => <span key={i} className={i < WEEK.done ? "on" : ""} />)}
      </span>
      <span className="hp-bar-text"><b>{WEEK.done} of {WEEK.target}</b> this week</span>
      <span className="hp-bar-left">{WEEK.left}</span>
    </div>
  );
}

// Referee lights: white = accept, red = reject, dark = not yet voted.
function Lights({ q }: { q: NonNullable<Post["question"]> }) {
  return (
    <span className="hp-lights" aria-label={`${q.accept} accept, ${q.reject} reject, ${q.voters - q.accept - q.reject} still to vote`}>
      {Array.from({ length: q.voters }, (_, i) => (
        <span key={i} className={i < q.accept ? "white" : i < q.accept + q.reject ? "red" : ""} />
      ))}
    </span>
  );
}
function QuestionedCard({ p, compact }: { p: Post; compact?: boolean }) {
  const q = p.question!;
  return (
    <article className={`hp-q ${compact ? "compact" : ""}`}>
      <header>
        <strong>{q.by} questioned {p.member}'s {p.title}</strong>
        <Lights q={q} />
      </header>
      <div className="hp-q-body">
        <Photo p={p} className="hp-q-photo" />
        <div>
          <p className="hp-q-reason">“{q.reason}”</p>
          <p className="hp-muted">{p.detail}. It still counts unless most of the group rejects it.</p>
        </div>
      </div>
      <div className="hp-q-actions">
        <button type="button" className="hp-good">Accept</button>
        <button type="button" className="hp-nolift">Reject</button>
        <button type="button" className="hp-quiet">Can't tell</button>
      </div>
    </article>
  );
}

const CaughtUp = () => (
  <div className="hp-caught" role="separator">
    <span>You're caught up. Older posts below.</span>
  </div>
);

// A — photo cards in the app's current Wall style.
function Card({ p }: { p: Post }) {
  return (
    <article className={`hp-card ${p.seen ? "is-seen" : ""}`}>
      <header>
        <span className="hp-swatch" style={{ background: plate[p.activity] }} />
        <strong className="hp-who">{p.member}</strong>
        <span className="hp-muted">{p.when}</span>
        <button type="button" className="hp-ask">Question</button>
      </header>
      <Photo p={p} />
      <p><b>{p.title}</b> <span className="hp-muted">{p.detail}</span></p>
    </article>
  );
}
function VariantA({ open }: { open: (m: string) => void }) {
  return (
    <div className="hp-a">
      <Rings open={open} />
      <BarChip />
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} />)}
      {unseen.map((p) => <Card key={p.id} p={p} />)}
      <CaughtUp />
      {seen.map((p) => <Card key={p.id} p={p} />)}
    </div>
  );
}

// B — dense two-up grid, photo-first; tap a tile to read it.
function Tile({ p }: { p: Post }) {
  return (
    <button type="button" className={`hp-tile ${p.seen ? "is-seen" : ""}`}>
      <Photo p={p} />
      <span className="hp-tile-cap">
        <strong className="hp-who">{p.member}</strong>
        <span>{p.title}</span>
      </span>
      {!p.seen && <span className="hp-new-dot" aria-label="New" />}
    </button>
  );
}
function VariantB({ open }: { open: (m: string) => void }) {
  return (
    <div className="hp-b">
      <header className="hp-b-head">
        <h1>{WEEK.done}<span>/{WEEK.target}</span></h1>
        <p>workouts this week<br /><span className="hp-muted">{WEEK.left}</span></p>
      </header>
      <Rings open={open} />
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
      <div className="hp-grid">{unseen.map((p) => <Tile key={p.id} p={p} />)}</div>
      <CaughtUp />
      <div className="hp-grid">{seen.map((p) => <Tile key={p.id} p={p} />)}</div>
    </div>
  );
}

// C — the week as a timeline. Days are a real sequence, so the spine is Mon→Sun, newest day on top.
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY = 3;
function VariantC({ open }: { open: (m: string) => void }) {
  const days = DAYS.map((d, i) => ({ d, i, posts: POSTS.filter((p) => p.day === i && !p.question) })).filter((x) => x.i <= TODAY).reverse();
  return (
    <div className="hp-c">
      <Rings open={open} />
      <ol className="hp-week" aria-label="Your week">
        {DAYS.map((d, i) => (
          <li key={d} className={`${[0, 2].includes(i) ? "done" : ""} ${i === TODAY ? "today" : ""}`}>{d[0]}</li>
        ))}
        <li className="hp-week-text"><b>{WEEK.done} of {WEEK.target}</b> {WEEK.left}</li>
      </ol>
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
      <ol className="hp-spine">
        {days.map(({ d, i, posts }) => (
          <li key={d} className={i === TODAY ? "today" : ""}>
            <h2>{i === TODAY ? "Today" : d}</h2>
            {posts.length === 0 && <p className="hp-muted">No posts</p>}
            {posts.map((p) => (
              <article key={p.id} className={`hp-entry ${p.seen ? "is-seen" : ""}`}>
                <Photo p={p} />
                <div>
                  <strong className="hp-who">{p.member}</strong>
                  <p><b>{p.title}</b><br /><span className="hp-muted">{p.detail}</span></p>
                  <button type="button" className="hp-ask">Question</button>
                </div>
              </article>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

const MINE = [0, 2]; // days the viewer worked out
const pastDays = DAYS.map((d, i) => ({ d, i, posts: POSTS.filter((p) => p.day === i && !p.question) })).filter((x) => x.i <= TODAY);

function WeekStrip({ pick, active }: { pick?: (i: number) => void; active?: number }) {
  return (
    <ol className="hp-week" aria-label="Your week">
      {DAYS.map((d, i) => (
        <li key={d} className={`${MINE.includes(i) ? "done" : ""} ${i === TODAY ? "today" : ""} ${active === i ? "active" : ""}`}>
          {pick && i <= TODAY ? <button type="button" onClick={() => pick(i)} aria-pressed={active === i}>{d[0]}</button> : d[0]}
          {POSTS.some((p) => p.day === i && !p.seen) && <span className="hp-week-dot" />}
        </li>
      ))}
      <li className="hp-week-text"><b>{WEEK.done} of {WEEK.target}</b> {WEEK.left}</li>
    </ol>
  );
}

// C2 — day pager: the week strip is the navigation; swipe sideways between days.
function VariantC2({ open }: { open: (m: string) => void }) {
  const [day, setDay] = useState(TODAY);
  const [pager, setPager] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (pager) pager.scrollLeft = TODAY * pager.clientWidth; }, [pager]);
  const ref = setPager;
  const pick = (i: number) => { setDay(i); pager?.scrollTo({ left: i * pager.clientWidth, behavior: "smooth" }); };
  return (
    <div className="hp-c2">
      <Rings open={open} />
      <WeekStrip pick={pick} active={day} />
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
      <div className="hp-pager" ref={ref}
        onScroll={(e) => { const el = e.currentTarget; setDay(Math.round(el.scrollLeft / el.clientWidth)); }}>
        {pastDays.map(({ d, i, posts }) => (
          <section key={d} id={`hp-day-${i}`} className="hp-page">
            <h2>{i === TODAY ? "Today" : d} <span className="hp-muted">{posts.length || "No"} post{posts.length === 1 ? "" : "s"}</span></h2>
            {posts.map((p) => <Card key={p.id} p={p} />)}
            {posts.length === 0 && <p className="hp-muted">Nobody posted. Swipe for another day.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

// C3 — week board: one row per day, posts as a sideways reel of thumbnails. Whole week at a glance.
function VariantC3({ open }: { open: (m: string) => void }) {
  return (
    <div className="hp-c3">
      <Rings open={open} />
      <WeekStrip />
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
      <ol className="hp-board">
        {[...pastDays].reverse().map(({ d, i, posts }) => (
          <li key={d} className={i === TODAY ? "today" : ""}>
            <h2>{i === TODAY ? "Today" : d}{MINE.includes(i) && <span className="hp-mine">You trained</span>}</h2>
            <div className="hp-reel">
              {posts.length === 0 && <p className="hp-muted">No posts</p>}
              {posts.map((p) => (
                <button key={p.id} type="button" className={`hp-reel-item ${p.seen ? "is-seen" : ""}`} onClick={() => open(p.member)}>
                  <Photo p={p} />
                  <strong className="hp-who">{p.member}</strong>
                  <span>{p.title}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Pinned items that need the viewer: questioned posts and their own Consequence card. Collapsible.
function NeedsYou() {
  const [open, setOpen] = useState(true);
  return (
    <section className={`hp-needs ${open ? "open" : ""}`}>
      <button type="button" className="hp-needs-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Needs you</span>
        <span className="hp-needs-count">{pinned.length + 1}</span>
        <span className="hp-needs-chev" aria-hidden>⌄</span>
      </button>
      {open && (
        <div className="hp-needs-body">
          {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
          <article className="hp-conseq">
            <div>
              <strong>Your Consequence card</strong>
              <p className="hp-muted">30 wall-sit seconds, 3 rounds. Record a proof clip to clear it.</p>
            </div>
            <button type="button" className="hp-good">Record</button>
          </article>
        </div>
      )}
    </section>
  );
}

type BoardStyle = "reel" | "tall" | "lead";
function Board({ open, look }: { open: (m: string) => void; look: BoardStyle }) {
  return (
    <div className={`hp-c3 look-${look}`}>
      <Rings open={open} />
      <NeedsYou />
      <ol className="hp-board">
        {[...pastDays].reverse().map(({ d, i, posts }) => (
          <li key={d} className={i === TODAY ? "today" : ""}>
            <h2>
              {i === TODAY ? "Today" : d}
              <span className="hp-muted">{posts.length ? `${posts.length} post${posts.length > 1 ? "s" : ""}` : "No posts"}</span>
            </h2>
            {posts.length > 0 && (
              <div className="hp-reel">
                {posts.map((p, k) => (
                  <button key={p.id} type="button" className={`hp-reel-item ${p.seen ? "is-seen" : ""} ${look === "lead" && k === 0 ? "lead" : ""}`} onClick={() => open(p.member)}>
                    <Photo p={p} />
                    <span className="hp-reel-cap">
                      <strong className="hp-who">{p.member}</strong>
                      <span>{p.title}</span>
                      {look !== "reel" && <span className="hp-muted">{p.detail}</span>}
                    </span>
                    {!p.seen && <span className="hp-new-dot" aria-label="New" />}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
const VariantC3a = ({ open }: { open: (m: string) => void }) => <Board open={open} look="reel" />;
const VariantC3b = ({ open }: { open: (m: string) => void }) => <Board open={open} look="tall" />;
const VariantC3c = ({ open }: { open: (m: string) => void }) => <Board open={open} look="lead" />;

// C4 — split spine: your workouts on the left of the line, the group's on the right.
function VariantC4({ open }: { open: (m: string) => void }) {
  return (
    <div className="hp-c4">
      <Rings open={open} />
      <div className="hp-split-head"><span>You</span><b>{WEEK.done} of {WEEK.target}, {WEEK.left}</b><span>Group</span></div>
      {pinned.map((p) => <QuestionedCard key={p.id} p={p} compact />)}
      <ol className="hp-split">
        {[...pastDays].reverse().map(({ d, i, posts }) => (
          <li key={d} className={i === TODAY ? "today" : ""}>
            <div className="hp-split-me">
              {MINE.includes(i) ? <span className="hp-me-plate">Done</span> : i === TODAY ? <button type="button" className="hp-log">Log</button> : <span className="hp-muted">Rest</span>}
            </div>
            <h2>{i === TODAY ? "Today" : d}</h2>
            <div className="hp-split-group">
              {posts.length === 0 && <span className="hp-muted">No posts</span>}
              {posts.map((p) => (
                <button key={p.id} type="button" className={`hp-chiprow ${p.seen ? "is-seen" : ""}`} onClick={() => open(p.member)}>
                  <Photo p={p} />
                  <span><strong className="hp-who">{p.member}</strong><br />{p.title}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StoryViewer({ member, close }: { member: string; close: () => void }) {
  const posts = POSTS.filter((p) => p.member === member);
  const [i, setI] = useState(0);
  const p = posts[i];
  if (!p)
    return (
      <div className="hp-story hp-story-empty" onClick={close}>
        <p>{member} hasn't posted this week.</p>
      </div>
    );
  return (
    <div className="hp-story" style={{ "--plate": plate[p.activity] } as CSSProperties}
      onClick={(e) => (e.clientX > innerWidth / 2 ? (i + 1 < posts.length ? setI(i + 1) : close()) : setI(Math.max(0, i - 1)))}>
      <div className="hp-story-ticks">{posts.map((_, k) => <span key={k} className={k <= i ? "on" : ""} />)}</div>
      <header><strong className="hp-who">{member}</strong> <span>{p.when}</span></header>
      <footer><b>{p.title}</b><br />{p.detail}</footer>
    </div>
  );
}

const VARIANTS = {
  c3a: ["C3a Board, small reel", VariantC3a],
  c3b: ["C3b Board, tall reel", VariantC3b],
  c3c: ["C3c Board, lead post", VariantC3c],
  c: ["C1 Timeline", VariantC],
  c2: ["C2 Day pager", VariantC2],
  c3: ["C3 Week board", VariantC3],
  c4: ["C4 You vs group", VariantC4],
  a: ["A Cards", VariantA],
  b: ["B Grid", VariantB],
} as const;
type Key = keyof typeof VARIANTS;
const keys = Object.keys(VARIANTS) as Key[];

export function HomeFeedPrototype() {
  const read = () => (new URLSearchParams(location.search).get("variant") as Key) || "c3a";
  const [v, setV] = useState<Key>(read);
  const [story, setStory] = useState<string | null>(null);
  const go = (d: number) => {
    const next = keys[(keys.indexOf(v) + d + keys.length) % keys.length]!;
    const u = new URL(location.href);
    u.searchParams.set("variant", next);
    history.replaceState(null, "", u);
    setV(next);
    scrollTo(0, 0);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const [label, View] = VARIANTS[v] ?? VARIANTS.a;
  return (
    <main className="hp">
      <View open={setStory} />
      {story && <StoryViewer member={story} close={() => setStory(null)} />}
      <div className="hp-switch" hidden={!!story}>
        <button type="button" onClick={() => go(-1)} aria-label="Previous variant">‹</button>
        <span>{label}</span>
        <button type="button" onClick={() => go(1)} aria-label="Next variant">›</button>
      </div>
    </main>
  );
}
