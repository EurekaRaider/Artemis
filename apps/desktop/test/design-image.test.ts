import { expect, it } from "vitest";
import { designImageBytes } from "../src/main/design-image.js";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

it("bounds raster dimensions before allocating decoded pixel storage", () => {
  expect(designImageBytes(png(4000, 4000)).length).toBe(24);
  expect(() => designImageBytes(png(4001, 4000))).toThrow(/pixels/);
  expect(() => designImageBytes(png(0, 10))).toThrow(/Invalid/);
  expect(() => designImageBytes(png(0xffffffff, 0xffffffff))).toThrow(/pixels/);
});

it("rejects unsupported, truncated, mismatched and oversized image inputs", () => {
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,AQID",
    png(1, 1).replace("png", "jpeg"),
    `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}`,
  ]) {
    expect(() => designImageBytes(value)).toThrow();
  }
});

it("reads bounded JPEG SOF and WebP extended headers", () => {
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 7, 8, 0, 10, 0, 20]);
  expect(
    designImageBytes(`data:image/jpeg;base64,${jpeg.toString("base64")}`),
  ).toEqual(jpeg);
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0);
  webp.write("WEBP", 8);
  webp.write("VP8X", 12);
  webp.writeUIntLE(3999, 24, 3);
  webp.writeUIntLE(3999, 27, 3);
  expect(
    designImageBytes(`data:image/webp;base64,${webp.toString("base64")}`),
  ).toEqual(webp);
  webp.writeUIntLE(4000, 24, 3);
  expect(() =>
    designImageBytes(`data:image/webp;base64,${webp.toString("base64")}`),
  ).toThrow(/pixels/);
});
