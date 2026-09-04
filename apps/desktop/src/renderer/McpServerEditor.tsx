import { useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { Select, Switch, TextField } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  ManagementCard,
  ManagementHeader,
  McpEditorSurface,
} from "@artemis/ui/management";

import type {
  McpServerConfig,
  McpServerStatus,
  SettingsSnapshot,
} from "../shared/api.js";
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import {
  McpEditorFeedback,
  type McpEditorTestConnectionState,
} from "./McpEditorFeedback.js";

interface McpServerEditorProps {
  existingServers: readonly McpServerStatus[];
  locale: AppLocale;
  server?: McpServerStatus;
  onCancel(): void;
  /**
   * App `requestConfirmation` primitive forwarded by ResourceCenter; the
   * Uninstall control routes its danger confirmation through it.
   */
  onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
  onRemoved(settings: SettingsSnapshot): void;
  onSaved(settings: SettingsSnapshot): void;
}

const labels = {
  en: {
    addMcp: "Add MCP server",
    updateMcp: "Update {name} MCP",
    newServerHint: "Enter the command Artemis should launch.",
    transportChangeHint:
      "To change the MCP server type, uninstall the current configuration first.",
    launchCommand: "Launch command",
    serverUrl: "Server URL",
    arguments: "Arguments",
    addArgument: "Add argument",
    environmentVariables: "Environment variables",
    environmentKey: "Key",
    environmentValue: "Value",
    addEnvironment: "Add environment variable",
    environmentVariablePassthrough: "Environment variable passthrough",
    environmentVariableName: "Variable name",
    addEnvironmentVariable: "Add variable",
    workspace: "Working directory",
    authentication: "Authentication",
    authNone: "None",
    authBearer: "Bearer token",
    authOAuth: "OAuth 2.1",
    authHeaders: "Registry headers",
    bearer: "Bearer token (optional, encrypted)",
    oauthHint:
      "Authorization opens your browser and stores tokens with OS encryption.",
    registryHeadersHint:
      "Registry headers are encrypted. Reinstall from the Registry to change their values.",
    registryCredentialsHint:
      "This Registry command is locked to prevent sending its encrypted credentials to another program. Uninstall and reinstall to change it.",
    mcpSecurity: "Permissions",
    mcpAllowNetwork: "Allow network access",
    mcpAllowNetworkHint:
      "Off by default for manually added servers. The OS sandbox still limits file access to the task workspace.",
    mcpFullAccess: "Full local access (compatibility mode)",
    mcpFullAccessHint:
      "Disables the OS sandbox and restores desktop filesystem, environment, and unrestricted network access for this server. Enable only when a trusted server cannot run sandboxed.",
    saveServer: "Save and connect",
    uninstall: "Uninstall",
    cancel: "Back to MCP servers",
    delete: "Delete",
    savingServer: "Saving…",
    removingServer: "Removing…",
    tryAgain: "Try again",
    validationHeading: "Fix these issues before saving:",
    validationCommandRequired: "Enter the launch command for the MCP server.",
    validationUrlRequired: "Enter the server URL.",
    validationUrlInvalid: "Enter a valid http:// or https:// server URL.",
    testConnection: "Test connection",
    testConnectionBusy: "Testing the connection…",
    testConnectionSuccess: "Connected.",
    testConnectionFailure: "Connection failed.",
    testConnectionNotConnected:
      "The server did not report a connected state after reconnecting.",
    testSavedOnlyHint:
      "Tests the saved configuration — save your changes first",
    confirmUninstall:
      "Uninstall {name}? This removes the saved configuration only; files on the server are not deleted.",
  },
  "zh-CN": {
    addMcp: "添加 MCP 服务器",
    updateMcp: "更新 {name} MCP",
    newServerHint: "填写 Artemis 要启动的命令。",
    transportChangeHint: "如需切换 MCP 服务器类型，请先卸载当前配置。",
    launchCommand: "启动命令",
    serverUrl: "服务器 URL",
    arguments: "参数",
    addArgument: "添加参数",
    environmentVariables: "环境变量",
    environmentKey: "键",
    environmentValue: "值",
    addEnvironment: "添加环境变量",
    environmentVariablePassthrough: "环境变量传递",
    environmentVariableName: "变量名",
    addEnvironmentVariable: "添加变量",
    workspace: "工作目录",
    authentication: "身份验证",
    authNone: "无",
    authBearer: "Bearer Token",
    authOAuth: "OAuth 2.1",
    authHeaders: "Registry Header",
    bearer: "Bearer Token（可选，加密保存）",
    oauthHint: "授权将在浏览器中完成，Token 由操作系统加密保存。",
    registryHeadersHint:
      "Registry Header 已加密保存；如需更改，请从 Registry 重新安装。",
    registryCredentialsHint:
      "这个 Registry 启动命令已锁定，避免把加密凭据交给其他程序；如需更改，请卸载后重新安装。",
    mcpSecurity: "权限",
    mcpAllowNetwork: "允许网络访问",
    mcpAllowNetworkHint:
      "手动添加的服务器默认关闭；即使开启，操作系统沙盒仍只允许访问任务工作区。",
    mcpFullAccess: "完整本机访问（兼容模式）",
    mcpFullAccessHint:
      "关闭该服务器的操作系统沙盒，并恢复桌面文件、进程环境和不受限网络访问。仅在可信服务器无法受限运行时开启。",
    saveServer: "保存并连接",
    uninstall: "卸载",
    cancel: "返回 MCP 服务器",
    delete: "删除",
    savingServer: "正在保存…",
    removingServer: "正在移除…",
    tryAgain: "重试",
    validationHeading: "请先修正以下问题再保存：",
    validationCommandRequired: "请填写 MCP 服务器的启动命令。",
    validationUrlRequired: "请填写服务器 URL。",
    validationUrlInvalid: "请输入有效的 http:// 或 https:// 服务器 URL。",
    testConnection: "测试连接",
    testConnectionBusy: "正在测试连接…",
    testConnectionSuccess: "已连接。",
    testConnectionFailure: "连接失败。",
    testConnectionNotConnected: "重新连接后服务器未进入已连接状态。",
    testSavedOnlyHint: "测试的是已保存配置——请先保存修改",
    confirmUninstall:
      "卸载 {name}？此操作只删除保存的配置，不会删除服务器上的文件。",
  },
} as const;

