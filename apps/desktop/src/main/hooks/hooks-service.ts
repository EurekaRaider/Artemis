import { normalizeResourceManifest } from "@artemis/plugin-contract";
import { isExecutionMode } from "@artemis/protocol";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  HOOK_EVENTS,
  type HookDefinition,
  type HookInvocation,
  type HookResult,
  type HookRunRecord,
} from "@artemis/protocol";

export interface HookContext {
  projectId: string;
  workspacePath: string;
  threadId?: string;
  mode?: "work" | "plan" | "codemode";
  remote?: boolean;
  isCurrent?(): boolean;
}
export interface HookPluginSource {
  id: string;
  name?: string;
  root: string;
  contentHash: string;
}
interface Trust {
  id: string;
  hash: string;
  scope: string;
  enabled: boolean;
  command: string;
  definition?: string;
}
interface Source {
  kind: HookDefinition["source"];
  id: string;
  root: string;
  path: string;
  value?: unknown;
  error?: string;
  digest?: string;
  name?: string;
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return !isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`);
};
const recordLimit = 200;
const outputLimit = 256 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
async function optionalJson(path: string): Promise<unknown | undefined> {
  try {
    const info = await lstat(path);
    if (info.size > 1024 * 1024)
      throw new Error("Hook configuration exceeds 1 MiB");
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function scriptHashes(
  root: string,
): Promise<Array<{ path: string; hash: string }>> {
  const files: Array<{ path: string; hash: string }> = [];
  let size = 0;
  const visit = async (path: string): Promise<void> => {
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink())
      throw new Error("Hook script directories cannot contain symbolic links");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
    } else if (info.isFile()) {
      size += info.size;
      if (size > 100 * 1024 * 1024 || files.length >= 20000)
        throw new Error("Hook scripts exceed inspection limits");
      files.push({
        path: relative(root, path),
        hash: hash((await readFile(path)).toString("base64")),
      });
    } else throw new Error("Hook script must be a regular file");
  };
  await visit(root);
  return files;
}

/** Command execution is deliberately separate from discovery and explicit desktop trust. */
export class HooksService {
  private trusts: Trust[] = [];
  private disabledPlugins: string[] = [];
  private history: HookRunRecord[] = [];
  private loading?: Promise<void>;
  private persistence = Promise.resolve();
  private running = new Map<
    string,
    {
      hookId: string;
      projectId: string;
      threadId: string;
      abort: AbortController;
    }
  >();
  constructor(
    private readonly stateDir: string,
    private readonly userRoot: string,
    private readonly plugins: () => Promise<
      HookPluginSource[]
    > = async () => [],
    private readonly onRecord?: (record: HookRunRecord) => void,
  ) {}
  private load(): Promise<void> {
    return (this.loading ??= (async () => {
      const data = await optionalJson(join(this.stateDir, "hooks-state.json"));
      if (!data) return;
      const state = object(data);
      if (state.version !== 1 || !Array.isArray(state.trusts))
        throw new Error("Unsupported hook trust store");
      this.trusts = state.trusts as Trust[];
      this.disabledPlugins = Array.isArray(state.disabledPlugins)
        ? (state.disabledPlugins as string[])
        : [];
      this.history = Array.isArray(state.records)
        ? (state.records as HookRunRecord[]).slice(-recordLimit).map((r) =>
            r.status === "running"
              ? {
                  ...r,
                  status: "cancelled",
                  error: "Interrupted; not replayed",
                }
              : r,
          )
        : [];
    })());
  }
  private save(): Promise<void> {
    const value = JSON.stringify(
      {
        version: 1,
        trusts: this.trusts,
        disabledPlugins: this.disabledPlugins,
        records: this.history.slice(-recordLimit),
      },
      null,
      2,
    );
    const write = this.persistence
      .catch(() => {})
      .then(async () => {
        await mkdir(this.stateDir, { recursive: true });
        const path = join(this.stateDir, "hooks-state.json");
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, value, { mode: 0o600 });
        await rename(temporary, path);
      });
    this.persistence = write;
    return write;
  }
  records(threadId?: string): HookRunRecord[] {
    return structuredClone(
      this.history.filter((r) => !threadId || r.threadId === threadId),
    );
  }
  private async sources(context: HookContext): Promise<Source[]> {
    const sources: Source[] = [
      {
        kind: "user",
        id: "user",
        root: this.userRoot,
        path: join(this.userRoot, "hooks.json"),
      },
      {
        kind: "project",
        id: context.projectId,
        root: join(context.workspacePath, ".artemis"),
        path: join(context.workspacePath, ".artemis", "hooks.json"),
      },
    ].filter(
      (source) => source.kind !== "project" || context.projectId !== "user",
    ) as Source[];
    for (const plugin of await this.plugins()) {
      const start = sources.length;
      try {
        const root = await realpath(plugin.root);
        const rawManifest =
          (await optionalJson(join(root, "artemis.plugin.json"))) ?? {};
        const manifest =
          object(rawManifest).schemaVersion === 2
            ? normalizeResourceManifest(rawManifest)
            : object(rawManifest);
        const declarations =
          manifest.hooks === undefined
            ? ["./hooks/hooks.json"]
            : Array.isArray(manifest.hooks)
              ? manifest.hooks
              : [manifest.hooks];
        for (const [index, entry] of declarations.entries()) {
          const source: Source = {
            kind: "plugin",
            id: plugin.id,
            root,
            path: `${root}#${index}`,
            digest: plugin.contentHash,
            ...(plugin.name ? { name: plugin.name } : {}),
          };
          if (typeof entry === "string") {
            const path = resolve(root, entry);
            if (!entry.startsWith("./") || !inside(root, path))
              throw new Error("Plugin hook path escapes its root");
            try {
              if (!inside(root, await realpath(path)))
                throw new Error("Plugin hook path escapes its root");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            source.path = path;
          } else source.value = entry;
          sources.push(source);
        }
      } catch (error) {
        sources.splice(start);
        sources.push({
          kind: "plugin",
          id: plugin.id,
          root: plugin.root,
          path: join(plugin.root, "artemis.plugin.json"),
          error: String(error),
        });
      }
    }
    return sources;
  }
  async list(context: HookContext): Promise<HookDefinition[]> {
    await this.load();
    const definitions: HookDefinition[] = [];
    for (const source of await this.sources(context)) {
      try {
        if (source.error) throw new Error(source.error);
        const raw = source.value ?? (await optionalJson(source.path));
        if (raw === undefined) continue;
        const config = object(raw);
        const events = object(config.hooks);
        const scripts = await scriptHashes(
          source.kind === "plugin" ? source.root : join(source.root, "hooks"),
        );
        for (const [event, groups] of Object.entries(events)) {
          if (
            !HOOK_EVENTS.includes(event as HookDefinition["event"]) ||
            !Array.isArray(groups)
          )
            throw new Error(`Unsupported hook event: ${event}`);
          for (const [groupIndex, groupValue] of groups.entries()) {
            const group = object(groupValue);
            const matcher = group.matcher ?? "";
            if (typeof matcher !== "string" || matcher.length > 512)
              throw new Error("Invalid hook matcher");
            // Restrict pathological nested repetition before running a user regex on bounded names.
            if (matcher && matcher !== "*") {
              if (
                /\)[+*{]/u.test(matcher) ||
                /\\[1-9]|\(\?/u.test(matcher) ||
                (matcher.match(/[+*{]/gu)?.length ?? 0) > 2
              )
                throw new Error(
                  "Quantified groups, lookarounds, backreferences, or more than two repetitions are unsupported",
                );
              new RegExp(matcher, "u");
            }
            if (!Array.isArray(group.hooks))
              throw new Error("Expected hook handlers");
            for (const [index, value] of group.hooks.entries()) {
              const handler = object(value);
              const allowed = new Set([
                "type",
                "command",
                "commandWindows",
                "timeout",
                "statusMessage",
              ]);
              if (
                Object.keys(handler).some((key) => !allowed.has(key)) ||
                handler.type !== "command"
              )
                throw new Error("Only synchronous command hooks are supported");
              if (
                typeof handler.command !== "string" ||
                !handler.command.trim() ||
                handler.command.length > 32768
              )
                throw new Error("Invalid hook command");
              if (
                handler.commandWindows !== undefined &&
                typeof handler.commandWindows !== "string"
              )
                throw new Error("Invalid Windows command");
              const timeout =
                handler.timeout ?? (event === "SessionEnd" ? 1 : 30);
              if (
                typeof timeout !== "number" ||
                !Number.isFinite(timeout) ||
                timeout <= 0 ||
                timeout > (event === "SessionEnd" ? 3 : 600)
              )
                throw new Error("Invalid hook timeout");
              const id = hash(
                JSON.stringify([
                  source.kind,
                  source.id,
                  relative(source.root, source.path),
                  event,
                  groupIndex,
                  index,
                ]),
              );
              const digest = hash(
                JSON.stringify([
                  event,
                  matcher,
                  handler,
                  scripts,
                  source.digest,
                ]),
              );
              const grants = this.trusts.filter(
                (t) =>
                  t.id === id &&
                  (t.scope === "all" || t.scope === context.projectId),
              );
              const trust = grants.find((t) => t.hash === digest) ?? grants[0];
              definitions.push({
                projectId: context.projectId,
                workspacePath: context.workspacePath,
                id,
                hash: digest,
                event: event as HookDefinition["event"],
                matcher,
                command: handler.command,
                ...(typeof handler.commandWindows === "string"
                  ? { commandWindows: handler.commandWindows }
                  : {}),
                timeout,
                ...(typeof handler.statusMessage === "string"
                  ? { statusMessage: handler.statusMessage }
                  : {}),
                description:
                  typeof config.description === "string"
                    ? config.description
                    : "",
                source: source.kind,
                sourceId: source.id,
                ...(source.name ? { sourceName: source.name } : {}),
                sourcePath: source.path,
                scripts,
                scope:
                  trust?.scope === "all" || source.kind === "user"
                    ? "all"
                    : "project",
                status:
                  source.kind === "plugin" &&
                  this.disabledPlugins.includes(source.id)
                    ? "disabled"
                    : trust?.hash !== digest
                      ? "pending"
                      : trust.enabled
                        ? "trusted"
                        : "disabled",
                ...(trust
                  ? {
                      previousCommand: trust.command,
                      previousHash: trust.hash,
                      ...(trust.definition
                        ? { previousDefinition: trust.definition }
                        : {}),
                    }
                  : {}),
              });
            }
          }
        }
      } catch (error) {
        // An invalid file disables every handler from that file, including ones parsed earlier.
        for (let i = definitions.length - 1; i >= 0; i--)
          if (definitions[i]?.sourcePath === source.path)
            definitions.splice(i, 1);
        definitions.push({
          projectId: context.projectId,
          workspacePath: context.workspacePath,
          id: hash(source.path),
          hash: "",
          event: "SessionStart",
          matcher: "",
          command: "",
          timeout: 30,
          source: source.kind,
          sourceId: source.id,
          sourcePath: source.path,
          description: "",
          scripts: [],
          status: "invalid",
          scope: "project",
          error: String(error),
        });
      }
    }
    return definitions;
  }
  async trust(
    context: HookContext,
    reviewed: Array<{ id: string; hash: string }>,
    scope: "project" | "all",
  ): Promise<void> {
    const definitions = await this.list(context);
    const selected = reviewed.map((review) => {
      const hook = definitions.find((h) => h.id === review.id);
      if (!hook || hook.status === "invalid" || hook.hash !== review.hash)
        throw new Error("Hook changed since review; inspect it again");
      if (
        hook.source === "plugin" &&
        scope === "project" &&
        context.projectId === "user"
      )
        throw new Error(
          "Select a project before authorizing project-scoped hooks",
        );
      if (hook.source === "project" && scope !== "project")
        throw new Error("Project hooks cannot have global trust");
      return hook;
    });
    for (const hook of selected) {
      const target =
        hook.source === "user" || scope === "all" ? "all" : context.projectId;
      this.trusts = this.trusts.filter(
        (t) => !(t.id === hook.id && t.scope === target),
      );
      this.trusts.push({
        id: hook.id,
        hash: hook.hash,
        scope: target,
        enabled: true,
        command: hook.command,
        definition: JSON.stringify(
          {
            event: hook.event,
            matcher: hook.matcher,
            command: hook.command,
            commandWindows: hook.commandWindows,
            timeout: hook.timeout,
            scripts: hook.scripts,
          },
          null,
          2,
        ),
      });
    }
    await this.save();
  }
  async change(
    context: HookContext,
    id: string,
    action: "enable" | "disable" | "revoke",
  ): Promise<void> {
    await this.load();
    for (const run of this.running.values())
      if (
        run.hookId === id &&
        (run.projectId === context.projectId ||
          this.trusts.some((t) => t.id === id && t.scope === "all"))
      )
        run.abort.abort();
    const matches = (t: Trust) =>
      t.id === id && (t.scope === "all" || t.scope === context.projectId);
    if (action === "revoke")
      this.trusts = this.trusts.filter((t) => !matches(t));
    else
      for (const t of this.trusts)
        if (matches(t)) t.enabled = action === "enable";
    await this.save();
  }
  async pluginEnabled(id: string): Promise<boolean> {
    await this.load();
    return !this.disabledPlugins.includes(id);
  }
  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    await this.load();
    this.disabledPlugins = this.disabledPlugins.filter((value) => value !== id);
    if (!enabled) {
      this.disabledPlugins.push(id);
      const ids = new Set(
        (await this.list({ projectId: "user", workspacePath: this.userRoot }))
          .filter((h) => h.source === "plugin" && h.sourceId === id)
          .map((h) => h.id),
      );
      for (const run of this.running.values())
        if (ids.has(run.hookId)) run.abort.abort();
    }
    await this.save();
  }
  async removePlugin(id: string): Promise<void> {
    await this.setPluginEnabled(id, false);
    const ids = new Set(
      (await this.list({ projectId: "user", workspacePath: this.userRoot }))
        .filter((h) => h.source === "plugin" && h.sourceId === id)
        .map((h) => h.id),
    );
    this.trusts = this.trusts.filter((t) => !ids.has(t.id));
    await this.save();
  }
  cancelThread(threadId: string): void {
    for (const run of this.running.values())
      if (run.threadId === threadId) run.abort.abort();
  }
  dispose(): void {
    for (const run of this.running.values()) run.abort.abort();
  }
  async inspect(
    context: HookContext,
    id: string,
  ): Promise<{
    configuration: string;
    scripts: Array<{ path: string; content: string }>;
  }> {
    const hook = (await this.list(context)).find((h) => h.id === id);
    if (!hook) throw new Error("Hook no longer exists");
    const source = (await this.sources(context)).find(
      (s) => s.path === hook.sourcePath,
    )!;
    const root =
      source.kind === "plugin" ? source.root : join(source.root, "hooks");
    const scripts = [];
    for (const script of hook.scripts.slice(0, 30)) {
      const path = await realpath(join(root, script.path));
      if (!inside(root, path)) throw new Error("Script escaped its root");
      const data = await readFile(path);
      if (data.length <= 64 * 1024 && !data.includes(0))
        scripts.push({ path: script.path, content: data.toString("utf8") });
    }
    return {
      configuration: JSON.stringify(
        source.value ?? (await optionalJson(source.path)),
        null,
        2,
      ),
      scripts,
    };
  }
  async run(context: HookContext, input: HookInvocation): Promise<HookResult> {
    if (!isExecutionMode(context.mode) || context.isCurrent?.() === false)
      return {};
    const hooks = (await this.list(context)).filter(
      (h) =>
        h.status === "trusted" &&
        h.event === input.hook_event_name &&
        matches(h, input),
    );
    const results = await Promise.all(
      hooks.map(async (hook) => {
        // Recheck after discovery; trust may have been revoked while reading scripts.
        const fresh = (await this.list(context)).find(
          (h) =>
            h.id === hook.id && h.hash === hook.hash && h.status === "trusted",
        );
        return fresh ? this.execute(context, fresh, input) : {};
      }),
    );
    return mergeHookResults(results);
  }
  private async execute(
    context: HookContext,
    hook: HookDefinition,
    input: HookInvocation,
  ): Promise<HookResult> {
    const abort = new AbortController();
    const id = randomUUID();
    const started = Date.now();
    const record: HookRunRecord = {
      version: 1,
      id,
      hookId: hook.id,
      event: hook.event,
      threadId: context.threadId ?? input.session_id,
      ...(input.turn_id ? { turnId: input.turn_id } : {}),
      startedAt: new Date().toISOString(),
      durationMs: 0,
      status: "running",
      output: "",
    };
    this.running.set(id, {
      hookId: hook.id,
      projectId: context.projectId,
      threadId: record.threadId,
      abort,
    });
    this.history.push(record);
    this.history = this.history.slice(-recordLimit);
    this.onRecord?.({ ...record });
    try {
      await this.save();
      if (abort.signal.aborted) throw new Error("Hook cancelled");
      const command =
        process.platform === "win32"
          ? (hook.commandWindows ?? hook.command)
          : hook.command;
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      if (hook.source === "plugin") {
        const source = (await this.sources(context)).find(
          (s) => s.path === hook.sourcePath,
        )!;
        const data = join(this.stateDir, "hook-data", hook.sourceId);
        await mkdir(data, { recursive: true });
        Object.assign(env, {
          PLUGIN_ROOT: source.root,
          PLUGIN_DATA: data,
          CLAUDE_PLUGIN_ROOT: source.root,
          CLAUDE_PLUGIN_DATA: data,
        });
      }
      abort.signal.throwIfAborted();
      if (
        context.isCurrent?.() === false ||
        !this.trusts.some(
          (t) =>
            t.id === hook.id &&
            t.hash === hook.hash &&
            t.enabled &&
            (t.scope === "all" || t.scope === context.projectId),
        )
      )
        throw new Error("Hook authorization is no longer current");
      const result = await runCommand(
        command,
        context.workspacePath,
        env,
        JSON.stringify(input),
        hook.timeout * 1000,
        abort.signal,
      );
      record.output = result.stdout.slice(0, 16000);
      if (result.code !== 0 && result.code !== 2)
        throw new Error(result.stderr || `Hook exited ${result.code}`);
      const parsed = interpretHookOutput(
        hook.event,
        result.stdout,
        result.code,
        result.stderr,
      );
      record.status = "success";
      return parsed;
    } catch (error) {
      record.status = abort.signal.aborted ? "cancelled" : "failed";
      record.error = String(error).slice(0, 4000);
      if (abort.signal.aborted)
        return { blocked: true, stop: true, reason: "Hook cancelled" };
      return ["PreToolUse", "UserPromptSubmit", "PreCompact"].includes(
        hook.event,
      )
        ? { blocked: true, reason: record.error }
        : {};
    } finally {
      record.durationMs = Date.now() - started;
      this.running.delete(id);
      this.onRecord?.({ ...record });
      await this.save();
    }
  }
}
function matches(hook: HookDefinition, input: HookInvocation): boolean {
  if (
    ["Stop", "UserPromptSubmit"].includes(hook.event) ||
    !hook.matcher ||
    hook.matcher === "*"
  )
    return true;
  const name =
    input.tool_name ??
    input.trigger ??
    input.source ??
    input.agent_type ??
    input.reason ??
    "";
  const aliases =
    name === "shell" || name === "bash"
      ? [name, "Bash"]
      : name === "write"
        ? [name, "Write", "Edit"]
        : [name];
  return aliases.some((value) =>
    new RegExp(hook.matcher, "u").test(value.slice(0, 512)),
  );
}
export function interpretHookOutput(
  event: HookDefinition["event"],
  stdout: string,
  code: number,
  stderr: string,
): HookResult {
  const reason = stderr.trim().slice(0, 10000);
  if (code === 2) {
    if (event === "Stop" || event === "SubagentStop")
      return { continuation: reason || "Complete the remaining checks." };
    if (event === "PostToolUse") return { feedback: reason };
    return { blocked: true, reason };
  }
  if (!stdout.trim()) return {};
  if (
    ["SessionStart", "SubagentStart", "UserPromptSubmit"].includes(event) &&
    !stdout.trim().startsWith("{")
  )
    return { context: stdout.slice(0, 10000) };
  if (
    !stdout.trim().startsWith("{") &&
    !["Stop", "SubagentStop"].includes(event)
  )
    return {};
  const output = object(JSON.parse(stdout));
  const specific =
    output.hookSpecificOutput === undefined
      ? {}
      : object(output.hookSpecificOutput);
  if (specific.hookEventName !== undefined && specific.hookEventName !== event)
    throw new Error("Hook output event mismatch");
  const result: HookResult = {};
  const text = (value: unknown) =>
    typeof value === "string" ? value.slice(0, 10000) : undefined;
  const why =
    text(specific.permissionDecisionReason) ??
    text(output.reason) ??
    text(output.stopReason) ??
    "Blocked by hook";
  if (specific.additionalContext !== undefined)
    result.context = text(specific.additionalContext) ?? "";
  if (event === "PreToolUse") {
    if (
      specific.permissionDecision !== undefined &&
      !["allow", "deny", "ask"].includes(String(specific.permissionDecision))
    )
      throw new Error("Unsupported permission decision");
    if (
      specific.permissionDecision === "deny" ||
      output.decision === "block" ||
      output.continue === false
    ) {
      result.blocked = true;
      result.reason = why;
    }
    if (specific.updatedInput !== undefined) {
      if (specific.permissionDecision !== "allow")
        throw new Error("updatedInput requires allow");
      result.updatedInput = object(specific.updatedInput);
    }
  } else if (event === "PermissionRequest") {
    if (
      specific.updatedInput !== undefined ||
      specific.updatedPermissions !== undefined ||
      specific.interrupt !== undefined
    )
      return { permission: "deny", reason: "Unsupported permission mutation" };
    const decision =
      specific.decision === undefined ? {} : object(specific.decision);
    if (
      decision.updatedInput !== undefined ||
      decision.updatedPermissions !== undefined ||
      decision.interrupt !== undefined
    )
      return { permission: "deny", reason: "Unsupported permission mutation" };
    if (
      decision.behavior !== undefined &&
      decision.behavior !== "allow" &&
      decision.behavior !== "deny"
    )
      throw new Error("Unsupported permission behavior");
    if (output.continue === false || output.decision === "block")
      return { permission: "deny", reason: why };
    if (decision.behavior === "allow" || decision.behavior === "deny") {
      result.permission = decision.behavior;
      result.reason = text(decision.message) ?? why;
    }
  } else if (event === "Stop" || event === "SubagentStop") {
    if (output.continue === false) result.stop = true;
    else if (output.decision === "block") result.continuation = why;
  } else if (event === "PostToolUse") {
    if (output.decision === "block" || output.continue === false)
      result.feedback = why;
  } else if (output.decision === "block" || output.continue === false) {
    result.blocked = true;
    result.reason = why;
  }
  return result;
}
export function mergeHookResults(results: HookResult[]): HookResult {
  const merged: HookResult = {};
  for (const result of results) {
    if (result.blocked) {
      merged.blocked = true;
      merged.reason = result.reason ?? "Blocked by hook";
    }
    if (result.context)
      merged.context = [merged.context, result.context]
        .filter(Boolean)
        .join("\n")
        .slice(0, 10000);
    if (result.feedback)
      merged.feedback = [merged.feedback, result.feedback]
        .filter(Boolean)
        .join("\n")
        .slice(0, 10000);
    if (result.stop) merged.stop = true;
    if (
      result.permission === "deny" ||
      (result.permission === "allow" && merged.permission !== "deny")
    )
      merged.permission = result.permission;
    if (result.continuation)
      merged.continuation = [merged.continuation, result.continuation]
        .filter(Boolean)
        .join("\n")
        .slice(0, 10000);
    if (result.updatedInput) {
      if (
        merged.updatedInput &&
        JSON.stringify(merged.updatedInput) !==
          JSON.stringify(result.updatedInput)
      ) {
        merged.blocked = true;
        merged.reason = "Conflicting hook input rewrites";
      } else merged.updatedInput = result.updatedInput;
    }
  }
  if (merged.stop) delete merged.continuation;
  return merged;
}
function runCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  input: string,
  timeout: number,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(
      windows ? (env.ComSpec ?? "cmd.exe") : (env.SHELL ?? "/bin/sh"),
      windows ? ["/d", "/s", "/c", command] : ["-lc", command],
      { cwd, env, windowsHide: true, detached: !windows, stdio: "pipe" },
    );
    let stdout = "",
      stderr = "",
      bytes = 0,
      failed: Error | undefined;
    const kill = () => {
      if (!child.pid) return;
      if (windows) {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const cancel = () => {
      failed = new Error("Hook cancelled");
      kill();
    };
    const timer = setTimeout(() => {
      failed = new Error("Hook timed out");
      kill();
    }, timeout);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const collect = (data: Buffer, error: boolean) => {
      bytes += data.length;
      if (bytes > outputLimit) {
        failed = new Error("Hook output exceeds 256 KiB");
        kill();
      } else if (error) stderr += data.toString();
      else stdout += data.toString();
    };
    child.stdout.on("data", (data) => collect(data, false));
    child.stderr.on("data", (data) => collect(data, true));
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (failed) reject(failed);
      else resolvePromise({ stdout, stderr, code: code ?? 1 });
    });
    child.stdin.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        failed = error;
        kill();
      }
    });
    child.stdin.end(input);
  });
}
