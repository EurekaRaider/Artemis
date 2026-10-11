import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import { SaxesParser } from "saxes";
import type { AttachmentIndex } from "./attachment-index.js";
const require = createRequire(import.meta.url);
const unzipper = require("unzipper") as {
  Open: {
    file(path: string): Promise<{
      files: Array<{
        path: string;
        flags: number;
        uncompressedSize: number;
        stream(): Readable;
      }>;
    }>;
  };
};

// No extraction to the filesystem: ZIP names only become source labels.
export async function indexOffice(
  path: string,
  index: AttachmentIndex,
  progress: () => void,
) {
  const archive = await unzipper.Open.file(path);
  if (archive.files.some((entry) => (entry.flags & 1) !== 0))
    throw new Error("Encrypted Office archive: provide a decrypted copy");
  if (archive.files.some((entry) => entry.path.length > 1024))
    throw new Error("Office ZIP part name exceeds resource limit");
  if (archive.files.length > 100000)
    throw new Error("Office ZIP exceeds the 100000 entry resource limit");
  if (!index.db.prepare("SELECT name FROM parts WHERE name=?").get("media")) {
    index.db.exec("BEGIN");
    for (const entry of archive.files.filter((e) => /\/media\//.test(e.path)))
      index.add(
        `\nEmbedded image: ${entry.path} (${entry.uncompressedSize} bytes); read with visual=true and part=${entry.path}\n`,
        undefined,
        entry.path,
      );
    index.db.prepare("INSERT INTO parts VALUES (?)").run("media");
    index.db.exec("COMMIT");
  }
  if (new Set(archive.files.map((e) => e.path)).size !== archive.files.length)
    throw new Error("Duplicate Office ZIP part names");
  let expanded = 0;
  const entries = archive.files.filter((e) =>
    /^(word|xl|ppt)\/.*\.(?:xml|rels)$/i.test(e.path),
  );
  if (entries.reduce((sum, e) => sum + e.uncompressedSize, 0) > 16 * 1024 ** 3)
    throw new Error("Office expanded XML exceeds 16 GiB resource limit");
  entries.sort(
    (a, b) =>
      Number(!/sharedStrings\.xml$/.test(a.path)) -
        Number(!/sharedStrings\.xml$/.test(b.path)) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  );
  const putString = index.db.prepare("INSERT INTO strings VALUES (?,?,?)");
  const getString = index.db.prepare(
    "SELECT text FROM strings WHERE id=? ORDER BY part",
  );
  for (const entry of entries) {
    if (index.db.prepare("SELECT name FROM parts WHERE name=?").get(entry.path))
      continue;
    index.db.exec("BEGIN");
    const shared = /sharedStrings\.xml$/.test(entry.path);
    const parser = new SaxesParser({ xmlns: true });
    const stack: string[] = [];
    let stringId = -1,
      stringPart = 0,
      cellType = "",
      cellRef = "",
      value = "",
      formula = "",
      formulaAttributes = "",
      inline = "",
      buffer = "";
    const flush = () => {
      if (buffer) {
        index.add(buffer, undefined, entry.path);
        buffer = "";
      }
    };
    const emit = (text: string) => {
      buffer += text;
      if (buffer.length >= 16384) flush();
    };
    parser.on("doctype", () => {
      throw new Error("Office XML document types are not supported");
    });
    parser.on("opentag", (node) => {
      stack.push(node.local);
      if (stack.length > 256)
        throw new Error("Office XML nesting exceeds resource limit");
      const attr = (key: string) =>
        Object.values(node.attributes).find((a) => a.local === key)?.value ??
        "";
      if (shared && node.local === "si") {
        stringId++;
        stringPart = 0;
      }
      if (node.local === "c") {
        cellType = attr("t");
        cellRef = attr("r");
        value = "";
        formula = "";
        formulaAttributes = "";
        inline = "";
        emit(`[${cellRef}] `);
      }
      if (node.local === "f" && stack.includes("c"))
        formulaAttributes = JSON.stringify(
          Object.fromEntries(
            Object.values(node.attributes).map((a) => [a.local, a.value]),
          ),
        );
      if (node.local === "Relationship")
        emit(
          `\nRelationship ${attr("Id")}: ${attr("Target")} ${attr("TargetMode")}\n`,
        );
      if (node.local === "docPr" || node.local === "cNvPr")
        emit(` ${attr("title")} ${attr("descr")} `);
      if (node.local === "sheet")
        emit(
          `\nSheet ${attr("name")} (${attr("sheetId")}, ${attr("state") || "visible"}, relationship ${attr("id")})\n`,
        );
      if (["comment", "footnote", "endnote"].includes(node.local))
        emit(
          `\n${node.local} ${attr("id")} ${attr("ref")} ${attr("author")}\n`,
        );
      if (node.local === "tab") emit("\t");
      if (["br", "cr"].includes(node.local)) emit("\n");
    });
    const onText = (text: string) => {
      const tag = stack.at(-1);
      if (shared) {
        if (tag === "t")
          for (let p = 0; p < text.length;) {
            let end = Math.min(text.length, p + 16384);
            if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!))
              end--;
            putString.run(stringId, stringPart++, text.slice(p, end));
            p = end;
          }
        return;
      }
      if (stack.includes("c")) {
        if (tag === "v") value += text;
        else if (tag === "f") formula += text;
        else if (tag === "t") {
          emit(text);
          inline = "yes";
        }
        if (value.length + formula.length > 4 * 1024 * 1024)
          throw new Error("Office formula/value exceeds 4 MiB resource limit");
      } else if (
        tag &&
        [
          "t",
          "instrText",
          "delText",
          "text",
          "v",
          "f",
          "header",
          "footer",
          "oddHeader",
          "oddFooter",
          "evenHeader",
          "evenFooter",
          "firstHeader",
          "firstFooter",
        ].includes(tag)
      )
        emit(text);
    };
    parser.on("text", onText);
    parser.on("cdata", onText);
    parser.on("closetag", (node) => {
      if (shared && node.local === "si" && stringPart === 0)
        putString.run(stringId, stringPart++, "");
      if (!shared) {
        if (node.local === "c") {
          if (formula || formulaAttributes) {
            if (formulaAttributes !== "{}")
              emit(`formulaAttributes=${formulaAttributes}; `);
            emit(`formula=${formula}; cached=`);
          }
          if (cellType === "s") {
            const id = Number(value);
            if (!Number.isSafeInteger(id) || id < 0)
              throw new Error("Invalid shared string reference");
            if (!getString.get(id))
              throw new Error("Missing shared string reference");
            for (const part of getString.iterate(id)) emit(String(part.text));
          } else if (!inline) emit(value);
          emit("\t");
        }
        if (
          ["p", "row", "tr", "comment", "footnote", "endnote"].includes(
            node.local,
          )
        )
          emit("\n");
        if (node.local === "tc") emit("\t");
      }
      stack.pop();
    });
    let xmlRun = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const stream = entry.stream();
    let entryBytes = 0;
    try {
      for await (const chunk of stream) {
        expanded += chunk.length;
        entryBytes += chunk.length;
        if (expanded > 16 * 1024 ** 3)
          throw new Error("Office expanded XML exceeds 16 GiB resource limit");
        const decoded = decoder.decode(chunk, { stream: true });
        const lastTag = decoded.lastIndexOf("<");
        xmlRun =
          lastTag < 0 ? xmlRun + decoded.length : decoded.length - lastTag;
        if (xmlRun > 4 * 1024 * 1024)
          throw new Error("Office XML token exceeds the 4 MiB resource limit");
        parser.write(decoded);
        progress();
      }
      if (entryBytes !== entry.uncompressedSize)
        throw new Error("Office ZIP part size mismatch");
      parser.write(decoder.decode()).close();
      flush();
      if (!shared) index.add("\n", undefined, entry.path);
      index.db.prepare("INSERT INTO parts VALUES (?)").run(entry.path);
      index.db.exec("COMMIT");
    } finally {
      stream.destroy();
    }
  }
}

export async function officeImage(path: string, part: string): Promise<Buffer> {
  const archive = await unzipper.Open.file(path);
  if (archive.files.some((entry) => (entry.flags & 1) !== 0))
    throw new Error("Encrypted Office archive: provide a decrypted copy");
  const entry = archive.files.find(
    (e) => e.path === part && /^(word|xl|ppt)\/media\//.test(e.path),
  );
  if (!entry) throw new Error("Embedded image part is unavailable");
  if (entry.uncompressedSize > 256 * 1024 * 1024)
    throw new Error("Embedded image exceeds decode resource limit");
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = entry.stream();
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > 256 * 1024 * 1024)
        throw new Error("Embedded image exceeds decode resource limit");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    stream.destroy();
  }
}