function deriveMcpIdentity(
  transport: McpServerConfig["transport"],
  endpoint: string,
  args: string[],
): { id: string; name: string } {
  let candidate = endpoint.trim().replace(/^["']|["']$/gu, "");
  if (transport === "streamable-http") {
    try {
      candidate = new URL(candidate).hostname;
    } catch {
      // The main process reports invalid URLs when saving.
    }
  } else {
    const executable = candidate.split(/[\\/]/u).at(-1) ?? candidate;
    const runner = executable.replace(/\.(?:cmd|exe)$/iu, "").toLowerCase();
    if (["bunx", "node", "npx", "pnpm", "python", "python3"].includes(runner)) {
      candidate =
        args.find((argument) => argument.trim() && !argument.startsWith("-")) ??
        executable;
    } else {
      candidate = executable;
    }
  }
  const name =
    (candidate.split(/[\\/]/u).at(-1) ?? candidate)
      .replace(/@[^@/]+$/u, "")
      .replace(/\.(?:cmd|exe|js|mjs|py)$/iu, "")
      .trim()
      .slice(0, 100) || "MCP server";
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[.-]+|[.-]+$/gu, "")
      .slice(0, 64) || "mcp-server";
  return { id, name };
}

function sameStringList(
  draft: readonly string[],
  saved: readonly string[],
): boolean {
  return (
    draft.length === saved.length &&
    draft.every((value, index) => value === saved[index])
  );
}

function sameEnvironmentDraft(
  draft: Record<string, string>,
  saved: Record<string, string>,
): boolean {
  const keys = Object.keys(draft);
  return (
    keys.length === Object.keys(saved).length &&
    keys.every((key) => draft[key] === saved[key])
  );
}

function isValidServerUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function McpServerEditor({
  existingServers,
  locale,
  server,
  onCancel,
  onConfirm,
  onRemoved,
  onSaved,
}: McpServerEditorProps) {
  const t = localizedCopy(locale, "resources", labels[legacyLocale(locale)]);
  const [transport] = useState<McpServerConfig["transport"]>(
    server?.config.transport ?? "stdio",
  );
  const [endpoint, setEndpoint] = useState(
    server
      ? server.config.transport === "stdio"
        ? server.config.command
        : server.config.url
      : "",
  );
  const [argumentsList, setArgumentsList] = useState(
    server?.config.transport === "stdio" ? server.config.args : [],
  );
  const [environment, setEnvironment] = useState<
    Array<{ key: string; value: string }>
  >(() => {
    if (server?.config.transport !== "stdio") return [{ key: "", value: "" }];
    const entries = Object.entries(server.config.env);
    return entries.length
      ? entries.map(([key, value]) => ({ key, value }))
      : [{ key: "", value: "" }];
  });
  const [environmentVariables, setEnvironmentVariables] = useState(
    server?.config.transport === "stdio" && server.config.envVars.length
      ? server.config.envVars
      : [""],
  );
  const [workspace, setWorkspace] = useState(
    server?.config.transport === "stdio" ? server.config.workspacePath : "",
  );
  const [mcpAllowNetwork, setMcpAllowNetwork] = useState(
    server?.config.transport === "stdio" ? server.config.allowNetwork : false,
  );
  const [mcpFullAccess, setMcpFullAccess] = useState(
    server?.config.transport === "stdio"
      ? Boolean(server.config.fullAccess)
      : false,
  );
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth" | "headers">(
    server?.config.transport === "streamable-http"
      ? (server.config.auth ?? "none")
      : "none",
  );
  const [bearer, setBearer] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "remove" | null>(null);
  const [failedAction, setFailedAction] = useState<"save" | "remove" | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [testState, setTestState] = useState<McpEditorTestConnectionState>({
    status: "idle",
  });
  // Mirrors the McpEditorFeedback confirmation guard: true while the danger
  // alertdialog for Uninstall is open, so the editor's own Save/Test controls
  // can join the four-way mutual exclusion.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Ref copies of the mutual-exclusion flags. Handler guards must read the
  // current instant, never a stale render closure: `onRemove` fires in the
  // same microtask that flips confirmingRemove back to false, so only a ref
  // is guaranteed fresh there.
  const busyRef = useRef(false);
  const testPendingRef = useRef(false);
  const confirmingRemoveRef = useRef(false);
  const locksCredentialTarget =
    server?.config.transport === "stdio" &&
    (server.config.credentialEnvVars?.length ?? 0) > 0;
  const locksHeaderTarget =
    server?.config.transport === "streamable-http" &&
    server.config.auth === "headers";
  const testPending = testState.status === "busy";
  // Draft drift (PR8 review F1/F2): reconnectMcpServer only tests the saved
  // configuration, so testing is gated while the draft differs from it. Every
  // field save() assembles participates, mirroring the exact config a save
  // would persist: endpoint, auth, args, env, envVars, workspace, and the
  // permission pair (allowNetwork compares the same mcpFullAccess ||
  // mcpAllowNetwork composite save() writes). The bearer is deliberately
  // excluded from the "matches" side: the editor never backfills it
  // (useState("")), so an empty bearer counts as unmodified and only a newly
  // typed token marks the draft as drifted.
  const draftMatchesSaved =
    server === undefined ||
    (endpoint ===
      (server.config.transport === "stdio"
        ? server.config.command
        : server.config.url) &&
      auth ===
        (server.config.transport === "streamable-http"
          ? (server.config.auth ?? "none")
          : "none") &&
      bearer === "" &&
      (server.config.transport !== "stdio" ||
        (sameStringList(argumentsList, server.config.args) &&
          sameEnvironmentDraft(
            Object.fromEntries(
              environment
                .filter((entry) => entry.key.trim())
                .map((entry) => [entry.key, entry.value]),
            ),
            server.config.env,
          ) &&
          sameStringList(
            environmentVariables.filter((name) => name.trim()),
            server.config.envVars,
          ) &&
          workspace === server.config.workspacePath &&
          mcpFullAccess === Boolean(server.config.fullAccess) &&
          (mcpFullAccess || mcpAllowNetwork) === server.config.allowNetwork)));
  // Four-way action lock (saving / removing / testing / confirming): the UI
  // layer disables every control and the handler layer re-checks it below.
  const actionsLocked = busy || testPending || confirmingRemove;

  // SECURITY: messages are composed from label copy and error text only —
  // credential values (bearer input) never flow into any of these strings.
  const validationErrors: string[] = [];
  if (!endpoint.trim()) {
    validationErrors.push(
      transport === "stdio"
        ? t.validationCommandRequired
        : t.validationUrlRequired,
    );
  } else if (
    transport === "streamable-http" &&
    !isValidServerUrl(endpoint.trim())
  ) {
    validationErrors.push(t.validationUrlInvalid);
  }

  // Editor-level action guard: the component layer disables the buttons,
  // this re-checks the mutual-exclusion state at the handler entry so a
  // programmatic trigger (retry affordance, dispatched event) can never
  // overlap two `window.artemis` calls.
  function actionLocked(): boolean {
    return (
      busyRef.current || testPendingRef.current || confirmingRemoveRef.current
    );
  }

  async function run(
    action: "save" | "remove",
    operation: () => Promise<void>,
  ) {
    if (actionLocked()) return;
    busyRef.current = true;
    setBusy(true);
    setBusyAction(action);
    setMessage("");
    setFailedAction(null);
    try {
      await operation();
    } catch (error) {
      setFailedAction(action);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setBusyAction(null);
    }
  }

  function attemptSave() {
    if (validationErrors.length > 0 || actionLocked()) return;
    void run("save", save);
  }

  function retryLastAction() {
    if (failedAction === "remove") {
      void run("remove", removeServer);
    } else if (failedAction === "save" && validationErrors.length === 0) {
      void run("save", save);
    }
  }

  async function save() {
    const identity = deriveMcpIdentity(transport, endpoint, argumentsList);
    const occupiedIds = new Set(
      existingServers
        .filter((candidate) => candidate.config.id !== server?.config.id)
        .map((candidate) => candidate.config.id),
    );
    let serverId = server?.config.id ?? identity.id;
    for (let suffix = 2; occupiedIds.has(serverId); suffix += 1) {
      const suffixText = `-${suffix}`;
      serverId = `${identity.id.slice(0, 64 - suffixText.length)}${suffixText}`;
    }
    const resourceMetadata = server?.config.resourceKind
      ? {
          resourceKind: server.config.resourceKind,
          ...(server.config.connectorId
            ? { connectorId: server.config.connectorId }
            : {}),
        }
      : {};
    let config: McpServerConfig;
    if (transport === "stdio") {
      config = {
        ...resourceMetadata,
        id: serverId,
        name: server?.config.name ?? identity.name,
        transport: "stdio",
        enabled: server?.config.enabled ?? true,
        command: endpoint,
        args: argumentsList,
        env: Object.fromEntries(
          environment
            .filter((entry) => entry.key.trim())
            .map((entry) => [entry.key, entry.value]),
        ),
        envVars: environmentVariables.filter((name) => name.trim()),
        credentialEnvVars:
          server?.config.transport === "stdio"
            ? (server.config.credentialEnvVars ?? [])
            : [],
        workspacePath: workspace,
        allowNetwork: mcpFullAccess || mcpAllowNetwork,
        fullAccess: mcpFullAccess,
      };
    } else {
      config = {
        ...resourceMetadata,
        id: serverId,
        name: server?.config.name ?? identity.name,
        transport: "streamable-http",
        enabled: server?.config.enabled ?? true,
        url: endpoint,
        auth,
        ...(auth === "headers" && server?.config.transport === "streamable-http"
          ? { headerNames: server.config.headerNames ?? [] }
          : {}),
      };
    }
    onSaved(
      await window.artemis.saveMcpServer(
        config,
        auth === "bearer" ? bearer || undefined : undefined,
      ),
    );
  }

  async function removeServer() {
    // The busy lock is owned by run(), which guards the remove entry (the
    // remove control's onRemove) before setting it; here only the other two
    // exclusion states are re-checked so this inner step can never fire
    // while a test or a pending confirmation is in flight.
    if (!server || testPendingRef.current || confirmingRemoveRef.current) {
      return;
    }
    onRemoved(await window.artemis.removeMcpServer(server.config.id));
  }

  async function testConnectionNow() {
    // Only the saved configuration is testable: block while the draft has
    // drifted and while any other action is in flight.
    if (!server || !draftMatchesSaved || actionLocked()) return;
    const serverId = server.config.id;
    testPendingRef.current = true;
    setTestState({ status: "busy" });
    try {
      const snapshot = await window.artemis.reconnectMcpServer(serverId);
      const status = snapshot.mcpServers.find(
        (candidate) => candidate.config.id === serverId,
      );
      if (status?.state === "connected") {
        setTestState({ status: "success" });
      } else {
        setTestState({
          status: "failure",
          message: status?.error ?? t.testConnectionNotConnected,
        });
      }
    } catch (error) {
      setTestState({
        status: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      testPendingRef.current = false;
    }
  }

  const editorTitle = server
    ? t.updateMcp.replace("{name}", server.config.name)
    : t.addMcp;

  return (
    <McpEditorSurface
      actions={
        <Button
          className="mcp-editor-save"
          disabled={
            validationErrors.length > 0 ||
            (actionsLocked && busyAction !== "save")
          }
          loading={busyAction === "save"}
          onClick={attemptSave}
          variant="primary"
        >
          {t.saveServer}
        </Button>
      }
      busy={busy}
      className="settings-section resource-standalone-editor mcp-editor"
      header={
        <ManagementHeader
          className="mcp-editor-header"
          description={server ? t.transportChangeHint : t.newServerHint}
          leading={
            <Button
              className="mcp-editor-back"
              disabled={busy}
              icon={<ArtemisIcon name="chev-left" />}
              onClick={onCancel}
              variant="quiet"
            >
              {t.cancel}
            </Button>
          }
          title={editorTitle}
        />
      }
      label={editorTitle}
      state={message || validationErrors.length > 0 ? "error" : undefined}
    >
      <McpEditorFeedback
        busy={busy}
        onActionErrorRetry={retryLastAction}
        validationErrors={validationErrors}
        validationHeading={t.validationHeading}
        {...(message
          ? { actionError: message, actionErrorRetryLabel: t.tryAgain }
          : {})}
        {...(busy
          ? {
              busyLabel:
                busyAction === "remove" ? t.removingServer : t.savingServer,
            }
          : {})}
        {...(server
          ? {
              remove: {
                label: t.uninstall,
                confirmMessage: t.confirmUninstall.replace(
                  "{name}",
                  server.config.name,
                ),
                // Track the confirm-open window so Save and the test control
                // join the mutual exclusion while the alertdialog is showing.
                onConfirm: async (message, tone) => {
                  if (confirmingRemoveRef.current) return false;
                  confirmingRemoveRef.current = true;
                  setConfirmingRemove(true);
                  try {
                    return await onConfirm(message, tone);
                  } finally {
                    confirmingRemoveRef.current = false;
                    setConfirmingRemove(false);
                  }
                },
                onRemove: () => void run("remove", removeServer),
              },
              testConnection: {
                state: testState,
                label: t.testConnection,
                busyLabel: t.testConnectionBusy,
                successLabel: t.testConnectionSuccess,
                failureLabel: t.testConnectionFailure,
                ...(draftMatchesSaved
                  ? {}
                  : { disabled: true, disabledHint: t.testSavedOnlyHint }),
                onTest: () => void testConnectionNow(),
              },
            }
          : {})}
      >
        {transport === "stdio" ? (
          <>
            <ManagementCard className="mcp-editor-card">
              <TextField
                autoFocus
                disabled={busy || locksCredentialTarget}
                label={t.launchCommand}
                onValueChange={setEndpoint}
                value={endpoint}
              />
            </ManagementCard>
            <ManagementCard className="mcp-editor-card">
              <strong>{t.arguments}</strong>
              <div className="mcp-dynamic-list">
                {argumentsList.map((argument, index) => (
                  <div className="mcp-argument-row" key={`argument-${index}`}>
                    <TextField
                      disabled={busy || locksCredentialTarget}
                      label={`${t.arguments} ${index + 1}`}
                      labelVisibility="hidden"
                      onValueChange={(next) =>
                        setArgumentsList((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index ? next : value,
                          ),
                        )
                      }
                      value={argument}
                    />
                    <IconButton
                      className="mcp-remove-row"
                      disabled={busy || locksCredentialTarget}
                      icon="×"
                      label={`${t.delete} ${index + 1}`}
                      onClick={() =>
                        setArgumentsList((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      variant="danger"
                    />
                  </div>
                ))}
                <Button
                  className="mcp-add-row"
                  disabled={busy || locksCredentialTarget}
                  onClick={() =>
                    setArgumentsList((current) => [...current, ""])
                  }
                  variant="secondary"
                >
                  + {t.addArgument}
                </Button>
              </div>
            </ManagementCard>
            {locksCredentialTarget && (
              <InlineNotice className="settings-security" tone="warning">
                {t.registryCredentialsHint}
              </InlineNotice>
            )}
            <ManagementCard className="mcp-editor-card">
              <strong>{t.environmentVariables}</strong>
              <div className="mcp-dynamic-list">
                {environment.map((entry, index) => (
                  <div
                    className="mcp-environment-row"
                    key={`environment-${index}`}
                  >
                    <TextField
                      disabled={busy}
                      label={`${t.environmentKey} ${index + 1}`}
                      labelVisibility="hidden"
                      onValueChange={(next) =>
                        setEnvironment((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index
                              ? { ...value, key: next }
                              : value,
                          ),
                        )
                      }
                      placeholder={t.environmentKey}
                      value={entry.key}
                    />
                    <TextField
                      disabled={busy}
                      label={`${t.environmentValue} ${index + 1}`}
                      labelVisibility="hidden"
                      onValueChange={(next) =>
                        setEnvironment((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index
                              ? { ...value, value: next }
                              : value,
                          ),
                        )
                      }
                      placeholder={t.environmentValue}
                      value={entry.value}
                    />
                    <IconButton
                      className="mcp-remove-row"
                      disabled={busy}
                      icon="×"
                      label={`${t.delete} ${index + 1}`}
                      onClick={() =>
                        setEnvironment((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      variant="danger"
                    />
                  </div>
                ))}
                <Button
                  className="mcp-add-row"
                  disabled={busy}
                  onClick={() =>
                    setEnvironment((current) => [
                      ...current,
                      { key: "", value: "" },
                    ])
                  }
                >
                  + {t.addEnvironment}
                </Button>
              </div>
            </ManagementCard>
            <ManagementCard className="mcp-editor-card">
              <strong>{t.environmentVariablePassthrough}</strong>
              <div className="mcp-dynamic-list">
                {environmentVariables.map((name, index) => (
                  <div
                    className="mcp-argument-row"
                    key={`environment-variable-${index}`}
                  >
                    <TextField
                      disabled={busy}
                      label={`${t.environmentVariableName} ${index + 1}`}
                      labelVisibility="hidden"
                      onValueChange={(next) =>
                        setEnvironmentVariables((current) =>
                          current.map((value, itemIndex) =>
                            itemIndex === index ? next : value,
                          ),
                        )
                      }
                      placeholder={t.environmentVariableName}
                      value={name}
                    />
                    <IconButton
                      className="mcp-remove-row"
                      disabled={busy}
                      icon="×"
                      label={`${t.delete} ${index + 1}`}
                      onClick={() =>
                        setEnvironmentVariables((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      variant="danger"
                    />
                  </div>
                ))}
                <Button
                  className="mcp-add-row"
                  disabled={busy}
                  onClick={() =>
                    setEnvironmentVariables((current) => [...current, ""])
                  }
                >
                  + {t.addEnvironmentVariable}
                </Button>
              </div>
            </ManagementCard>
            <ManagementCard className="mcp-editor-card">
              <TextField
                disabled={busy}
                label={t.workspace}
                onValueChange={setWorkspace}
                value={workspace}
              />
            </ManagementCard>
            <ManagementCard
              className="mcp-editor-card"
              tone={mcpFullAccess ? "danger" : "warning"}
            >
              <strong>{t.mcpSecurity}</strong>
              <Switch
                checked={mcpAllowNetwork}
                description={t.mcpAllowNetworkHint}
                disabled={busy || mcpFullAccess}
                label={t.mcpAllowNetwork}
                onCheckedChange={setMcpAllowNetwork}
              />
              <Switch
                checked={mcpFullAccess}
                disabled={busy}
                label={t.mcpFullAccess}
                onCheckedChange={(checked) => {
                  setMcpFullAccess(checked);
                  if (checked) setMcpAllowNetwork(true);
                }}
              />
              {mcpFullAccess && (
                <InlineNotice className="settings-security" tone="danger">
                  {t.mcpFullAccessHint}
                </InlineNotice>
              )}
            </ManagementCard>
          </>
        ) : (
          <ManagementCard className="mcp-editor-card">
            <TextField
              autoFocus
              disabled={busy || locksHeaderTarget}
              label={t.serverUrl}
              onValueChange={setEndpoint}
              type="url"
              value={endpoint}
            />
            <Select<"none" | "bearer" | "oauth" | "headers">
              disabled={busy}
              label={t.authentication}
              labelVisibility="visible"
              onValueChange={setAuth}
              options={[
                { value: "none", label: t.authNone },
                { value: "bearer", label: t.authBearer },
                { value: "oauth", label: t.authOAuth },
                ...(server?.config.transport === "streamable-http" &&
                server.config.auth === "headers"
                  ? ([{ value: "headers", label: t.authHeaders }] as const)
                  : []),
              ]}
              value={auth}
            />
            {auth === "bearer" && (
              <TextField
                autoComplete="off"
                disabled={busy}
                label={t.bearer}
                labelVisibility="hidden"
                onValueChange={setBearer}
                placeholder={t.bearer}
                type="password"
                value={bearer}
              />
            )}
            {auth === "oauth" && (
              <InlineNotice className="settings-security" tone="info">
                {t.oauthHint}
              </InlineNotice>
            )}
            {auth === "headers" && (
              <InlineNotice className="settings-security" tone="warning">
                {t.registryHeadersHint}
              </InlineNotice>
            )}
          </ManagementCard>
        )}
      </McpEditorFeedback>
    </McpEditorSurface>
  );
}
