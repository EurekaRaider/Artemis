import { useState } from "react";

import type {
  McpServerConfig,
  McpServerStatus,
  SettingsSnapshot,
} from "../shared/api.js";
import { CodexSelect } from "./CodexSelect.js";

interface McpServerEditorProps {
  existingServers: readonly McpServerStatus[];
  locale: "en" | "zh-CN";
  server?: McpServerStatus;
  onCancel(): void;
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
    bearer: "Bearer token (optional, encrypted)",
    oauthHint:
      "Authorization opens your browser and stores tokens with OS encryption.",
    mcpFullAccessHint:
      "Local stdio MCP always has full local access and network access.",
    saveServer: "Save and connect",
    uninstall: "Uninstall",
    cancel: "Back to MCP servers",
    delete: "Delete",
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
    bearer: "Bearer Token（可选，加密保存）",
    oauthHint: "授权将在浏览器中完成，Token 由操作系统加密保存。",
    mcpFullAccessHint: "本地 stdio MCP 始终拥有完整本机访问权限并可联网。",
    saveServer: "保存并连接",
    uninstall: "卸载",
    cancel: "返回 MCP 服务器",
    delete: "删除",
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

export function McpServerEditor({
  existingServers,
  locale,
  server,
  onCancel,
  onRemoved,
  onSaved,
}: McpServerEditorProps) {
  const t = labels[locale];
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
  const [auth, setAuth] = useState<"none" | "bearer" | "oauth">(
    server?.config.transport === "streamable-http"
      ? (server.config.auth ?? "none")
      : "none",
  );
  const [bearer, setBearer] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
        workspacePath: workspace,
        allowNetwork: true,
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
      };
    }
    onSaved(
      await window.artemis.saveMcpServer(
        config,
        auth === "bearer" ? bearer || undefined : undefined,
      ),
    );
  }

  return (
    <section className="settings-section resource-standalone-editor mcp-editor">
      <header className="mcp-editor-header">
        <div>
          <button
            className="text-button mcp-editor-back"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            ← {t.cancel}
          </button>
          <h1>
            {server
              ? t.updateMcp.replace("{name}", server.config.name)
              : t.addMcp}
          </h1>
          <p className="settings-security">
            {server ? t.transportChangeHint : t.newServerHint}
          </p>
        </div>
        {server && (
          <button
            className="mcp-uninstall"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onRemoved(
                  await window.artemis.removeMcpServer(server.config.id),
                );
              })
            }
            type="button"
          >
            {t.uninstall}
          </button>
        )}
      </header>

      {transport === "stdio" ? (
        <>
          <div className="mcp-editor-card">
            <label>
              <strong>{t.launchCommand}</strong>
              <input
                aria-label={t.launchCommand}
                autoFocus
                disabled={busy}
                onChange={(event) => setEndpoint(event.target.value)}
                value={endpoint}
              />
            </label>
          </div>
          <div className="mcp-editor-card">
            <strong>{t.arguments}</strong>
            <div className="mcp-dynamic-list">
              {argumentsList.map((argument, index) => (
                <div className="mcp-argument-row" key={`argument-${index}`}>
                  <input
                    aria-label={`${t.arguments} ${index + 1}`}
                    disabled={busy}
                    onChange={(event) =>
                      setArgumentsList((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                    value={argument}
                  />
                  <button
                    aria-label={t.delete}
                    className="mcp-remove-row"
                    disabled={busy}
                    onClick={() =>
                      setArgumentsList((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="mcp-add-row"
                disabled={busy}
                onClick={() => setArgumentsList((current) => [...current, ""])}
                type="button"
              >
                + {t.addArgument}
              </button>
            </div>
          </div>
          <div className="mcp-editor-card">
            <strong>{t.environmentVariables}</strong>
            <div className="mcp-dynamic-list">
              {environment.map((entry, index) => (
                <div
                  className="mcp-environment-row"
                  key={`environment-${index}`}
                >
                  <input
                    aria-label={`${t.environmentKey} ${index + 1}`}
                    disabled={busy}
                    onChange={(event) =>
                      setEnvironment((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, key: event.target.value }
                            : value,
                        ),
                      )
                    }
                    placeholder={t.environmentKey}
                    value={entry.key}
                  />
                  <input
                    aria-label={`${t.environmentValue} ${index + 1}`}
                    disabled={busy}
                    onChange={(event) =>
                      setEnvironment((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index
                            ? { ...value, value: event.target.value }
                            : value,
                        ),
                      )
                    }
                    placeholder={t.environmentValue}
                    value={entry.value}
                  />
                  <button
                    aria-label={t.delete}
                    className="mcp-remove-row"
                    disabled={busy}
                    onClick={() =>
                      setEnvironment((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="mcp-add-row"
                disabled={busy}
                onClick={() =>
                  setEnvironment((current) => [
                    ...current,
                    { key: "", value: "" },
                  ])
                }
                type="button"
              >
                + {t.addEnvironment}
              </button>
            </div>
          </div>
          <div className="mcp-editor-card">
            <strong>{t.environmentVariablePassthrough}</strong>
            <div className="mcp-dynamic-list">
              {environmentVariables.map((name, index) => (
                <div
                  className="mcp-argument-row"
                  key={`environment-variable-${index}`}
                >
                  <input
                    aria-label={`${t.environmentVariableName} ${index + 1}`}
                    disabled={busy}
                    onChange={(event) =>
                      setEnvironmentVariables((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                    placeholder={t.environmentVariableName}
                    value={name}
                  />
                  <button
                    aria-label={t.delete}
                    className="mcp-remove-row"
                    disabled={busy}
                    onClick={() =>
                      setEnvironmentVariables((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="mcp-add-row"
                disabled={busy}
                onClick={() =>
                  setEnvironmentVariables((current) => [...current, ""])
                }
                type="button"
              >
                + {t.addEnvironmentVariable}
              </button>
            </div>
          </div>
          <div className="mcp-editor-card">
            <label>
              <strong>{t.workspace}</strong>
              <input
                aria-label={t.workspace}
                disabled={busy}
                onChange={(event) => setWorkspace(event.target.value)}
                value={workspace}
              />
            </label>
            <p className="settings-security">{t.mcpFullAccessHint}</p>
          </div>
        </>
      ) : (
        <div className="mcp-editor-card">
          <label>
            <strong>{t.serverUrl}</strong>
            <input
              aria-label={t.serverUrl}
              autoFocus
              disabled={busy}
              onChange={(event) => setEndpoint(event.target.value)}
              type="url"
              value={endpoint}
            />
          </label>
          <label>
            <strong>{t.authentication}</strong>
            <div className="settings-codex-select">
              <CodexSelect<"none" | "bearer" | "oauth">
                ariaLabel={t.authentication}
                disabled={busy}
                onChange={setAuth}
                options={[
                  { value: "none", label: t.authNone },
                  { value: "bearer", label: t.authBearer },
                  { value: "oauth", label: t.authOAuth },
                ]}
                value={auth}
              />
            </div>
          </label>
          {auth === "bearer" && (
            <input
              aria-label={t.bearer}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setBearer(event.target.value)}
              placeholder={t.bearer}
              type="password"
              value={bearer}
            />
          )}
          {auth === "oauth" && (
            <span className="settings-security">{t.oauthHint}</span>
          )}
        </div>
      )}

      {message && <p className="catalog-message error">{message}</p>}
      <button
        className="mcp-editor-save"
        disabled={busy || !endpoint.trim()}
        onClick={() => void run(save)}
        type="button"
      >
        {t.saveServer}
      </button>
    </section>
  );
}
