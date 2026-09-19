import { useCallback, useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { TextField } from "@artemis/ui/forms";
import { Dialog, EmptyState, InlineNotice } from "@artemis/ui/feedback";
import { ManagementHeader } from "@artemis/ui/management";
import { ArtemisIcon } from "@artemis/ui/icons";
import type {
  ConnectorConnection,
  ConnectorCatalogEntry,
} from "../shared/connectors.js";
import { localizedPluginText } from "../shared/plugin-localization.js";
import { connectorCopy } from "../shared/connector-copy.js";
import type { InstalledCodexPlugin } from "../shared/api.js";
import { uiText } from "../shared/ui-text.js";
import { ResourceAvatar } from "./resource-icons.js";
export function PluginConnectionDialog({
  plugin,
  closeLabel,
  onClose,
  locale,
  onChanged,
}: {
  plugin: Pick<
    InstalledCodexPlugin,
    | "id"
    | "name"
    | "displayName"
    | "localizations"
    | "mcpServerIds"
    | "iconDataUrl"
    | "brandColor"
  >;
  closeLabel: string;
  onClose(): void;
  locale: AppLocale;
  onChanged(): Promise<void>;
}) {
  const [definitions, setDefinitions] = useState<ConnectorCatalogEntry[]>([]);
  const [connections, setConnections] = useState<ConnectorConnection[]>([]);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const mounted = useRef(true);
  const authorizing = useRef(new Set<string>());
  const copy = connectorCopy(locale);
  const displayName = localizedPluginText(plugin, locale).displayName;
  const refresh = useCallback(async () => {
    const [d, c] = await Promise.all([
      window.artemis.listConnectorDefinitions(),
      window.artemis.listConnectorConnections(),
    ]);
    if (mounted.current) {
      setDefinitions(
        d.filter(
          (definition) =>
            definition.installed &&
            plugin.mcpServerIds.includes(definition.serverId),
        ),
      );
      setConnections(c);
    }
  }, [plugin.mcpServerIds]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => {
      if (mounted.current) setError(String(e));
    });
    return () => {
      mounted.current = false;
      for (const id of authorizing.current)
        void window.artemis.cancelConnectorAuthorization(id).catch(() => {});
    };
  }, [refresh]);
  useEffect(() => {
    if (!pending && !connections.some((c) => c.state === "connecting")) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch {
        /* Keep the last state during a transient IPC error. */
      }
      if (active) timeout = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [pending, connections.some((c) => c.state === "connecting"), refresh]);
  async function run(
    id: string,
    action: "connect" | "disconnect" | "reconnect",
  ) {
    setPending(id);
    if (action !== "disconnect") authorizing.current.add(id);
    setError(undefined);
    const appPassword = password;
    setPassword("");
    try {
      if (action === "disconnect") await window.artemis.disconnectConnector(id);
      else if (action === "reconnect")
        await window.artemis.reconnectConnector(id);
      else
        await window.artemis.connectConnector({
          serverId: id,
          email: email.trim(),
          appPassword,
        });
      await onChanged();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      authorizing.current.delete(id);
      if (mounted.current) {
        setPending(undefined);
        await refresh().catch(() => {});
      }
    }
  }
  return (
    <Dialog
      className="plugin-connection-dialog"
      open
      label={displayName}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <section>
        <ManagementHeader
          className="plugin-dialog-header"
          headingLevel={2}
          title={displayName}
          description={uiText(
            locale,
            "ResourceCenter_labels.connectionManagement",
          )}
          leading={
            <ResourceAvatar
              kind="plugin"
              name={plugin.name}
              iconDataUrl={plugin.iconDataUrl}
              brandColor={plugin.brandColor}
            />
          }
          actions={
            <IconButton
              icon={<ArtemisIcon name="close" />}
              label={closeLabel}
              variant="quiet"
              onClick={onClose}
            />
          }
        />
        <div className="resource-management-list">
          {error && <InlineNotice tone="warning">{error}</InlineNotice>}
          {!definitions.length && <EmptyState title={copy.empty} />}
          {definitions.map((d) => {
            const connection = connections.find((c) => c.id === d.serverId);
            const busy =
              pending === d.serverId || connection?.state === "connecting";
            const state = connection?.state ?? "disconnected";
            return (
              <section key={d.serverId} className="plugin-connection-entry">
                <div>
                  <div className="plugin-connection-account-heading">
                    <span>
                      {definitions.length > 1
                        ? d.displayName
                        : uiText(
                            locale,
                            "ResourceCenter_labels.currentAccount",
                          )}
                    </span>
                    <span
                      className="plugin-connection-state"
                      data-state={state}
                      role="status"
                    >
                      {copy.states[state]}
                    </span>
                  </div>
                  {connection?.account && (
                    <p className="plugin-connection-account">
                      {connection.account}
                    </p>
                  )}
                  {d.capabilities?.length ? (
                    <div className="plugin-connection-capabilities">
                      <span>
                        {uiText(locale, "ResourceCenter_labels.capabilities")}
                      </span>
                      <p>
                        {d.capabilities
                          .map((capability) => copy.capabilities[capability])
                          .join(" · ")}
                      </p>
                    </div>
                  ) : null}
                  {d.provider === "figma" && <p>{copy.figma}</p>}
                  {d.provider === "qq" && state !== "connected" && (
                    <div className="resource-connector-settings">
                      <ol className="resource-connector-guide">
                        {copy.qq.split("\n").map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                      <div className="resource-connector-guide-links">
                        <a
                          href="https://mail.qq.com"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {copy.qqOpen} ↗
                        </a>
                        <a
                          href="https://service.mail.qq.com/detail/0/1087"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {copy.qqHelp} ↗
                        </a>
                      </div>
                      <TextField
                        label={copy.email}
                        value={email}
                        onValueChange={setEmail}
                        type="email"
                        placeholder="123456789@qq.com"
                        autoComplete="email"
                        spellCheck={false}
                        disabled={!!pending}
                      />
                      <TextField
                        label={copy.code}
                        value={password}
                        onValueChange={(value) =>
                          setPassword(value.replace(/\s/g, ""))
                        }
                        type="password"
                        autoComplete="off"
                        disabled={!!pending}
                      />
                    </div>
                  )}
                  {connection?.userCode && (
                    <div>
                      <code>{connection.userCode}</code>
                      <Button
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            connection.userCode!,
                          )
                        }
                      >
                        {copy.copy}
                      </Button>
                    </div>
                  )}
                  {connection?.error && (
                    <InlineNotice tone="warning">
                      {connection.error}
                    </InlineNotice>
                  )}
                </div>
                <div className="plugin-dialog-footer plugin-connection-actions">
                  {busy ? (
                    <Button
                      onClick={() =>
                        void window.artemis
                          .cancelConnectorAuthorization(d.serverId)
                          .catch((e) => setError(String(e)))
                      }
                    >
                      {copy.cancel}
                    </Button>
                  ) : state === "connected" ? (
                    <>
                      <Button
                        className="plugin-dialog-disconnect"
                        icon={<ArtemisIcon name="unlink" />}
                        disabled={!!pending}
                        variant="quiet"
                        onClick={() => void run(d.serverId, "disconnect")}
                      >
                        {copy.disconnect}
                      </Button>
                      <Button
                        className="plugin-dialog-reconnect"
                        icon={<ArtemisIcon name="refresh" />}
                        disabled={!!pending}
                        onClick={() => void run(d.serverId, "reconnect")}
                      >
                        {copy.reconnect}
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={
                        !!pending ||
                        (d.provider === "qq" &&
                          (!email.trim() || !password.trim()))
                      }
                      onClick={() => void run(d.serverId, "connect")}
                    >
                      {copy.connect}
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </Dialog>
  );
}
