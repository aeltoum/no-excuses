import { imageSize } from "image-size-next";
import { describe, expect, it } from "vitest";

describe("patched Metro image parser", () => {
  it("rejects an ICNS entry that cannot advance", () => {
    const crafted = Buffer.alloc(16);
    crafted.write("icns", 0, "ascii");
    crafted.writeUInt32BE(crafted.length, 4);
    crafted.write("ic07", 8, "ascii");
    crafted.writeUInt32BE(0, 12);

    expect(() => imageSize(crafted)).toThrow("Invalid ICNS");
  });
});
