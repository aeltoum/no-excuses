import { expect, test } from "@playwright/test";

// A 12 MP camera-like frame (gradients, shapes and sensor noise) through the real encoder.
test("proof photos upload at most 1280 px and within the byte budget", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { compressPhoto, photoByteBudget } = await import("/src/proof.ts");
    const camera = document.createElement("canvas");
    camera.width = 4032;
    camera.height = 3024;
    const g = camera.getContext("2d") as CanvasRenderingContext2D;
    const sky = g.createLinearGradient(0, 0, 0, camera.height);
    sky.addColorStop(0, "#6fa8dc");
    sky.addColorStop(1, "#38761d");
    g.fillStyle = sky;
    g.fillRect(0, 0, camera.width, camera.height);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsl(${(i * 47) % 360} 60% ${30 + (i % 40)}%)`;
      g.beginPath();
      g.arc((i * 997) % 4032, (i * 613) % 3024, 20 + (i % 90), 0, 7);
      g.fill();
    }
    const noise = g.getImageData(0, 0, camera.width, camera.height);
    let seed = 7;
    for (let i = 0; i < noise.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed % 25) - 12;
      noise.data[i] += n;
      noise.data[i + 1] += n;
      noise.data[i + 2] += n;
    }
    g.putImageData(noise, 0, 0);
    const original = (await new Promise<Blob | null>((r) =>
      camera.toBlob(r, "image/jpeg", 0.92),
    )) as Blob;
    const before = await compressPhoto(
      original,
      1600,
      Number.POSITIVE_INFINITY,
    );
    const after = await compressPhoto(original);
    const size = await createImageBitmap(after);
    return {
      original: original.size,
      before: before.size,
      after: after.size,
      type: after.type,
      edge: Math.max(size.width, size.height),
      budget: photoByteBudget,
    };
  });
  console.log(JSON.stringify(result));
  expect(result.type).toBe("image/jpeg");
  expect(result.edge).toBe(1280);
  expect(result.after).toBeLessThanOrEqual(result.budget);
  expect(result.after).toBeLessThan(result.before);
});
