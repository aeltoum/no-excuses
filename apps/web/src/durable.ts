// Unsent workouts kept in IndexedDB so a reload, crash, or dead battery never loses one.
// Photos are stored as blobs; everything else is plain data. Every call fails soft: without
// IndexedDB the queue still works in memory for the session.
const name = "no-excuses";
const store = "outbox";

export type StoredWorkout = {
  id: string;
  key: string;
  membershipId: string;
  activityType: string;
  minutes: number;
  intensity: string;
  activity: { id: string; blob: Blob };
  presence: { id: string; blob: Blob };
  details: unknown;
  sessionId?: string;
  paths: { activity?: string; presence?: string };
};

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Operations run one at a time, in call order, so a later delete never lands before a save.
let queue: Promise<unknown> = Promise.resolve();
function run<T>(
  mode: IDBTransactionMode,
  work: (objects: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const next = queue.then(() => runNow(mode, work));
  queue = next.catch(() => undefined);
  return next;
}

async function runNow<T>(
  mode: IDBTransactionMode,
  work: (objects: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => {
        db.close();
        resolve(request?.result);
      };
      transaction.onerror = () => {
        db.close();
        resolve(undefined);
      };
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

export const saveWorkout = (workout: StoredWorkout) =>
  run("readwrite", (objects) => objects.put(workout));
export const forgetWorkout = (id: string) =>
  run("readwrite", (objects) => objects.delete(id));
export const clearWorkouts = () =>
  run("readwrite", (objects) => objects.clear());
export const loadWorkouts = async () =>
  ((await run<StoredWorkout[]>("readonly", (objects) => objects.getAll())) ??
    []) as StoredWorkout[];
