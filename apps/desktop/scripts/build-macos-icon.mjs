import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(desktopRoot, "build", "icon-macos.png");
const outputPath = join(desktopRoot, "build", "icon.icns");
const representations = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic13", size: 256 },
  { type: "ic14", size: 512 },
];

if (process.platform !== "darwin") {
  throw new Error("The macOS icon can only be built on macOS.");
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `Command failed (${code ?? signal ?? "unknown"}): ${command}`,
          ),
        );
      }
    });
  });
}

function chunk(type, payload) {
  const value = Buffer.alloc(8 + payload.length);
  value.write(type, 0, 4, "ascii");
  value.writeUInt32BE(value.length, 4);
  payload.copy(value, 8);
  return value;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "artemis-macos-icon-"));
try {
  const pngBySize = new Map();
  for (const size of new Set(representations.map((item) => item.size))) {
    const resizedPath = join(temporaryRoot, `${size}.png`);
    await run("/usr/bin/sips", [
      "-z",
      String(size),
      String(size),
      sourcePath,
      "--out",
      resizedPath,
    ]);
    pngBySize.set(size, await readFile(resizedPath));
  }

  const imageChunks = representations.map(({ type, size }) =>
    chunk(type, pngBySize.get(size)),
  );
  const table = Buffer.alloc(representations.length * 8);
  representations.forEach(({ type }, index) => {
    table.write(type, index * 8, 4, "ascii");
    table.writeUInt32BE(imageChunks[index].length, index * 8 + 4);
  });
  const chunks = [chunk("TOC ", table), ...imageChunks];
  const totalLength =
    8 + chunks.reduce((total, value) => total + value.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  await writeFile(outputPath, Buffer.concat([header, ...chunks], totalLength));

  await run("/usr/bin/iconutil", [
    "-c",
    "iconset",
    outputPath,
    "-o",
    join(temporaryRoot, "validated.iconset"),
  ]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
