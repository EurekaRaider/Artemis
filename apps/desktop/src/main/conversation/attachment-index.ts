import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { estimateTextTokens, textWithinTokenBudget } from "@artemis/protocol";
import type { AttachmentWork } from "./attachment-worker.js";

export const INDEX_VERSION = 1;
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
      ...(pages ? { pages } : {}),
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
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
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
      offset += Buffer.byteLength(text, "utf8");
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
    const budget = Math.min(3000, Math.max(1, work.maxTokens ?? 4000));
    const pageStart =
      work.page === undefined
        ? 0
        : Number(
            db
              .prepare("SELECT MIN(start) AS start FROM segments WHERE page=?")
              .get(work.page)?.start ?? -1,
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
          const found = text.toLowerCase().indexOf(query, from);
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
          from = found + query.length;
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
      return {
        id: work.id,
        matches,
        nextOffset,
        limited: nextOffset !== undefined,
        complete: true,
        totalCharacters: total,
      };
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
    return {
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
      complete: true,
    };
  } finally {
    index.close();
  }
}
