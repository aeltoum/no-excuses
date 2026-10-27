import { useState } from "react";

export type Lift = {
  exercise: string;
  equipment: string;
  sets: number;
  reps: number;
  weightKg?: number;
};
export type CardioDetail = {
  activity: string;
  distanceKm?: number;
  timeSeconds?: number;
};
export type WorkoutDetails = { lifts?: Lift[]; cardio?: CardioDetail };

export const exercises: Array<[string, string]> = [
  ["back_squat", "Back squat"],
  ["front_squat", "Front squat"],
  ["goblet_squat", "Goblet squat"],
  ["deadlift", "Deadlift"],
  ["romanian_deadlift", "Romanian deadlift"],
  ["bench_press", "Bench press"],
  ["incline_bench_press", "Incline bench press"],
  ["overhead_press", "Overhead press"],
  ["barbell_row", "Barbell row"],
  ["dumbbell_row", "Dumbbell row"],
  ["pull_up", "Pull-up"],
  ["chin_up", "Chin-up"],
  ["dip", "Dip"],
  ["push_up", "Push-up"],
  ["lunge", "Lunge"],
  ["hip_thrust", "Hip thrust"],
  ["leg_press", "Leg press"],
  ["lat_pulldown", "Lat pulldown"],
  ["cable_row", "Cable row"],
  ["bicep_curl", "Bicep curl"],
  ["tricep_extension", "Tricep extension"],
  ["kettlebell_swing", "Kettlebell swing"],
];
export const equipment: Array<[string, string]> = [
  ["barbell", "Barbell"],
  ["dumbbell", "Dumbbell"],
  ["kettlebell", "Kettlebell"],
  ["machine", "Machine"],
  ["cable", "Cable"],
  ["bodyweight", "Bodyweight"],
  ["band", "Band"],
];
export const cardioActivities: Array<[string, string]> = [
  ["run", "Run"],
  ["walk", "Walk"],
  ["cycle", "Cycle"],
  ["row", "Row"],
  ["swim", "Swim"],
  ["elliptical", "Elliptical"],
  ["stairs", "Stairs"],
  ["hike", "Hike"],
];
const name = (list: Array<[string, string]>, key: string) =>
  list.find(([value]) => value === key)?.[1] ?? key;

type Units = "metric" | "imperial";
const unitsKey = "no-excuses:units";
const readUnits = (): Units => {
  try {
    return localStorage.getItem(unitsKey) === "imperial"
      ? "imperial"
      : "metric";
  } catch {
    return "metric";
  }
};
const lbPerKg = 2.20462;
const miPerKm = 0.621371;
const round = (value: number, places = 1) =>
  Math.round(value * 10 ** places) / 10 ** places;

export const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

// One line for a post, in the viewer's units: "Back squat 3×5 @ 100 kg · Run 5 km in 25:00".
export function detailLine(details: WorkoutDetails | null | undefined) {
  if (!details) return "";
  const units = readUnits();
  const parts = (details.lifts ?? []).map((lift) => {
    const weight =
      lift.weightKg === undefined
        ? ""
        : units === "imperial"
          ? ` @ ${round(lift.weightKg * lbPerKg, 0)} lb`
          : ` @ ${round(lift.weightKg)} kg`;
    return `${name(exercises, lift.exercise)} ${lift.sets}×${lift.reps}${weight}`;
  });
  const cardio = details.cardio;
  if (cardio) {
    const distance =
      cardio.distanceKm === undefined
        ? ""
        : units === "imperial"
          ? ` ${round(cardio.distanceKm * miPerKm, 2)} mi`
          : ` ${round(cardio.distanceKm, 2)} km`;
    const time =
      cardio.timeSeconds === undefined
        ? ""
        : `${distance ? " in" : ""} ${clock(cardio.timeSeconds)}`;
    parts.push(`${name(cardioActivities, cardio.activity)}${distance}${time}`);
  }
  return parts.join(" · ");
}

// Parses "25", "25:30" or "1:05:00" into seconds; null when unreadable.
const parseClock = (value: string) => {
  if (!value.trim()) return undefined;
  const pieces = value.trim().split(":").map(Number);
  if (pieces.some((piece) => !Number.isFinite(piece) || piece < 0)) return null;
  const [a = 0, b = 0, c = 0] = pieces;
  const seconds =
    pieces.length === 3
      ? a * 3600 + b * 60 + c
      : pieces.length === 2
        ? a * 60 + b
        : a * 60;
  return Math.round(seconds);
};

type LiftDraft = {
  key: string;
  exercise: string;
  equipment: string;
  sets: string;
  reps: string;
  weight: string;
};
export type DetailsDraft = {
  lifts: LiftDraft[];
  cardioActivity: string;
  distance: string;
  time: string;
};
export const emptyDraft = (): DetailsDraft => ({
  lifts: [],
  cardioActivity: "",
  distance: "",
  time: "",
});

