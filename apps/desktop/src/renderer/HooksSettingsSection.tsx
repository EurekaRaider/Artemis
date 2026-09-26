import { useEffect, useRef, useState } from "react";
import type {
  AppLocale,
  HookCatalog,
  HookDefinition,
  HookQuery,
} from "@artemis/protocol";
import { Badge, Button, IconButton } from "@artemis/ui/actions";
import {
  Dialog,
  EmptyState,
  InlineNotice,
  LoadingState,
} from "@artemis/ui/feedback";
import { Checkbox, Select, Switch } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementRow, ManagementSection } from "@artemis/ui/management";
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
  const [reviewing, setReviewing] = useState<HookDefinition[]>([]);
  const [scope, setScope] = useState<"all" | "project">("project");
  const [filter, setFilter] = useState("all");
  const returnFocus = useRef<HTMLElement | null>(null);
  const [inspection, setInspection] = useState<
    Record<
      string,
      {
        configuration: string;
        scripts: Array<{ path: string; content: string }>;
      }
    >
  >({});
  const t = (key: HookMessageKey) => hookText(locale, key);
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
    setReviewing([]);
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
  const run = async (action: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      if (close) setReviewing([]);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const openReview = (hooks: HookDefinition[], trigger: HTMLElement) => {
    returnFocus.current = trigger;
    setScope("project");
    setError("");
    setReviewing(hooks);
  };
  const projectName = (hook: HookDefinition) =>
    projects.find(
      (project) => project.id === (hook.projectId ?? catalog?.projectId),
    )?.name ??
    hook.workspacePath ??
    catalog?.workspacePath;
  const sourceName = (hook: HookDefinition) =>
    hook.source === "project"
      ? projectName(hook)
      : hook.source === "user"
        ? t("Hooks.user")
        : (hook.sourceName ?? hook.sourceId);
  const title = (hook: HookDefinition) =>
    hook.statusMessage || hook.description || hook.event;
  const scopeName = (hook: HookDefinition) =>
    hook.scope === "all" ? t("Hooks.allProjects") : projectName(hook);
  const visible =
    catalog?.hooks.filter(
      (hook) =>
        filter === "all" || hook.status === filter || hook.source === filter,
    ) ?? [];
  const effectiveScope = reviewing.some((h) => h.source === "project")
    ? "project"
    : reviewing.every((h) => h.source === "user")
      ? "all"
      : scope;
  const canTrust =
    reviewing.length > 0 &&
    reviewing.every((h) => h.status !== "invalid") &&
    !(
      effectiveScope === "project" &&
      !projectId &&
      !initialQuery.threadId &&
      reviewing.some((h) => h.source === "plugin")
    );
  return (
    <>
      <ManagementSection
        className="settings-section hooks-section"
        title={t("Hooks.title")}
        description={t("Hooks.summary")}
        actions={
          <IconButton
            icon={<ArtemisIcon name="refresh" />}
            label={t("Hooks.refresh")}
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void run(refresh)}
          />
        }
      >
        <div className="hooks-toolbar">
          <Select
            label={t("Hooks.project")}
            labelVisibility="visible"
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
            labelVisibility="visible"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "all", label: t("Hooks.title") },
              ...(
                [
                  "pending",
                  "trusted",
                  "disabled",
                  "invalid",
                  "user",
                  "project",
                  "plugin",
                ] as const
              ).map((value) => ({ value, label: t(`Hooks.${value}`) })),
            ]}
          />
        </div>
        {error && !reviewing.length && (
          <InlineNotice tone="danger">{error}</InlineNotice>
        )}
        {!catalog && !error && <LoadingState label={t("Hooks.title")} />}
        {catalog && !visible.length && (
          <EmptyState
            className="hooks-empty"
            icon={<ArtemisIcon name="hooks" />}
            title={t("Hooks.empty")}
            description={t("Hooks.emptyHint")}
          />
        )}
        <div className="hooks-list">
          {visible.map((hook) => (
            <ManagementRow
              key={hook.id}
              className="hooks-row"
              title={title(hook)}
              description={
                <span className="hooks-row-meta">
                  {title(hook) !== hook.event && <span>{hook.event}</span>}
                  <span>
                    {hook.source === "plugin"
                      ? sourceName(hook)
                      : t(`Hooks.${hook.source}`)}
                  </span>
                  <span>{scopeName(hook)}</span>
                </span>
              }
              leading={
                <Checkbox
                  label={title(hook)}
                  labelVisibility="hidden"
                  checked={selected.some((h) => h.id === hook.id)}
                  disabled={busy || hook.status === "invalid"}
                  onCheckedChange={(checked) =>
                    setSelected((values) =>
                      checked
                        ? [...values, hook]
                        : values.filter((h) => h.id !== hook.id),
                    )
                  }
                />
              }
              actions={
                <>
                  <Badge tone="neutral">{t(`Hooks.${hook.status}`)}</Badge>
                  {(hook.status === "trusted" ||
                    hook.status === "disabled") && (
                    <Switch
                      label={title(hook)}
                      labelVisibility="hidden"
                      checked={hook.status === "trusted"}
                      disabled={busy}
                      onCheckedChange={(enabled) =>
                        void run(() =>
                          window.artemis.changeHook(
                            query,
                            hook.id,
                            enabled ? "enable" : "disable",
                          ),
                        )
                      }
                    />
                  )}
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={busy}
                    onClick={(event) => openReview([hook], event.currentTarget)}
                  >
                    {t("Hooks.review")}
                  </Button>
                </>
              }
            />
          ))}
        </div>
        {selected.length > 0 && (
          <div className="hooks-selection">
            <Button
              size="compact"
              onClick={(event) => openReview(selected, event.currentTarget)}
            >
              {t("Hooks.review")} ({selected.length})
            </Button>
          </div>
        )}
        <p className="hooks-help hooks-policy">
          <ArtemisIcon name="lock" />
          <span>{t("Hooks.skipped")}</span>
        </p>
        {!!catalog?.records.length && (
          <details className="hooks-disclosure">
            <summary>
              {t("Hooks.history")} <span>{catalog.records.length}</span>
            </summary>
            <div className="hooks-history">
              {catalog.records
                .slice()
                .reverse()
                .map((record) => (
                  <details key={record.id} className="hooks-run">
                    <summary>
                      <span>{record.event}</span>
                      <span>{t(`Hooks.${record.status}`)}</span>
                      <time>
                        {new Date(record.startedAt).toLocaleString(locale)}
                      </time>
                    </summary>
                    <pre className="hooks-code">
                      {record.error || record.output || "—"}
                    </pre>
                  </details>
                ))}
            </div>
          </details>
        )}
      </ManagementSection>
      {reviewing.length > 0 && (
        <Dialog
          className="custom-agent-dialog hooks-dialog"
          label={t("Hooks.review")}
          open
          returnFocusRef={returnFocus}
          closeOnEscape={!busy}
          closeOnBackdrop={!busy}
          onOpenChange={(open) => {
            if (!open && !busy) setReviewing([]);
          }}
        >
          <header className="custom-agent-dialog-header">
            <div className="custom-agent-dialog-heading-copy">
              <h3>{t("Hooks.review")}</h3>
              <p>
                {reviewing.length === 1
                  ? title(reviewing[0]!)
                  : `${t("Hooks.title")} · ${reviewing.length}`}
              </p>
            </div>
            <IconButton
              icon={<ArtemisIcon name="close" />}
              label={t("Hooks.close")}
              variant="quiet"
              disabled={busy}
              onClick={() => setReviewing([])}
            />
          </header>
          <div className="custom-agent-dialog-body">
            {error && <InlineNotice tone="danger">{error}</InlineNotice>}
            {reviewing.map((hook) => (
              <section key={hook.id} className="hook-review-card">
                {reviewing.length > 1 && <h4>{title(hook)}</h4>}
                <div className="hooks-review-source">
                  <ArtemisIcon name="hooks" />
                  <span className="hooks-source-name">
                    {t(`Hooks.${hook.source}`)} · {sourceName(hook)}
                  </span>
                  <Badge tone="neutral">{t(`Hooks.${hook.status}`)}</Badge>
                </div>
                <dl className="hooks-facts">
                  <dt>{t("Hooks.event")}</dt>
                  <dd>
                    {hook.event}
                    {hook.matcher ? ` · ${hook.matcher}` : ""}
                  </dd>
                  <dt>{t("Hooks.scope")}</dt>
                  <dd>{scopeName(hook)}</dd>
                  <dt>{t("Hooks.cwd")}</dt>
                  <dd>{hook.workspacePath ?? catalog?.workspacePath}</dd>
                  <dt>{t("Hooks.timeout")}</dt>
                  <dd>{hook.timeout}</dd>
                </dl>
                <div className="hooks-command">
                  <h4>{t("Hooks.command")}</h4>
                  <pre className="hooks-code">
                    {hook.command}
                    {hook.commandWindows
                      ? `\nWindows: ${hook.commandWindows}`
                      : ""}
                  </pre>
                </div>
                {hook.event === "PermissionRequest" && (
                  <p className="hooks-capability">
                    <ArtemisIcon name="approval" />
                    {t("Hooks.permissionHook")}
                  </p>
                )}
                {hook.error && (
                  <InlineNotice tone="danger">{hook.error}</InlineNotice>
                )}
                {hook.previousHash && hook.previousHash !== hook.hash && (
                  <details className="hooks-disclosure">
                    <summary>{t("Hooks.changes")}</summary>
                    <pre className="hooks-code">
                      {hook.previousDefinition ?? hook.previousCommand}
                      {"\n→\n"}
                      {hook.command}
                    </pre>
                    <p className="hooks-help">
                      {hook.previousHash} → {hook.hash}
                    </p>
                  </details>
                )}
                <details className="hooks-disclosure">
                  <summary>{t("Hooks.files")}</summary>
                  <p className="hooks-help">{hook.sourcePath}</p>
                  <Button
                    size="compact"
                    variant="quiet"
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
                      <pre className="hooks-code">
                        {inspection[hook.id]!.configuration}
                      </pre>
                      {inspection[hook.id]!.scripts.map((script) => (
                        <div key={script.path}>
                          <h4>{script.path}</h4>
                          <pre className="hooks-code">{script.content}</pre>
                        </div>
                      ))}
                    </>
                  )}
                  <ul className="hooks-script-list">
                    {hook.scripts.map((script) => (
                      <li key={script.path}>
                        <span>{script.path}</span>
                        <code>{script.hash}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}
            <div className="hooks-permission">
              <ArtemisIcon name="lock" />
              <p>{t("Hooks.permission")}</p>
            </div>
            {reviewing.some((h) => h.source === "plugin") && (
              <Select
                label={t("Hooks.scope")}
                value={effectiveScope}
                onValueChange={(value) => setScope(value as "all" | "project")}
                options={
                  reviewing.some((h) => h.source === "project")
                    ? [{ value: "project", label: t("Hooks.project") }]
                    : [
                        { value: "project", label: t("Hooks.project") },
                        { value: "all", label: t("Hooks.allProjects") },
                      ]
                }
              />
            )}
          </div>
          <footer className="custom-agent-dialog-footer">
            {reviewing.length === 1 &&
              reviewing[0]!.status !== "pending" &&
              reviewing[0]!.status !== "invalid" && (
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        window.artemis.changeHook(
                          query,
                          reviewing[0]!.id,
                          "revoke",
                        ),
                      true,
                    )
                  }
                >
                  {t("Hooks.revoke")}
                </Button>
              )}
            <span className="hooks-footer-spacer" />
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setReviewing([])}
            >
              {t("Hooks.close")}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !canTrust}
              onClick={() =>
                void run(
                  () =>
                    window.artemis.trustHooks(
                      query,
                      reviewing.map(({ id, hash }) => ({ id, hash })),
                      effectiveScope,
                    ),
                  true,
                )
              }
            >
              {t("Hooks.trust")}
            </Button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
