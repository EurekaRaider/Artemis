import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { estimateTextTokens, textWithinTokenBudget } from "@artemis/protocol";
import type { AttachmentWork } from "./attachment-worker.js";

export const INDEX_VERSION = 2;
const CHUNK = 16384;
export class AttachmentIndex {
  readonly db: DatabaseSync;
  private position = 0;
  constructor(path: string, writable = false) {
    this.db = new DatabaseSync(path, { readOnly: !writable });
    if (writable) {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA cache_size=-4096;
        CREATE TABLE IF NOT EXISTS segments (start INTEGER PRIMARY KEY, end INTEGER, text TEXT, page INTEGER, label TEXT);
        CREATE INDEX IF NOT EXISTS segment_end ON segments(end);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS parts (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS strings (id INTEGER, part INTEGER, text TEXT, PRIMARY KEY(id,part));`);
      const version = this.db
        .prepare("SELECT value FROM meta WHERE key='format'")
        .get()?.value;
      if (version !== String(INDEX_VERSION)) {
        this.db.exec(
          "DELETE FROM segments; DELETE FROM meta; DELETE FROM parts; DELETE FROM strings;",
        );
        this.db
          .prepare("INSERT INTO meta VALUES (?,?)")
          .run("format", String(INDEX_VERSION));
      }
      this.position = Number(
        this.db.prepare("SELECT MAX(end) AS end FROM segments").get()?.end ?? 0,
      );
    }
  }
  add(text: string, page?: number, label?: string) {
    const insert = this.db.prepare("INSERT INTO segments VALUES (?,?,?,?,?)");
    for (let i = 0; i < text.length;) {
      let end = Math.min(text.length, i + CHUNK);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
      const chunk = text.slice(i, end);
      insert.run(
        this.position,
        this.position + chunk.length,
        chunk,
        page ?? null,
        label ?? null,
      );
      this.position += chunk.length;
      i = end;
    }
  }
  finish(pages?: number) {
    const result = {
      version: INDEX_VERSION,
      complete: true,
      characters: this.position,
      ...(pages
        ? {
            pages,
            pagesWithoutText: Number(
              this.db
                .prepare(
                  "SELECT COUNT(*) AS n FROM parts WHERE name LIKE 'empty-page:%'",
                )
                .get()?.n ?? 0,
            ),
          }
        : {}),
    };
    this.db
      .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
      .run("summary", JSON.stringify(result));
    return result;
  }
  close() {
    this.db.close();
  }
}
export async function indexText(
  path: string,
  index: AttachmentIndex,
  progress: () => void,
) {
  const file = await open(path, "r"),
    header = Buffer.alloc(4);
  try {
    await file.read(header, 0, 4, 0);
  } finally {
    await file.close();
  }
  const encoding =
    header[0] === 0xff && header[1] === 0xfe
      ? "utf-16le"
      : header[0] === 0xfe && header[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  let offset = Number(
    index.db.prepare("SELECT value FROM meta WHERE key=?").get("bytes")
      ?.value ?? 0,
  );
  const checkpoint = index.db.prepare(
    "INSERT OR REPLACE INTO meta VALUES (?,?)",
  );
  const add = (text: string) => {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
      throw new Error("Unsupported binary attachment");
    index.db.exec("BEGIN");
    try {
      index.add(text);
      offset += Buffer.byteLength(
        text,
        encoding === "utf-8" ? "utf8" : "utf16le",
      );
      checkpoint.run("bytes", String(offset));
      index.db.exec("COMMIT");
    } catch (error) {
      index.db.exec("ROLLBACK");
      throw error;
    }
    progress();
  };
  for await (const bytes of createReadStream(path, {
    start: offset,
    highWaterMark: 65536,
  }))
    add(decoder.decode(bytes, { stream: true }));
  add(decoder.decode());
}
export function readIndex(
  work: AttachmentWork,
  progress: () => void = () => {},
) {
  const index = new AttachmentIndex(work.path);
  try {
    const db = index.db;
    const summary = JSON.parse(
      String(
        db.prepare("SELECT value FROM meta WHERE key=?").get("summary")
          ?.value ?? "{}",
      ),
    );
    if (!summary.complete || summary.version !== INDEX_VERSION)
      throw new Error("Attachment index is incomplete; retry parsing");
    const budget = Math.min(4000, work.maxTokens ?? 4000);
    if (!Number.isSafeInteger(budget) || budget <= 0)
      throw new Error("No context budget remains for attachment content");
    if (
      work.page !== undefined &&
      (!Number.isSafeInteger(work.page) ||
        work.page < 1 ||
        work.page > (summary.pages ?? 0))
    )
      throw new Error("Page is outside the document");
    const pageStart =
      work.page === undefined
        ? 0
        : Number(
            db
              .prepare("SELECT MIN(start) AS start FROM segments WHERE page=?")
              .get(work.page)?.start ?? 0,
          );
    if (pageStart < 0) throw new Error("Page is outside the document");
    const total =
      work.page === undefined
        ? summary.characters
        : Number(
            db
              .prepare("SELECT MAX(end) AS end FROM segments WHERE page=?")
              .get(work.page)?.end ?? pageStart,
          ) - pageStart;
    const offset = work.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > total)
      throw new Error("Invalid attachment offset");
    const rows =
      work.page === undefined
        ? db
            .prepare("SELECT * FROM segments WHERE end > ? ORDER BY start")
            .iterate(offset)
        : db
            .prepare(
              "SELECT * FROM segments WHERE end > ? AND page=? ORDER BY start",
            )
            .iterate(offset + pageStart, work.page);
    if (work.action === "search") {
      const query = work.query?.toLowerCase();
      if (!query) throw new Error("Search query is required");
      const matches = [];
      let carry = "",
        remaining = budget,
        nextOffset: number | undefined;
      for (const row of rows) {
        progress();
        const text = carry + String(row.text);
        const base = Number(row.start) - pageStart - carry.length;
        let from = Math.max(0, offset - base);
        while (remaining > 0) {
          // Unicode case folding may expand characters. RegExp keeps offsets in the original text.
          const expression = new RegExp(
            work.query!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "giu",
          );
          expression.lastIndex = from;
          const hit = expression.exec(text);
          const found = hit?.index ?? -1;
          if (found < 0) break;
          const excerpt = textWithinTokenBudget(
            text.slice(Math.max(0, found - 100), found + query.length + 200),
            Math.max(1, remaining - 80),
          );
          const match = {
            offset: base + found,
            page: row.page ?? undefined,
            label: row.label ?? undefined,
            text: excerpt,
          };
          const cost = estimateTextTokens(JSON.stringify(match)) + 1;
          if (cost > remaining && matches.length) {
            nextOffset = base + found;
            break;
          }
          matches.push(match);
          from = found + hit![0].length;
          remaining -= cost;
          if (remaining <= 0 || matches.length >= 20) {
            nextOffset = base + from;
            break;
          }
        }
        if (nextOffset !== undefined) break;
        carry = text.slice(-Math.max(0, query.length - 1));
        if (query.length === 1) carry = "";
      }
      const result = {
        id: work.id,
        matches,
        nextOffset,
        limited: nextOffset !== undefined,
        complete: nextOffset === undefined,
        totalCharacters: total,
      };
      while (
        estimateTextTokens(JSON.stringify(result)) > budget &&
        matches.length
      ) {
        const removed = matches.pop()!;
        result.nextOffset = removed.offset;
        result.limited = true;
        result.complete = false;
      }
      if (!matches.length && result.nextOffset !== undefined)
        throw new Error(
          "Attachment token budget is too small for a search result",
        );
      if (estimateTextTokens(JSON.stringify(result)) > budget)
        throw new Error(
          "Attachment token budget is too small for result metadata",
        );
      return result;
    }
    let content = "";
    const locations = [];
    let locationTokens = 0;
    for (const row of rows) {
      const start = Number(row.start) - pageStart;
      const text = String(row.text).slice(Math.max(0, offset - start));
      const part = textWithinTokenBudget(
        text,
        budget - estimateTextTokens(content),
      );
      if (part && locations.length < 20) {
        const location = {
          offset: Math.max(start, offset),
          page: row.page ?? undefined,
          label: row.label ?? undefined,
        };
        const cost = estimateTextTokens(JSON.stringify(location));
        if (locationTokens + cost <= 650) {
          locations.push(location);
          locationTokens += cost;
        }
      }
      content += part;
      if (part.length < text.length || estimateTextTokens(content) >= budget)
        break;
    }
    if (!content && offset < total)
      throw new Error(
        "Attachment token budget is too small for the next character",
      );
    const result = {
      id: work.id,
      name: work.name,
      page: work.page,
      offset,
      text: content,
      locations,
      nextOffset:
        offset + content.length < total ? offset + content.length : undefined,
      totalCharacters: total,
      empty: !total,
      ...(summary.pagesWithoutText ? { visualReadingRequired: true } : {}),
      complete: false,
    };
    while (
      result.locations.length &&
      estimateTextTokens(JSON.stringify({ ...result, text: "" })) >= budget
    )
      result.locations.pop();
    let low = 0,
      high = content.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = {
        ...result,
        text: content.slice(0, middle),
        nextOffset: offset + middle < total ? offset + middle : undefined,
      };
      if (estimateTextTokens(JSON.stringify(candidate)) <= budget) low = middle;
      else high = middle - 1;
    }
    if (low > 0 && /[\uD800-\uDBFF]/u.test(content[low - 1]!)) low--;
    result.text = content.slice(0, low);
    result.nextOffset = offset + low < total ? offset + low : undefined;
    result.complete = result.nextOffset === undefined;
    result.locations = result.locations.filter(
      (location) => location.offset < offset + low,
    );
    if (
      (!low && offset < total) ||
      estimateTextTokens(JSON.stringify(result)) > budget
    )
      throw new Error(
        "Attachment token budget is too small for result metadata and the next character",
      );
    return result;
  } finally {
    index.close();
  }
}
