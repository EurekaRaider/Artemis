import { randomUUID } from "node:crypto";
import { constants, type ReadStream } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { AppTheme } from "@artemis/protocol";
import {
  parseSkinSelection,
  type AppearanceState,
  type AppearanceSkin,
  type SkinSelection,
  type ResolvedSkinPackage,
} from "../shared/appearance.js";
import {
  loadSkinPackage,
  skinSafePath,
  skinFileIdentity,
  type LoadedSkin,
  type SkinFile,
} from "./skin-package.js";
import type { ArtemisPluginService } from "./artemis-plugin-service.js";

interface SkinEntry {
  summary: AppearanceSkin;
  root: string;
  loaded?: LoadedSkin;
}
interface ResourceLease {
  id: string;
  owner: number;
  pluginId: string;
  root: string;
  files: Map<string, SkinFile>;
  streams: Set<ReadStream>;
  reads: Set<Promise<void>>;
}
export interface AppearanceServiceOptions {
  plugins: ArtemisPluginService;
  getSelection(): Promise<SkinSelection | null>;
  saveSelection(selection: SkinSelection | null): Promise<void>;
  getTheme(): Promise<AppTheme>;
  changed(state: AppearanceState): void;
}
export class AppearanceService {
  private entries: SkinEntry[] = [];
  private revision = 0;
  private generation = 0;
  private selection: SkinSelection | null = null;
  private theme: AppTheme = "system";
  private mediaPaused = false;
  private readonly blocked = new Set<string>();
  private readonly leases = new Map<string, ResourceLease>();
  private readonly pending = new Map<number, number>();
  private refreshTail: Promise<void> = Promise.resolve();
  constructor(private readonly options: AppearanceServiceOptions) {}
  state(): AppearanceState {
    return structuredClone({
      schemaVersion: 1,
      revision: this.revision,
      theme: this.theme,
      selection: this.selection,
      catalog: this.entries.map((e) => e.summary),
      mediaPaused: this.mediaPaused,
    });
  }
  async refresh(): Promise<AppearanceState> {
    const task = this.refreshTail.then(async () => {
      const sources = await this.options.plugins.skinSources();
      const entries: SkinEntry[] = [];
      for (const source of sources) {
        for (const { path, ...skin } of source.skins) {
          const root = join(source.root, path);
          let loaded: LoadedSkin | undefined, reason: string | undefined;
          try {
            await this.options.plugins.assertSkinSnapshot(
              source.pluginId,
              source.contentHash,
            );
            loaded = await loadSkinPackage(root);
            if (loaded.data.manifest.id !== skin.id)
              throw new Error("Skin identity changed.");
          } catch (error) {
            reason = error instanceof Error ? error.message : String(error);
          }
          entries.push({
            root,
            ...(loaded ? { loaded } : {}),
            summary: {
              ...skin,
              pluginId: source.pluginId,
              pluginName: source.pluginName,
              contentHash: source.contentHash,
              enabled: source.enabled,
              available: Boolean(loaded) && source.enabled,
              ...(loaded ? { manifest: loaded.data.manifest } : {}),
              ...(reason ? { reason } : {}),
            },
          });
        }
      }
      this.selection = await this.options.getSelection();
      this.theme = await this.options.getTheme();
      if (
        this.selection &&
        !entries.some(
          (e) =>
            e.summary.pluginId === this.selection!.pluginId &&
            e.summary.id === this.selection!.skinId,
        )
      ) {
        await this.options.saveSelection(null);
        this.selection = null;
      }
      this.entries = entries;
      this.blocked.clear();
      this.revision++;
      this.options.changed(this.state());
    });
    this.refreshTail = task.catch(() => undefined);
    await task;
    return this.state();
  }
  async select(value: unknown): Promise<AppearanceState> {
    const selection = parseSkinSelection(value);
    if (
      selection &&
      !this.entries.some(
        (e) =>
          e.summary.pluginId === selection.pluginId &&
          e.summary.id === selection.skinId &&
          e.summary.available,
      )
    )
      throw new Error("Skin is not available.");
    await this.options.saveSelection(selection);
    this.selection = selection;
    if (
      selection &&
      !this.entries.some(
        (e) =>
          e.summary.pluginId === selection.pluginId &&
          e.summary.id === selection.skinId,
      )
    ) {
      await this.options.saveSelection(null);
      this.selection = null;
    }
    this.revision++;
    this.options.changed(this.state());
    return this.state();
  }
  async resolve(owner: number, input: unknown): Promise<ResolvedSkinPackage> {
    const selection = parseSkinSelection(input);
    if (!selection) throw new Error("Default skin has no external resources.");
    const entry = this.entries.find(
      (e) =>
        e.summary.pluginId === selection.pluginId &&
        e.summary.id === selection.skinId,
    );
    const generation = this.generation,
      revision = this.revision;
    if (
      !entry?.summary.available ||
      !entry.loaded ||
      this.blocked.has(selection.pluginId)
    )
      throw new Error("Skin is not available.");
    if (
      [...this.leases.values()].filter((l) => l.owner === owner).length +
        (this.pending.get(owner) ?? 0) >=
      8
    )
      throw new Error("Too many skin previews.");
    this.pending.set(owner, (this.pending.get(owner) ?? 0) + 1);
    try {
      await this.options.plugins.assertSkinSnapshot(
        selection.pluginId,
        entry.summary.contentHash,
      );
      const root = await realpath(entry.root),
        loaded = await loadSkinPackage(root);
      if (
        generation !== this.generation ||
        revision !== this.revision ||
        this.blocked.has(selection.pluginId)
      )
        throw new Error("Skin changed while resolving.");
      const id = randomUUID(),
        lease: ResourceLease = {
          id,
          owner,
          pluginId: selection.pluginId,
          root,
          files: new Map(),
          streams: new Set(),
          reads: new Set(),
        };
      const assets: Record<
        string,
        { url: string; hash: string; mime: string }
      > = {};
      if (loaded.data.manifest.schemaVersion === 2)
        for (const [name, asset] of Object.entries(
          loaded.data.manifest.assets,
        )) {
          const file = loaded.files[asset.path]!,
            url = `artemis-skin://asset/${randomUUID()}`;
          lease.files.set(url, file);
          assets[name] = { url, hash: file.hash, mime: file.mime };
        }
      this.leases.set(id, lease);
      return {
        selection,
        revision,
        contentHash: entry.summary.contentHash,
        leaseId: id,
        data: loaded.data,
        assets,
      };
    } finally {
      const count = (this.pending.get(owner) ?? 1) - 1;
      if (count) this.pending.set(owner, count);
      else this.pending.delete(owner);
    }
  }
  async release(owner: number, id: string): Promise<void> {
    const lease = this.leases.get(id);
    if (!lease || lease.owner !== owner) return;
    this.leases.delete(id);
    await Promise.all(
      [...lease.streams].map(
        (stream) =>
          new Promise<void>((resolve) => {
            if (stream.closed) return resolve();
            stream.once("close", resolve);
            stream.destroy();
          }),
      ),
    );
    await Promise.all([...lease.reads]);
  }
  async releaseOwner(owner: number) {
    this.generation++;
    await Promise.all(
      [...this.leases.values()]
        .filter((l) => l.owner === owner)
        .map((l) => this.release(owner, l.id)),
    );
  }
  async beforePluginChange(pluginId: string) {
    this.blocked.add(pluginId);
    this.generation++;
    this.entries = this.entries.map((e) =>
      e.summary.pluginId === pluginId
        ? {
            ...e,
            summary: {
              ...e.summary,
              available: false,
              reason: "Plugin is changing.",
            },
          }
        : e,
    );
    this.revision++;
    this.options.changed(this.state());
    await Promise.all(
      [...this.leases.values()]
        .filter((l) => l.pluginId === pluginId)
        .map((l) => this.release(l.owner, l.id)),
    );
  }
  setTheme(theme: AppTheme) {
    this.theme = theme;
    this.revision++;
    this.options.changed(this.state());
  }
  setMediaPaused(paused: boolean) {
    if (this.mediaPaused === paused) return;
    this.mediaPaused = paused;
    this.options.changed(this.state());
  }
  async dispose() {
    this.generation++;
    await Promise.all(
      [...this.leases.values()].map((l) => this.release(l.owner, l.id)),
    );
  }
  async respond(request: Request): Promise<Response> {
    let lease: ResourceLease | undefined, file: SkinFile | undefined;
    for (const l of this.leases.values()) {
      const f = l.files.get(request.url);
      if (f) {
        lease = l;
        file = f;
        break;
      }
    }
    if (!lease || !file || this.blocked.has(lease.pluginId))
      return new Response(null, { status: 404 });
    let finishRead!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    lease.reads.add(pendingRead);
    if (!["GET", "HEAD"].includes(request.method)) {
      finishRead();
      lease.reads.delete(pendingRead);
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const path = await skinSafePath(lease.root, file.path);
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat({ bigint: true });
      if (
        (await skinSafePath(lease.root, file.path)) !== path ||
        !this.leases.has(lease.id) ||
        this.blocked.has(lease.pluginId) ||
        !stat.isFile() ||
        skinFileIdentity(stat) !== file.identity
      )
        return new Response(null, { status: 409 });
      const size = Number(stat.size);
      let start = 0,
        end = size - 1,
        status = 200;
      const range =
        request.method === "GET" ? request.headers.get("range") : null;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
        let valid = Boolean(match && (match[1] || match[2]));
        if (valid && match) {
          if (!match[1]) {
            const suffix = Number(match[2]);
            valid = Number.isSafeInteger(suffix) && suffix > 0;
            start = Math.max(0, size - suffix);
          } else {
            start = Number(match[1]);
            const last = match[2] ? Number(match[2]) : size - 1;
            valid =
              Number.isSafeInteger(start) &&
              Number.isSafeInteger(last) &&
              last >= start;
            end = Math.min(last, size - 1);
          }
        }
        if (!valid || start >= size)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        status = 206;
      }
      const headers = {
        "Content-Type": file.mime,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${size}` }
          : {}),
      };
      if (request.method === "HEAD")
        return new Response(null, { status, headers });
      const stream = handle.createReadStream({
        start,
        end,
        autoClose: true,
        highWaterMark: 64 * 1024,
        signal: request.signal,
      });
      handle = undefined;
      lease.streams.add(stream);
      const streams = lease.streams;
      stream.once("close", () => streams.delete(stream));
      return new Response(
        Readable.toWeb(stream, {
          strategy: {
            highWaterMark: 64 * 1024,
            size: (chunk: Buffer) => chunk.byteLength,
          },
        }) as ReadableStream<Uint8Array>,
        { status, headers },
      );
    } catch {
      return new Response(null, { status: 404 });
    } finally {
      try {
        await handle?.close();
      } finally {
        finishRead();
        lease.reads.delete(pendingRead);
      }
    }
  }
}
