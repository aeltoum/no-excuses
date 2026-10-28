// PROTOTYPE — throwaway. Empty and all-caught-up Home states for the C3b feed (map #266, ticket #274).
// Open /?proto=empty&variant=quiet|nudge&state=none|caught|clear|gap|solo in dev. Mock data only.
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import "./HomeFeed.prototype.css";
import "./EmptyStates.prototype.css";

type Act = "strength" | "cardio" | "class" | "sport";
type P = { id: string; member: string; act: Act; title: string; day: string; seen: boolean };
const hue: Record<Act, string> = { strength: "var(--activity-strength)", cardio: "var(--activity-cardio)", class: "var(--activity-class)", sport: "var(--activity-sport)" };
const CREW = ["Rae", "Lee", "Sam", "Jo"];
const FULL: P[] = [
  { id: "1", member: "Rae", act: "strength", title: "Squat day", day: "Today", seen: false },
  { id: "2", member: "Lee", act: "class", title: "Spin class", day: "Today", seen: false },
  { id: "3", member: "Jo", act: "sport", title: "5-a-side", day: "Wed", seen: true },
  { id: "4", member: "Lee", act: "strength", title: "Pull day", day: "Mon", seen: true },
];
const DAYS = ["Today", "Wed", "Tue", "Mon"];

type State = "none" | "caught" | "clear" | "gap" | "solo";
const SCENES: Record<State, { label: string; posts: P[]; crew: string[]; needs: boolean }> = {
  none: { label: "Nobody posted in 2 weeks", posts: [], crew: CREW, needs: false },
  caught: { label: "Everything seen", posts: FULL.map((p) => ({ ...p, seen: true })), crew: CREW, needs: false },
  clear: { label: "Needs you is empty", posts: FULL, crew: CREW, needs: false },
  gap: { label: "Days with no posts", posts: FULL, crew: CREW, needs: true },
  solo: { label: "You're the only member", posts: [], crew: [], needs: false },
};
type Dir = "quiet" | "nudge";

function Ring({ m, lit }: { m: string; lit: boolean }) {
  return (
    <button type="button" className={`hp-plate ${lit ? "is-new" : ""}`}>
      <span className="hp-plate-disc"><span className="hp-plate-hub">{m[0]}</span></span>
      <span className="hp-plate-name">{m}</span>
    </button>
  );
}
function Rings({ s, dir }: { s: (typeof SCENES)[State]; dir: Dir }) {
  const lit = (m: string) => s.posts.some((p) => p.member === m && !p.seen);
  const crew = [...s.crew].sort((a, b) => Number(lit(b)) - Number(lit(a)));
  return (
    <nav className="hp-rings" aria-label="Stories">
      {crew.map((m) => <Ring key={m} m={m} lit={lit(m)} />)}
      <Ring m="You" lit={false} />
      {s.crew.length === 0 && dir === "nudge" && (
        <button type="button" className="es-invite-ring" aria-label="Invite a friend">
          <span>+</span><span className="hp-plate-name">Invite</span>
        </button>
      )}
    </nav>
  );
}

const Ghosts = ({ n = 3 }: { n?: number }) => (
  <div className="hp-reel es-ghosts" aria-hidden>
    {Array.from({ length: n }, (_, i) => <span key={i} className="es-ghost" />)}
  </div>
);

function Tile({ p }: { p: P }) {
  return (
    <button type="button" className={`hp-reel-item ${p.seen ? "is-seen" : ""}`}>
      <div className="hp-photo" style={{ "--plate": hue[p.act] } as CSSProperties}><span className="hp-photo-inset" /></div>
      <span className="hp-reel-cap"><strong className="hp-who">{p.member}</strong><span>{p.title}</span></span>
      {!p.seen && <span className="hp-new-dot" />}
    </button>
  );
}

