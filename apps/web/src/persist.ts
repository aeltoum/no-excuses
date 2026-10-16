// Tab data kept in localStorage so a reopened app shows the last known screen
// at once and refreshes in the background. Keys are scoped by user and group.
const prefix = "no-excuses:cache:";
const maps = new Set<Map<string, unknown>>();

export function persistentMap<T>(name: string): Map<string, T> {
  const key = prefix + name;
  let entries: Array<[string, T]> = [];
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(value)) entries = value;
  } catch {
    // Unreadable cache: start empty and load from the network.
  }
  const map = new Map<string, T>(entries);
  const save = () => {
    try {
      if (map.size > 0) localStorage.setItem(key, JSON.stringify([...map]));
      else localStorage.removeItem(key);
    } catch {
      // Storage full or unavailable: the in-memory copy still works.
    }
  };
  const set = map.set.bind(map);
  const remove = map.delete.bind(map);
  const clear = map.clear.bind(map);
  map.set = (entry, value) => {
    set(entry, value);
    save();
    return map;
  };
  map.delete = (entry) => {
    const removed = remove(entry);
    save();
    return removed;
  };
  map.clear = () => {
    clear();
    save();
  };
  maps.add(map as Map<string, unknown>);
  return map;
}

const clearers = new Set<() => void>();

// In-memory caches register here so sign-out drops them too.
export const onClearPersisted = (clear: () => void) => clearers.add(clear);

// Sign-out and revoked access drop every member's cached data.
export function clearPersisted() {
  for (const map of maps) map.clear();
  for (const clear of clearers) clear();
}
