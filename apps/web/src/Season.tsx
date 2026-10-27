import type { CardUnlock, CrownCategory, SeasonState } from "./extras";

// Crowns and Season standings are paused until the feature is revised.
export const crownsEnabled = false;

const categoryName: Record<CrownCategory, string> = {
  load_progression: "Load Progression",
  cardio_leap: "Cardio Leap",
};

// Home: one line with the Season, your Crowns, and the leader; opens History.
export function SeasonChip({
  season,
  onOpen,
}: {
  season: SeasonState | null;
  onOpen: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (!crownsEnabled || !season?.season) return null;
  const me = season.standings.find((row) => row.mine);
  const top = season.standings[0];
  const leaders = season.standings.filter(
    (row) => row.rank === 1 && row.crowns > 0,
  );
  return (
    <a className="season-chip" href="/history" onClick={onOpen}>
      <span>
        Season {season.season} · Week {season.week ?? 4}/4
      </span>
      <span>
        {me ? `You ${me.crowns} 👑` : ""}
        {top && leaders.length === 1 && !leaders[0]?.mine
          ? ` · ${leaders[0]?.name} leads`
          : leaders.length > 1
            ? " · tied at the top"
            : ""}
      </span>
    </a>
  );
}

// History: standings, last week's Crowns, and past champions.
export function SeasonCard({ season }: { season: SeasonState | null }) {
  if (!crownsEnabled || !season?.season) return null;
  const categories: CrownCategory[] = ["load_progression", "cardio_leap"];
  return (
    <section className="season-card" aria-labelledby="season-heading">
      <h2 id="season-heading">
        Season {season.season}
        <small> · Week {season.week ?? 4} of 4</small>
      </h2>
      <ol className="season-standings" aria-label="Season standings">
        {season.standings.map((row) => (
          <li key={row.membershipId} className={row.mine ? "mine" : undefined}>
            <span className="season-rank">{row.rank}</span>
            <span>{row.mine ? "You" : row.name}</span>
            <strong>
              {row.crowns} <span aria-hidden="true">👑</span>
              <span className="visually-hidden">
                {row.crowns === 1 ? "Crown" : "Crowns"}
              </span>
            </strong>
          </li>
        ))}
      </ol>
      {season.latest ? (
        <div className="season-latest">
          <h3>Last week’s Crowns</h3>
          {categories.map((category) => {
            const rows = season.latest?.results.filter(
              (row) => row.category === category,
            );
            const winners = rows?.filter((row) => row.winner) ?? [];
            return (
              <p key={category}>
                <strong>{categoryName[category]}:</strong>{" "}
                {winners.length
                  ? `${winners.map((row) => (row.mine ? "You" : row.name)).join(" & ")} (+${winners[0]?.score}%)`
                  : rows?.length
                    ? "No Crown — needs two members beating their own best."
                    : "No comparable results."}
              </p>
            );
          })}
        </div>
      ) : (
        <p className="hint">
          Crowns land when a week closes. Add details to your posts — weights
          for lifts, distance and time for cardio — and beat your own best.
        </p>
      )}
      {season.champions.length > 0 && (
        <div className="season-champions">
          <h3>Champions</h3>
          <ul>
            {season.champions.map((row) => (
              <li key={row.season}>
                Season {row.season}: {row.names.join(" & ")} · {row.crowns} 👑
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// The newest unlock, for a week after it lands.
export function UnlockNote({ unlocks }: { unlocks: CardUnlock[] }) {
  const latest = unlocks.find((unlock) => unlock.recent);
  if (!latest) return null;
  return (
    <p className="unlock-note">
      <span aria-hidden="true">🃏</span> {latest.milestone}-week streak: you
      added “{latest.title}” to your Group’s card deck.
    </p>
  );
}

export function UnlockList({ unlocks }: { unlocks: CardUnlock[] }) {
  if (unlocks.length === 0) return null;
  return (
    <section className="unlock-list" aria-labelledby="unlock-heading">
      <h3 id="unlock-heading">Cards you added to the deck</h3>
      <ul>
        {unlocks.map((unlock) => (
          <li key={unlock.unlockedAt}>
            {unlock.title}
            <small> · {unlock.milestone}-week streak</small>
          </li>
        ))}
      </ul>
      <p className="hint">Friends may draw these when they owe a card.</p>
    </section>
  );
}
