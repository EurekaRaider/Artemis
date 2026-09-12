/** Read bounded raster headers before asking Electron to decode pixel storage. */
export function designImageBytes(dataUrl: string): Buffer {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataUrl,
  );
  if (!match || dataUrl.length > (4 * 1024 * 1024 * 4) / 3 + 64)
    throw new Error("Import a PNG, JPEG or WebP image of at most 4 MiB.");
  const bytes = Buffer.from(match[2]!, "base64");
  let width = 0,
    height = 0;
  if (
    match[1] === "png" &&
    bytes.length >= 24 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (match[1] === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    match[1] === "webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (
      chunk === "VP8 " &&
      bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
    ) {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    } else if (chunk === "VP8L" && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  }
  if (!width || !height || width * height > 16_000_000)
    throw new Error("Invalid raster image or image exceeds 16 million pixels.");
  return bytes;
}
