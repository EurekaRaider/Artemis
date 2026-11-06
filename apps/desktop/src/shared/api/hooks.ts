export interface HooksApi {
  listHooks(
    query: import("@artemis/protocol").HookQuery,
  ): Promise<import("@artemis/protocol").HookCatalog>;
  trustHooks(
    query: import("@artemis/protocol").HookQuery,
    reviewed: Array<{ id: string; hash: string }>,
    scope: "project" | "all",
  ): Promise<void>;
  changeHook(
    query: import("@artemis/protocol").HookQuery,
    id: string,
    action: "enable" | "disable" | "revoke",
  ): Promise<void>;
  inspectHook(
    query: import("@artemis/protocol").HookQuery,
    id: string,
  ): Promise<{
    configuration: string;
    scripts: Array<{ path: string; content: string }>;
  }>;
}
