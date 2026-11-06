import { isExecutionMode } from "@artemis/protocol";
import { HooksService, type HookContext } from "../hooks/hooks-service.js";
import { homedir as hookHomeDir } from "node:os";
import type { HookQuery } from "@artemis/protocol";
import { join } from "node:path";
import { app } from "electron";
import { getPlatformContract } from "@artemis/platform";
import type { BrokerExecutionRequest } from "@artemis/protocol";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "hooksService"
  | "artemisPluginService"
  | "store"
  | "resolveThreadWorkspace"
  | "imService"
  | "cancellingTurns"
  | "currentLocale"
  | "currentPlatform"
  | "activeTurns"
  | "diagnosticBundleService"
>;
export function createHookRuntime(services: Dependencies) {
  const {
    resolveThreadWorkspace,
    cancellingTurns,
    currentLocale,
    currentPlatform,
    activeTurns,
  } = services;
  function getHooksService(): HooksService {
    return (services.hooksService ??= new HooksService(
      join(app.getPath("userData"), "hooks"),
      join(hookHomeDir(), ".artemis"),
      () => services.artemisPluginService?.hookSources() ?? Promise.resolve([]),
    ));
  }

  async function hookContext(query: HookQuery): Promise<HookContext> {
    if (!services.store) throw new Error("Application is not ready");
    if (query.threadId) {
      const thread = services.store.getThread(query.threadId);
      if (!thread) throw new Error("Task not found");
      const context = await resolveThreadWorkspace(thread);
      return {
        projectId: context.project.id,
        workspacePath: context.workspacePath,
        threadId: thread.id,
        mode: thread.mode,
        remote: Boolean(services.imService?.hasBinding(thread.id)),
        isCurrent: () => {
          if (
            !isExecutionMode(services.store?.getThread(thread.id)?.mode) ||
            cancellingTurns.has(thread.id)
          )
            return false;
          try {
            services.imService?.authorizeThread(thread.id, "work");
            return true;
          } catch {
            return false;
          }
        },
      };
    }
    if (query.projectId) {
      const project = services.store.getProject(query.projectId);
      if (!project) throw new Error("Project not found");
      return { projectId: project.id, workspacePath: project.path };
    }
    return { projectId: "user", workspacePath: hookHomeDir() };
  }

  async function hookCatalog(
    query: HookQuery,
  ): Promise<import("@artemis/protocol").HookCatalog> {
    const context = await hookContext(query);
    let hooks = await getHooksService().list(context);
    if (!query.projectId && !query.threadId && services.store) {
      const contract = getPlatformContract();
      const projects = services.store.snapshot(
        currentLocale(),
        currentPlatform(),
        {
          available: contract.sandbox.available,
          implementation: contract.sandbox.implementation,
        },
        { includeEvents: false },
      ).projects;
      for (const project of projects) {
        const scoped = await getHooksService().list({
          projectId: project.id,
          workspacePath: project.path,
        });
        hooks.push(...scoped.filter((hook) => hook.source === "project"));
      }
    }
    if (query.pluginId)
      hooks = hooks.filter(
        (hook) => hook.source === "plugin" && hook.sourceId === query.pluginId,
      );
    return {
      hooks,
      remote: context.remote === true,
      workspacePath: context.workspacePath,
      projectId: context.projectId,
      records: getHooksService().records(query.threadId),
    };
  }

  async function contextForHook(
    query: HookQuery,
    id: string,
  ): Promise<HookContext> {
    const hook = (await hookCatalog(query)).hooks.find(
      (value) => value.id === id,
    );
    if (!hook) throw new Error("Hook no longer exists");
    return hook.source === "project" && !query.threadId
      ? hookContext({ projectId: hook.sourceId })
      : hookContext(query);
  }

  async function hookPermission(
    request: BrokerExecutionRequest,
  ): Promise<"allow" | "deny" | undefined> {
    if (!isExecutionMode(request.mode)) return;
    try {
      const context = await hookContext({ threadId: request.threadId });
      if (
        !isExecutionMode(context.mode) ||
        activeTurns.get(request.threadId) !== request.turnId ||
        cancellingTurns.has(request.threadId)
      )
        return "deny";
      const toolName =
        request.kind === "shell.execute"
          ? "Bash"
          : request.kind === "workspace.write"
            ? "Write"
            : "toolName" in request
              ? request.toolName
              : request.kind;
      const result = await getHooksService().run(context, {
        version: 1,
        hook_event_name: "PermissionRequest",
        session_id: request.threadId,
        turn_id: request.turnId,
        cwd: context.workspacePath,
        permission_mode: "work",
        tool_name: toolName,
        tool_input:
          "arguments" in request
            ? request.arguments
            : "command" in request
              ? { command: request.command }
              : request,
      });
      if (result.blocked) return "deny";
      return result.permission;
    } catch {
      return;
    }
  }

  async function endHookSession(threadId: string): Promise<void> {
    try {
      const context = await hookContext({ threadId });
      await getHooksService().run(context, {
        version: 1,
        hook_event_name: "SessionEnd",
        session_id: threadId,
        cwd: context.workspacePath,
        permission_mode: context.mode ?? "plan",
        reason: "other",
      });
    } catch (error) {
      services.diagnosticBundleService?.record({
        source: "main",
        severity: "error",
        message: `SessionEnd failed: ${String(error)}`,
      });
    }
  }
  return {
    getHooksService,
    hookContext,
    hookCatalog,
    contextForHook,
    hookPermission,
    endHookSession,
  };
}
