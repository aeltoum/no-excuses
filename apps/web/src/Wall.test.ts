import { afterEach, describe, expect, it, vi } from "vitest";
import { actOnProof, loadProofFeed, type ProofItem } from "./proof";
import { keepPhotoUrls } from "./Wall";

const signed = (path: string, exp: number, sig: string) => {
  const payload = btoa(JSON.stringify({ exp: Math.floor(exp / 1000) }));
  return `https://storage.test/object/sign/proof/${path}?token=h.${payload}.${sig}`;
};
const item = (
  activityPhotoUrl: string | null,
  presencePhotoUrl: string | null = null,
) =>
  ({
    workoutCheckinId: "checkin-1",
    activityPhotoUrl,
    presencePhotoUrl,
  }) as ProofItem;
const hour = 3_600_000;

describe("proof feed photo URLs", () => {
  it("keeps a still-valid URL for the same photo so the cached image is reused", () => {
    const old = signed("a.jpg", Date.now() + 10 * hour, "old");
    const fresh = signed("a.jpg", Date.now() + 24 * hour, "new");
    expect(keepPhotoUrls([item(old)], [item(fresh)])[0]?.activityPhotoUrl).toBe(
      old,
    );
  });

  it("takes the fresh URL when the old one is near expiry or the photo changed", () => {
    const expiring = signed("a.jpg", Date.now() + 60_000, "old");
    const other = signed("b.jpg", Date.now() + 10 * hour, "old");
    const fresh = signed("a.jpg", Date.now() + 24 * hour, "new");
    expect(
      keepPhotoUrls([item(expiring)], [item(fresh)])[0]?.activityPhotoUrl,
    ).toBe(fresh);
    expect(
      keepPhotoUrls([item(other)], [item(fresh)])[0]?.activityPhotoUrl,
    ).toBe(fresh);
  });

  it("drops a photo the server stopped returning, such as a reported one", () => {
    const old = signed("a.jpg", Date.now() + 10 * hour, "old");
    expect(
      keepPhotoUrls([item(old)], [item(null)])[0]?.activityPhotoUrl,
    ).toBeNull();
  });
});

describe("loadProofFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries once when the first read only wakes the API host", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadProofFeed("https://api.example.test", "t"),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry writes", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      actOnProof("https://api.example.test", "t", "id", "review", "verify"),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