// The draft as details the server accepts, or null when nothing (valid) was entered.
export function draftDetails(
  draft: DetailsDraft,
  activity: string | null,
): WorkoutDetails | null {
  const units = readUnits();
  const details: WorkoutDetails = {};
  if (activity === "strength" || activity === "mixed") {
    const lifts = draft.lifts
      .map((row): Lift | null => {
        const sets = Number(row.sets);
        const reps = Number(row.reps);
        const weight = Number(row.weight);
        if (
          !row.exercise ||
          !Number.isInteger(sets) ||
          sets < 1 ||
          sets > 20 ||
          !Number.isInteger(reps) ||
          reps < 1 ||
          reps > 100
        )
          return null;
        const lift: Lift = {
          exercise: row.exercise,
          equipment: row.equipment || "barbell",
          sets,
          reps,
        };
        if (row.weight.trim() && weight > 0) {
          const kg = units === "imperial" ? weight / lbPerKg : weight;
          if (kg >= 0.5 && kg <= 500) lift.weightKg = round(kg, 2);
        }
        return lift;
      })
      .filter((lift): lift is Lift => lift !== null);
    if (lifts.length) details.lifts = lifts.slice(0, 12);
  }
  if ((activity === "cardio" || activity === "mixed") && draft.cardioActivity) {
    const distance = Number(draft.distance);
    const time = parseClock(draft.time);
    const cardio: CardioDetail = { activity: draft.cardioActivity };
    if (draft.distance.trim() && distance > 0) {
      const km = units === "imperial" ? distance / miPerKm : distance;
      if (km >= 0.05 && km <= 500) cardio.distanceKm = round(km, 3);
    }
    if (time && time >= 30 && time <= 86400) cardio.timeSeconds = time;
    if (cardio.distanceKm !== undefined || cardio.timeSeconds !== undefined)
      details.cardio = cardio;
  }
  return details.lifts || details.cardio ? details : null;
}

// Optional details in the log sheet: lifts for strength, distance and time for cardio.
export function DetailsFields({
  activity,
  draft,
  onChange,
}: {
  activity: string | null;
  draft: DetailsDraft;
  onChange: (draft: DetailsDraft) => void;
}) {
  const [units, setUnits] = useState<Units>(readUnits);
  const strength = activity === "strength" || activity === "mixed";
  const cardio = activity === "cardio" || activity === "mixed";
  if (!strength && !cardio) return null;
  const toggleUnits = (next: Units) => {
    setUnits(next);
    try {
      localStorage.setItem(unitsKey, next);
    } catch {
      // Units stay for this session only.
    }
  };
  const patchLift = (key: string, patch: Partial<LiftDraft>) =>
    onChange({
      ...draft,
      lifts: draft.lifts.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    });
  return (
    <details className="details-fields">
      <summary>Add workout details</summary>
      <fieldset className="choice-chips details-units" aria-label="Units">
        <button
          type="button"
          aria-pressed={units === "metric"}
          onClick={() => toggleUnits("metric")}
        >
          kg · km
        </button>
        <button
          type="button"
          aria-pressed={units === "imperial"}
          onClick={() => toggleUnits("imperial")}
        >
          lb · mi
        </button>
      </fieldset>
      {strength && (
        <div className="details-lifts">
          {draft.lifts.map((row, index) => (
            <fieldset className="details-lift" key={row.key}>
              <legend>Lift {index + 1}</legend>
              <label>
                Exercise
                <select
                  value={row.exercise}
                  onChange={(event) =>
                    patchLift(row.key, { exercise: event.target.value })
                  }
                >
                  <option value="">Choose…</option>
                  {exercises.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Equipment
                <select
                  value={row.equipment}
                  onChange={(event) =>
                    patchLift(row.key, { equipment: event.target.value })
                  }
                >
                  {equipment.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="details-numbers">
                <label>
                  Sets
                  <input
                    inputMode="numeric"
                    value={row.sets}
                    onChange={(event) =>
                      patchLift(row.key, { sets: event.target.value })
                    }
                  />
                </label>
                <label>
                  Reps
                  <input
                    inputMode="numeric"
                    value={row.reps}
                    onChange={(event) =>
                      patchLift(row.key, { reps: event.target.value })
                    }
                  />
                </label>
                <label>
                  Weight ({units === "imperial" ? "lb" : "kg"})
                  <input
                    inputMode="decimal"
                    value={row.weight}
                    onChange={(event) =>
                      patchLift(row.key, { weight: event.target.value })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  onChange({
                    ...draft,
                    lifts: draft.lifts.filter((item) => item.key !== row.key),
                  })
                }
              >
                Remove lift
              </button>
            </fieldset>
          ))}
          {draft.lifts.length < 12 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                onChange({
                  ...draft,
                  lifts: [
                    ...draft.lifts,
                    {
                      key: crypto.randomUUID(),
                      exercise: "",
                      equipment: "barbell",
                      sets: "3",
                      reps: "5",
                      weight: "",
                    },
                  ],
                })
              }
            >
              Add a lift
            </button>
          )}
        </div>
      )}
      {cardio && (
        <fieldset className="details-cardio">
          <label>
            Cardio type
            <select
              value={draft.cardioActivity}
              onChange={(event) =>
                onChange({ ...draft, cardioActivity: event.target.value })
              }
            >
              <option value="">Choose…</option>
              {cardioActivities.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="details-numbers">
            <label>
              Distance ({units === "imperial" ? "mi" : "km"})
              <input
                inputMode="decimal"
                value={draft.distance}
                onChange={(event) =>
                  onChange({ ...draft, distance: event.target.value })
                }
              />
            </label>
            <label>
              Time (mm:ss)
              <input
                inputMode="numeric"
                placeholder="25:00"
                value={draft.time}
                onChange={(event) =>
                  onChange({ ...draft, time: event.target.value })
                }
              />
            </label>
          </div>
        </fieldset>
      )}
    </details>
  );
}