function NeedsYou({ show, dir }: { show: boolean; dir: Dir }) {
  if (!show) {
    if (dir === "quiet") return null;
    return <p className="es-needs-clear">Nothing needs you. No questioned posts, no cards to clear.</p>;
  }
  return (
    <section className="hp-needs open">
      <div className="hp-needs-head"><span>Needs you</span><span className="hp-needs-count">1</span></div>
      <div className="hp-needs-body">
        <article className="hp-conseq">
          <div><strong>Your Consequence card</strong><p className="hp-muted">30 wall-sit seconds, 3 rounds.</p></div>
          <button type="button" className="hp-good">Record</button>
        </article>
      </div>
    </section>
  );
}

function Feed({ s, dir, state }: { s: (typeof SCENES)[State]; dir: Dir; state: State }) {
  if (state === "solo")
    return (
      <section className="es-empty">
        <h2>Your crew's posts land here.</h2>
      </section>
    );
  if (s.posts.length === 0)
    return (
      <section className="es-empty">
        <Ghosts />
        <h2>No posts this week or last.</h2>
        <p className="hp-muted">Workouts your crew logs show up here, newest day first.</p>
        {dir === "nudge" && <button type="button" className="hp-good es-cta">Log a workout</button>}
      </section>
    );
  const allSeen = s.posts.every((p) => p.seen);
  const days = DAYS.map((d) => ({ d, posts: s.posts.filter((p) => p.day === d) }));
  const rows: ReactNode[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) rows.push(<li key={run.join()} className="es-gaprow"><span>{run.join(", ")}</span><span className="hp-muted">No posts</span></li>);
    run = [];
  };
  for (const { d, posts } of days) {
    if (posts.length === 0) {
      if (dir === "quiet") { run.push(d); continue; }
      rows.push(
        <li key={d}>
          <h2>{d}<span className="hp-muted">No posts</span></h2>
          <div className="hp-reel es-ghosts"><span className="es-ghost small" /><p className="hp-muted es-gaptext">Rest day for everyone.</p></div>
        </li>,
      );
      continue;
    }
    flush();
    rows.push(
      <li key={d} className={d === "Today" ? "today" : ""}>
        <h2>{d}<span className="hp-muted">{posts.length} post{posts.length > 1 ? "s" : ""}</span></h2>
        <div className="hp-reel">{posts.map((p) => <Tile key={p.id} p={p} />)}</div>
      </li>,
    );
  }
  flush();
  return (
    <>
      {allSeen && (dir === "quiet"
        ? <div className="hp-caught" role="status"><span>You're caught up</span></div>
        : <div className="es-caught" role="status"><strong>You've seen every post.</strong><button type="button" className="hp-good">Log yours</button></div>)}
      <ol className="hp-board">{rows}</ol>
    </>
  );
}

const STATES = Object.keys(SCENES) as State[];
export function EmptyStatesPrototype() {
  const q = new URLSearchParams(location.search);
  const [dir, setDir] = useState<Dir>(q.get("variant") === "nudge" ? "nudge" : "quiet");
  const [state, setState] = useState<State>((q.get("state") as State) in SCENES ? (q.get("state") as State) : "none");
  useEffect(() => {
    const u = new URL(location.href);
    u.searchParams.set("variant", dir);
    u.searchParams.set("state", state);
    history.replaceState(null, "", u);
  }, [dir, state]);
  const step = (d: number) => setState(STATES[(STATES.indexOf(state) + d + STATES.length) % STATES.length]!);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const s = SCENES[state];
  return (
    <main className="hp hp-c3 look-tall">
      <Rings s={s} dir={dir} />
      <NeedsYou show={s.needs} dir={dir} />
      <Feed s={s} dir={dir} state={state} />
      <div className="hp-switch es-switch">
        <button type="button" onClick={() => step(-1)} aria-label="Previous situation">‹</button>
        <span>{s.label}</span>
        <button type="button" onClick={() => step(1)} aria-label="Next situation">›</button>
        <button type="button" className="es-dir" onClick={() => setDir(dir === "quiet" ? "nudge" : "quiet")}>
          {dir === "quiet" ? "Quiet" : "Nudge"}
        </button>
      </div>
    </main>
  );
}
