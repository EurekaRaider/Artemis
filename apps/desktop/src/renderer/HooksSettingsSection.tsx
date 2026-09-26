import { useEffect, useState } from "react";
import type {
  AppLocale,
  HookCatalog,
  HookDefinition,
  HookQuery,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select } from "@artemis/ui/forms";
import { ManagementSection } from "@artemis/ui/management";
import { hookText, type HookMessageKey } from "../shared/hooks-copy.js";

export function HooksSettingsSection({
  locale,
  projects = [],
  initialQuery = {},
}: {
  locale: AppLocale;
  projects?: ReadonlyArray<{ id: string; name: string }>;
  initialQuery?: HookQuery;
}) {
  const [projectId, setProjectId] = useState(initialQuery.projectId ?? "");
  const [catalog, setCatalog] = useState<HookCatalog>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<HookDefinition[]>([]);
  const [scope, setScope] = useState<"all" | "project">("project");
  const [filter, setFilter] = useState("all");
  const [inspection, setInspection] = useState<
    Record<
      string,
      {
        configuration: string;
        scripts: Array<{ path: string; content: string }>;
      }
    >
  >({});
  const query: HookQuery = {
    ...(projectId ? { projectId } : {}),
    ...(initialQuery.threadId && projectId === (initialQuery.projectId ?? "")
      ? { threadId: initialQuery.threadId }
      : {}),
    ...(initialQuery.pluginId ? { pluginId: initialQuery.pluginId } : {}),
  };
  const refresh = async () => {
    setCatalog(await window.artemis.listHooks(query));
    setSelected([]);
    setInspection({});
  };
  useEffect(() => {
    let alive = true;
    setCatalog(undefined);
    setSelected([]);
    setInspection({});
    window.artemis
      .listHooks(query)
      .then((value) => {
        if (alive) {
          setCatalog(value);
          setError("");
        }
      })
      .catch((reason) => {
        if (alive) setError(String(reason));
      });
    return () => {
      alive = false;
    };
  }, [projectId, initialQuery.threadId, initialQuery.pluginId]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const t = (key: HookMessageKey) => hookText(locale, key);
  return (
    <ManagementSection title={t("Hooks.title")}>
      <p>{t("Hooks.skipped")}</p>
      <Select
        label={t("Hooks.project")}
        value={projectId}
        onValueChange={setProjectId}
        options={[
          { value: "", label: t("Hooks.allProjects") },
          ...projects.map((project) => ({
            value: project.id,
            label: project.name,
          })),
        ]}
      />
      <Select
        label={t("Hooks.filter")}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: "all", label: t("Hooks.title") },
          ...(["pending", "trusted", "disabled", "invalid"] as const).map(
            (value) => ({ value, label: t(`Hooks.${value}`) }),
          ),
          ...(["user", "project", "plugin"] as const).map((value) => ({
            value,
            label: t(`Hooks.${value}`),
          })),
        ]}
      />
      <Button disabled={busy} onClick={() => void run(refresh)}>
        {t("Hooks.refresh")}
      </Button>
      {error && <p role="alert">{error}</p>}
      {catalog && !catalog.hooks.length && <p>{t("Hooks.empty")}</p>}
      <p>{t("Hooks.select")}</p>
      {catalog?.hooks
        .filter(
          (hook) =>
            filter === "all" ||
            hook.status === filter ||
            hook.source === filter,
        )
        .map((hook) => (
          <article key={hook.id} className="hook-review-card">
            <Checkbox
              checked={selected.some((value) => value.id === hook.id)}
              disabled={busy || hook.status === "invalid"}
              onCheckedChange={(checked) =>
                setSelected((values) =>
                  checked
                    ? [...values, hook]
                    : values.filter((value) => value.id !== hook.id),
                )
              }
              label={`${hook.event} · ${hook.statusMessage ?? hook.description ?? hook.sourceId}`}
            />
            <p>
              {t("Hooks.source")}: {t(`Hooks.${hook.source}`)} ·{" "}
              {projects.find((project) => project.id === hook.sourceId)?.name ??
                hook.sourceId}{" "}
              · {t(`Hooks.${hook.status}`)}
            </p>
            <p>{hook.description}</p>
            <dl>
              <dt>{t("Hooks.event")}</dt>
              <dd>
                {hook.event} {hook.matcher || "*"}
              </dd>
              <dt>{t("Hooks.command")}</dt>
              <dd>
                <pre>
                  {hook.command}
                  {hook.commandWindows
                    ? `\nWindows: ${hook.commandWindows}`
                    : ""}
                </pre>
              </dd>
              <dt>{t("Hooks.scope")}</dt>
              <dd>
                {hook.scope === "all"
                  ? t("Hooks.allProjects")
                  : (projects.find(
                      (project) =>
                        project.id === (hook.projectId ?? catalog.projectId),
                    )?.name ??
                    hook.workspacePath ??
                    catalog.workspacePath)}
              </dd>
              <dt>cwd</dt>
              <dd>{hook.workspacePath ?? catalog.workspacePath}</dd>
              <dt>{t("Hooks.timeout")}</dt>
              <dd>{hook.timeout}</dd>
            </dl>
            {hook.event === "PermissionRequest" && (
              <p role="note">{t("Hooks.permissionHook")}</p>
            )}
            {hook.previousHash && hook.previousHash !== hook.hash && (
              <details>
                <summary>{t("Hooks.changes")}</summary>
                <pre>
                  {hook.previousDefinition ?? hook.previousCommand}
                  {"\n→\n"}
                  {hook.command}
                </pre>
                <p>
                  {hook.previousHash} → {hook.hash}
                </p>
              </details>
            )}
            {hook.error && <p role="alert">{hook.error}</p>}
            <details>
              <summary>{t("Hooks.files")}</summary>
              <p>{hook.sourcePath}</p>
              <ul>
                {hook.scripts.map((script) => (
                  <li key={script.path}>
                    {script.path} <code>{script.hash}</code>
                  </li>
                ))}
              </ul>
              <Button
                disabled={busy}
                onClick={() => {
                  void window.artemis
                    .inspectHook(query, hook.id)
                    .then((value) =>
                      setInspection((current) => ({
                        ...current,
                        [hook.id]: value,
                      })),
                    )
                    .catch((reason) => setError(String(reason)));
                }}
              >
                {t("Hooks.inspect")}
              </Button>
              {inspection[hook.id] && (
                <>
                  <pre>{inspection[hook.id]!.configuration}</pre>
                  {inspection[hook.id]!.scripts.map((script) => (
                    <details key={script.path}>
                      <summary>{script.path}</summary>
                      <pre>{script.content}</pre>
                    </details>
                  ))}
                </>
              )}
            </details>
            {hook.previousHash === hook.hash && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.artemis.changeHook(
                      query,
                      hook.id,
                      hook.status === "trusted" ? "disable" : "enable",
                    ),
                  )
                }
              >
                {t(
                  hook.status === "trusted" ? "Hooks.disable" : "Hooks.enable",
                )}
              </Button>
            )}
            {hook.previousHash && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.artemis.changeHook(query, hook.id, "revoke"),
                  )
                }
              >
                {t("Hooks.revoke")}
              </Button>
            )}
          </article>
        ))}
      {!!selected.length && (
        <div className="hook-review-card">
          <p>{t("Hooks.permission")}</p>
          <Select
            label={t("Hooks.scope")}
            value={selected.every((h) => h.source === "user") ? "all" : scope}
            onValueChange={(value) => setScope(value as "all" | "project")}
            options={
              selected.some((h) => h.source === "project")
                ? [{ value: "project", label: t("Hooks.project") }]
                : [
                    { value: "project", label: t("Hooks.project") },
                    { value: "all", label: t("Hooks.allProjects") },
                  ]
            }
          />
          <Button
            disabled={
              busy ||
              (!projectId &&
                !initialQuery.threadId &&
                selected.some((h) => h.source === "plugin") &&
                scope === "project")
            }
            onClick={() =>
              void run(() =>
                window.artemis.trustHooks(
                  query,
                  selected.map(({ id, hash }) => ({ id, hash })),
                  selected.some((h) => h.source === "project")
                    ? "project"
                    : selected.every((h) => h.source === "user")
                      ? "all"
                      : scope,
                ),
              )
            }
          >
            {t("Hooks.trust")} ({selected.length})
          </Button>
        </div>
      )}
      <details>
        <summary>{t("Hooks.history")}</summary>
        {catalog?.records
          .slice()
          .reverse()
          .map((record) => (
            <article key={record.id}>
              <p>
                {record.event} · {t(`Hooks.${record.status}`)} ·{" "}
                {record.startedAt} · {record.durationMs} ms
              </p>
              <pre>{record.error ?? record.output}</pre>
            </article>
          ))}
      </details>
    </ManagementSection>
  );
}
