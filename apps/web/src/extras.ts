import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api-client";
import { useFreshness } from "./freshness";
import { persistentMap } from "./persist";
import { call, writing } from "./proof";
import { rememberSafety } from "./Safety";

export type ExceptionCategory =
  | "health_safety"
  | "family_caregiving"
  | "schedule_disruption"
  | "travel_access"
  | "planned_recovery"
  | "private";
export type MyException = {
  id: string;
  week: "current" | "next";
  category: ExceptionCategory | null;
  note: string | null;
  status: "pending" | "approved" | "denied";
  closesAt: string;
};
export type ExceptionBallot = {
  id: string;
  name: string;
  week: "current" | "next";
  category: ExceptionCategory | null;
  note: string | null;
  closesAt: string;
  myResponse: "approve" | "deny" | "abstain" | null;
};
export type RecapWeek = {
  memberWeekId: string;
  membershipId: string;
  name: string;
  mine: boolean;
  met: boolean;
  completed: number;
  target: number;
  activityTypes: Array<"strength" | "cardio" | "class" | "sport" | "mixed">;
  endsAt: string;
  reactions: Array<{ emoji: string; count: number }>;
  myReaction: string | null;
};
export type CrownCategory = "load_progression" | "cardio_leap";
export type SeasonState = {
  season: number | null;
  week: number | null;
  standings: Array<{
    membershipId: string;
    name: string;
    crowns: number;
    mine: boolean;
    rank: number;
  }>;
  latest: {
    endsAt: string;
    results: Array<{
      category: CrownCategory;
      name: string;
      mine: boolean;
      score: number;
      winner: boolean;
    }>;
  } | null;
  champions: Array<{ season: number; names: string[]; crowns: number }>;
};
export type CardUnlock = {
  title: string;
  milestone: number;
  unlockedAt: string;
  recent: boolean;
};
// Home data from the newer slices, served by one request. Older cached copies may lack keys.
export type HomeExtras = {
  exceptions: {
    mine: MyException[];
    toDecide: ExceptionBallot[];
    excused: string[];
    pending: string[];
  };
  recap: RecapWeek[];
  season: SeasonState | null;
  unlocks: CardUnlock[];
  unreadNotifications: number;
  safety: { conductAccepted: boolean; blocked: string[]; operator?: boolean };
  session: { id: string; startedAt: string } | null;
};
export const emptyExtras: HomeExtras = {
  exceptions: { mine: [], toDecide: [], excused: [], pending: [] },
  recap: [],
  season: null,
  unlocks: [],
  unreadNotifications: 0,
  safety: { conductAccepted: false, blocked: [] },
  session: null,
};

const cache = persistentMap<HomeExtras>("extras");
const merge = (value: Partial<HomeExtras> | undefined): HomeExtras => ({
  ...emptyExtras,
  ...value,
  exceptions: { ...emptyExtras.exceptions, ...value?.exceptions },
});

export const extrasCommand = (
  baseUrl: string,
  token: string,
  path: string,
  body: unknown,
) =>
  call<HomeExtras>(baseUrl, token, path, { method: "POST", body }).then(merge);

// Loads Home extras with the saved copy shown at once; `apply` swaps in a command's result.
export function useHomeExtras(
  apiBaseUrl: string,
  token: string,
  cacheKey: string,
  active: boolean,
  onRevoked: () => void,
) {
  const [extras, setExtras] = useState<HomeExtras>(() =>
    merge(cache.get(cacheKey)),
  );
  const [revision, setRevision] = useState(0);
  const fresh = useFreshness();
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;
  useEffect(() => {
    void revision;
    void fresh;
    if (!active) return;
    let live = true;
    call<HomeExtras>(apiBaseUrl, token, "/v1/home/extras", { method: "GET" })
      .then((next) => {
        // A reload landing under an optimistic change waits for the next one.
        if (!live || (cache.has(cacheKey) && writing())) return;
        const merged = merge(next);
        rememberSafety(merged.safety);
        cache.set(cacheKey, merged);
        setExtras(merged);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.kind === "unauthorized")
          revoked.current();
      });
    return () => {
      live = false;
    };
  }, [apiBaseUrl, token, cacheKey, active, revision, fresh]);
  const apply = useCallback(
    (next: HomeExtras | ((current: HomeExtras) => HomeExtras)) =>
      setExtras((current) => {
        const value = typeof next === "function" ? next(current) : next;
        cache.set(cacheKey, value);
        return value;
      }),
    [cacheKey],
  );
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return [extras, apply, reload] as const;
}
