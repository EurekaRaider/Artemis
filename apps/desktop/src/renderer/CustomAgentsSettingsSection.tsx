/**
 * Custom sub-agent management section for Settings → Agent configuration
 * (D#152 PR4). The list stays mounted in the tab; creating or editing opens
 * a controlled overlay Dialog (issue #193) so attention stays on the
 * definition being edited. Dedicated instructions are fetched only for the
 * editor; the list works from catalog metadata.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AppLocale } from "@artemis/protocol";
import {
  CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS,
  CUSTOM_AGENT_CATALOG_TEXT_BUDGET,
  checkCatalogBudget,
} from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Dialog, EmptyState, InlineNotice } from "@artemis/ui/feedback";
import {
  Checkbox,
  Select,
  Switch,
  TextAreaField,
  TextField,
} from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementRow, ManagementSection } from "@artemis/ui/management";

import type {
  CustomAgentSummary,
  SaveCustomAgentInput,
  SettingsSnapshot,
} from "../shared/api.js";
import { legacyLocale } from "../shared/locales.js";
import { customAgentColorToken } from "./CustomAgentMention.js";

const BUILTIN_TOOL_CHOICES = [
  { toolId: "read", capability: "business-read" },
  { toolId: "web_search", capability: "business-read" },
  { toolId: "attachment_list", capability: "business-read" },
  { toolId: "attachment_read", capability: "business-read" },
  { toolId: "attachment_search", capability: "business-read" },
  { toolId: "load_workspace_dependencies", capability: "business-read" },
  { toolId: "remote_read", capability: "business-read" },
  { toolId: "remote_write", capability: "filesystem-write" },
  { toolId: "shell_wait", capability: "shell" },
  { toolId: "shell", capability: "shell" },
  { toolId: "write", capability: "filesystem-write" },
  { toolId: "office_document", capability: "filesystem-write" },
] as const;

const COLOR_TOKENS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

const labels = {
  en: {
    title: "Custom sub-agents",
    hint: "Reusable specialist roles you can invoke with @ in the composer. Definitions are stored locally and can be scoped to selected projects.",
    count: "{count} item(s)",
    add: "New sub-agent",
    edit: "Edit",
    delete: "Delete",
    confirmDelete: "Delete?",
    cancelDelete: "Cancel",
    empty: "No custom sub-agents yet",
    emptyHint:
      "Create a specialist role once, then invoke it with @ in the composer.",
    closeDialog: "Close",
    dirtyWarning: "You have unsaved changes",
    keepEditing: "Keep editing",
    discardChanges: "Discard changes",
    sectionIdentity: "Identity",
    sectionModel: "Model",
    sectionReasoning: "Reasoning effort",
    sectionTools: "Tools",
    sectionDispatch: "Dispatch & scope",
    editorEditTitle: "Edit: {name}",
    editorHint:
      "Fill in the name, tools, and dedicated prompt; saving returns to the list.",
    name: "Identity name",
    nameRequired: "Name is required",
    description: "Description",
    color: "Color",
    instructions: "Dedicated prompt",
    instructionsRequired: "The dedicated prompt is required",
    instructionsHint:
      "Appended to the child agent's system prompt; never overrides Artemis identity, mode, or team rules.",
    scope: "Project scope",
    scopeAll: "All projects",
    scopeSelected: "Selected projects",
    scopeHint:
      "Selected scope with no projects applies nowhere — pick at least one project.",
    projects: "Projects",
    modelPolicy: "Model",
    modelInherit: "Inherit from parent session",
    modelFixed: "Fixed model",
    thinkingPolicy: "Reasoning effort",
    thinkingInherit: "Inherit from parent session",
    thinkingFixed: "Fixed level",
    toolPolicy: "Tools",
    toolInherit: "Inherit all tools by default",
    toolAllowlist: "Choose available tools",
    builtinTools: "Built-in tools",
    mcpTools: "MCP servers",
    mcpToolsCount: "{count} tools",
    enabledLabel: "Enabled",
    allowAutomatic: "Allow automatic invocation",
    allowAutomaticHint:
      "When off, this sub-agent only runs on explicit @ invocation.",
    triggers: "Trigger phrases",
    triggersHint:
      "Comma-separated. When a conversation mentions one of these phrases, this sub-agent becomes an automatic-invocation candidate; with automatic invocation off, only explicit @ uses it.",
    save: "Save sub-agent",
    cancelEdit: "Cancel",
    revisionConflict:
      "This definition was edited elsewhere. The latest version is loaded — review and save again.",
    capabilityPreview: "Effective tools ({mode} mode)",
    scopeBadgeAll: "All projects",
    scopeBadgeSelected: "{count} project(s)",
    disabledBadge: "Disabled",
    automaticBadge: "Auto",
    manualBadge: "Manual only",
    modelBadgeInherit: "Inherit",
    toolBadgeInherit: "Baseline",
    toolBadgeCount: "{count} tools",
    automaticBudgetExceeded:
      "Automatic routing is paused for over-budget turns: {count} sub-agents allow automatic invocation, exceeding the per-turn catalog budget ({max} definitions / {chars} characters). Turn off automatic invocation on some definitions to re-enable routing.",
  },
  "zh-CN": {
    title: "自定义子智能体",
    hint: "可在输入框用 @ 调用的专业角色，定义保存在本地，可限定到指定项目。",
    count: "{count} 项",
    add: "新建子智能体",
    edit: "编辑",
    delete: "删除",
    confirmDelete: "确认删除？",
    cancelDelete: "取消",
    empty: "还没有自定义子智能体",
    emptyHint: "创建一次专业角色，之后在输入框用 @ 调用。",
    closeDialog: "关闭",
    dirtyWarning: "有未保存的修改",
    keepEditing: "继续编辑",
    discardChanges: "放弃修改",
    sectionIdentity: "身份",
    sectionModel: "模型",
    sectionReasoning: "推理强度",
    sectionTools: "工具",
    sectionDispatch: "调度与范围",
    editorEditTitle: "编辑：{name}",
    editorHint: "填写名称、工具与专用提示词，保存后返回列表。",
    name: "身份名称",
    nameRequired: "请填写名称",
    description: "描述",
    color: "颜色",
    instructions: "专用提示词",
    instructionsRequired: "请填写专用提示词",
    instructionsHint:
      "追加到子智能体系统提示的受控位置，不会覆盖 Artemis 身份、模式约束与团队协议。",
    scope: "项目范围",
    scopeAll: "全部项目",
    scopeSelected: "指定项目",
    scopeHint: "指定项目但不选择任何项目时，该定义对任何项目都不生效。",
    projects: "项目",
    modelPolicy: "模型",
    modelInherit: "继承父会话",
    modelFixed: "固定模型",
    thinkingPolicy: "推理强度",
    thinkingInherit: "继承父会话",
    thinkingFixed: "固定档位",
    toolPolicy: "工具",
    toolInherit: "默认继承所有工具",
    toolAllowlist: "指定可用工具",
    builtinTools: "内置工具",
    mcpTools: "MCP 服务器",
    mcpToolsCount: "{count} 个工具",
    enabledLabel: "启用",
    allowAutomatic: "允许自动调用",
    allowAutomaticHint: "关闭后，该子智能体只能通过 @ 显式调用。",
    triggers: "触发词",
    triggersHint:
      "逗号分隔。对话中出现这些词语时，该子智能体会进入自动调用候选；关闭自动调用后，只有 @ 显式调用会使用它。",
    save: "保存子智能体",
    cancelEdit: "取消",
    revisionConflict:
      "该定义已在其他地方被修改，已载入最新版本，请确认后重新保存。",
    capabilityPreview: "实际可用工具（{mode} 模式）",
    scopeBadgeAll: "全部项目",
    scopeBadgeSelected: "{count} 个项目",
    disabledBadge: "已停用",
    automaticBadge: "自动",
    manualBadge: "仅手动",
    modelBadgeInherit: "继承",
    toolBadgeInherit: "基线",
    toolBadgeCount: "{count} 个工具",
    automaticBudgetExceeded:
      "已启用自动调用的子智能体达 {count} 个，超出单轮目录预算（{max} 个定义 / {chars} 字符文本），超预算的轮次将停用自动路由。请关闭部分定义的自动调用以恢复路由。",
  },
} as const;

interface CustomAgentFormState {
  name: string;
  description: string;
  color: string;
  enabled: boolean;
  instructions: string;
  scope: "all" | "selected";
  projectIds: string[];
  modelKind: "inherit" | "fixed";
  modelProviderId: string;
  modelId: string;
  thinkingKind: "inherit" | "fixed";
  thinkingLevel: string;
  toolKind: "inherit" | "allowlist";
  builtinToolIds: string[];
  mcpToolRefs: Array<{ serverId: string; toolName: string }>;
  allowAutomaticInvocation: boolean;
  triggersText: string;
}

const EMPTY_FORM: CustomAgentFormState = {
  name: "",
  description: "",
  color: "gray",
  enabled: true,
  instructions: "",
  scope: "all",
  projectIds: [],
  modelKind: "inherit",
  modelProviderId: "",
  modelId: "",
  thinkingKind: "inherit",
  thinkingLevel: "medium",
  toolKind: "inherit",
  builtinToolIds: [],
  mcpToolRefs: [],
  allowAutomaticInvocation: false,
  triggersText: "",
};

function formToInput(form: CustomAgentFormState): SaveCustomAgentInput {
  return {
    name: form.name,
    description: form.description,
    color: form.color,
    enabled: form.enabled,
    instructions: form.instructions,
    scope: form.scope,
    projectIds: form.scope === "selected" ? form.projectIds : [],
    modelPolicy:
      form.modelKind === "fixed"
        ? {
            kind: "fixed",
            providerId: form.modelProviderId,
            modelId: form.modelId,
          }
        : { kind: "inherit" },
    thinkingPolicy:
      form.thinkingKind === "fixed"
        ? { kind: "fixed", level: form.thinkingLevel }
        : { kind: "inherit" },
    toolPolicy:
      form.toolKind === "allowlist"
        ? {
            kind: "allowlist",
            tools: [
              ...form.builtinToolIds.map(
                (toolId) => ({ kind: "builtin", toolId }) as const,
              ),
              ...form.mcpToolRefs.map(
                (ref) =>
                  ({
                    kind: "mcp",
                    serverId: ref.serverId,
                    toolName: ref.toolName,
                  }) as const,
              ),
            ],
          }
        : { kind: "inherit" },
    allowAutomaticInvocation: form.allowAutomaticInvocation,
    triggers: form.triggersText
      .split(/[,，]/)
      .map((trigger) => trigger.trim())
      .filter((trigger) => trigger.length > 0),
  };
}

export function CustomAgentsSettingsSection({
  settings,
  busy,
  locale,
  projects,
  setBusy,
  applySettings,
}: {
  settings: SettingsSnapshot;
  busy: boolean;
  locale: AppLocale;
  projects: ReadonlyArray<{ id: string; name: string }>;
  setBusy(busy: boolean): void;
  applySettings(snapshot: SettingsSnapshot): void;
}) {
  const t = labels[legacyLocale(locale)];
  const nameInputRef = useRef<HTMLInputElement>(null);
  const baselineRef = useRef("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingRevision, setEditingRevision] = useState<number>(0);
  const [form, setForm] = useState<CustomAgentFormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string>();
  const [nameError, setNameError] = useState(false);
  const [instructionsError, setInstructionsError] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string>();
  const [capabilityPreview, setCapabilityPreview] = useState<string[]>();

  // Older test fixtures (and any partial snapshot) may not carry the list
  // yet; treat it as empty rather than crashing the settings panel.
  const definitions = settings.customAgents ?? [];

  // Per-turn automatic catalog budget (D#152 PR5): the runtime disables
  // automatic routing for over-budget turns instead of silently
  // truncating, so surface that here. The enabled+automatic set is the
  // superset of every per-project catalog — if it fits, every turn fits.
  const automaticBudget = useMemo(
    () =>
      checkCatalogBudget(
        definitions
          .filter(
            (definition) =>
              definition.enabled && definition.allowAutomaticInvocation,
          )
          .map((definition) => ({
            definitionId: definition.id,
            revision: definition.revision,
            name: definition.name,
            description: definition.description,
            scope: definition.scope,
            allowAutomaticInvocation: definition.allowAutomaticInvocation,
            triggers: definition.triggers,
          })),
      ),
    [definitions],
  );

  // Effective-capability preview reuses the runtime intersection (mode:
  // execute is the widest a definition can ever get; plan/review only
  // shrink it). Refreshed as the tool policy changes.
  const toolPolicyKey = JSON.stringify({
    kind: form.toolKind,
    builtin: form.builtinToolIds,
    mcp: form.mcpToolRefs,
  });
  useEffect(() => {
    if (!formOpen) {
      setCapabilityPreview(undefined);
      return;
    }
    let cancelled = false;
    void window.artemis
      .customAgentsPreviewCapabilities(
        { toolPolicy: formToInput(form).toolPolicy },
        "execute",
      )
      .then((preview) => {
        if (!cancelled) setCapabilityPreview(preview.capabilities);
      })
      .catch(() => {
        if (!cancelled) setCapabilityPreview(undefined);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, toolPolicyKey]);

  // The model snapshot may repeat a provider/model pair (builtin plus
  // manually added) or repeat display names; the public Select contract
  // rejects duplicate values or perceptibly equal labels, which previously
  // crashed the whole dialog when a fixed policy rendered its model picker.
  // Deduplicate by value and disambiguate labels by full model id.
  const modelOptions = useMemo(() => {
    const seenValues = new Set<string>();
    const seenLabels = new Set<string>();
    const options: Array<{ value: string; label: string }> = [];
    for (const model of settings.models) {
      const value = `${model.providerId}/${model.modelId}`;
      if (seenValues.has(value)) continue;
      seenValues.add(value);
      let label = `${model.name} (${model.providerId})`;
      if (seenLabels.has(label)) label = `${model.name} (${value})`;
      seenLabels.add(label);
      options.push({ value, label });
    }
    return options;
  }, [settings.models]);

  const modelBadge = (definition: CustomAgentSummary) => {
    const policy = definition.modelPolicy;
    if (policy.kind !== "fixed") return t.modelBadgeInherit;
    const fixed = settings.models.find(
      (model) =>
        model.providerId === policy.providerId &&
        model.modelId === policy.modelId,
    );
    return fixed ? fixed.name : policy.modelId;
  };

  const toolBadge = (definition: CustomAgentSummary) =>
    definition.toolPolicy.kind === "inherit"
      ? t.toolBadgeInherit
      : t.toolBadgeCount.replace(
          "{count}",
          String(definition.toolPolicy.tools.length),
        );

  const closeEditor = () => {
    setFormOpen(false);
    setEditingId(null);
    setError(undefined);
    setConfirmDiscard(false);
    setNameError(false);
    setInstructionsError(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingName("");
    setEditingRevision(0);
    setForm(EMPTY_FORM);
    baselineRef.current = JSON.stringify(EMPTY_FORM);
    setError(undefined);
    setConfirmDiscard(false);
    setFormOpen(true);
  };

  const openEdit = async (summary: CustomAgentSummary) => {
    setBusy(true);
    setError(undefined);
    try {
      // The editor is the single renderer surface allowed to read
      // dedicated instructions.
      const definition = await window.artemis.customAgentsGet(summary.id);
      if (!definition) {
        setError("CUSTOM_AGENT_NOT_FOUND");
        return;
      }
      setEditingId(definition.id);
      setEditingName(definition.name);
      setEditingRevision(definition.revision);
      const nextForm: CustomAgentFormState = {
        name: definition.name,
        description: definition.description,
        color: definition.color,
        enabled: definition.enabled,
        instructions: definition.instructions,
        scope: definition.scope,
        projectIds: summary.projectIds,
        modelKind: definition.modelPolicy.kind,
        modelProviderId:
          definition.modelPolicy.kind === "fixed"
            ? definition.modelPolicy.providerId
            : "",
        modelId:
          definition.modelPolicy.kind === "fixed"
            ? definition.modelPolicy.modelId
            : "",
        thinkingKind: definition.thinkingPolicy.kind,
        thinkingLevel:
          definition.thinkingPolicy.kind === "fixed"
            ? definition.thinkingPolicy.level
            : "medium",
        toolKind: definition.toolPolicy.kind,
        builtinToolIds:
          definition.toolPolicy.kind === "allowlist"
            ? definition.toolPolicy.tools
                .filter((ref) => ref.kind === "builtin")
                .map((ref) => (ref as { toolId: string }).toolId)
            : [],
        mcpToolRefs:
          definition.toolPolicy.kind === "allowlist"
            ? definition.toolPolicy.tools
                .filter((ref) => ref.kind === "mcp")
                .map((ref) => {
                  const mcp = ref as { serverId: string; toolName: string };
                  return { serverId: mcp.serverId, toolName: mcp.toolName };
                })
            : [],
        allowAutomaticInvocation: definition.allowAutomaticInvocation,
        triggersText: definition.triggers.join(", "),
      };
      setForm(nextForm);
      baselineRef.current = JSON.stringify(nextForm);
      setConfirmDiscard(false);
      setFormOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    // Mirror the main-process contract (CUSTOM_AGENT_INVALID) so an empty
    // form fails locally with field errors instead of an IPC rejection.
    const nameInvalid = !form.name.trim();
    const instructionsInvalid = !form.instructions.trim();
    setNameError(nameInvalid);
    setInstructionsError(instructionsInvalid);
    if (nameInvalid || instructionsInvalid) return;
    setBusy(true);
    setError(undefined);
    try {
      const input = formToInput(form);
      const snapshot = editingId
        ? await window.artemis.customAgentsUpdate(
            editingId,
            editingRevision,
            input,
          )
        : await window.artemis.customAgentsCreate(input);
      applySettings(snapshot);
      setFormOpen(false);
      setEditingId(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("CUSTOM_AGENT_REVISION_CONFLICT")) {
        // Keep the user's form content and surface the conflict; the list
        // snapshot refreshes so a following save targets the new revision.
        setError(t.revisionConflict);
        try {
          applySettings(await window.artemis.getSettings());
        } catch {
          // Snapshot refresh is best-effort; the conflict notice stands.
        }
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeDefinition = async (id: string) => {
    setBusy(true);
    setError(undefined);
    try {
      applySettings(await window.artemis.customAgentsDelete(id));
      setDeleteConfirmId(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (
    summary: CustomAgentSummary,
    enabled: boolean,
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      const definition = await window.artemis.customAgentsGet(summary.id);
      if (!definition) throw new Error("CUSTOM_AGENT_NOT_FOUND");
      applySettings(
        await window.artemis.customAgentsUpdate(summary.id, summary.revision, {
          name: definition.name,
          description: definition.description,
          color: definition.color,
          enabled,
          instructions: definition.instructions,
          scope: definition.scope,
          projectIds: summary.projectIds,
          modelPolicy: definition.modelPolicy,
          thinkingPolicy: definition.thinkingPolicy,
          toolPolicy: definition.toolPolicy,
          allowAutomaticInvocation: definition.allowAutomaticInvocation,
          triggers: definition.triggers,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const editorTitle = editingId
    ? t.editorEditTitle.replace("{name}", editingName)
    : t.add;

  const dirty = formOpen && JSON.stringify(form) !== baselineRef.current;

  // Escape, backdrop clicks, and the close button all funnel through here;
  // the dialog's open state is controlled, so vetoing keeps it mounted
  // until the user explicitly keeps editing or discards.
  const requestClose = () => {
    if (busy) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    closeEditor();
  };

  return (
    <div className="custom-agents-anchor">
      <ManagementSection
        actions={
          definitions.length === 0 ? undefined : (
            <>
              <span className="custom-agent-count">
                {t.count.replace("{count}", String(definitions.length))}
              </span>
              <Button disabled={busy} onClick={openCreate}>
                <ArtemisIcon name="plus" />
                {t.add}
              </Button>
            </>
          )
        }
        className="settings-section custom-agents-section"
        description={t.hint}
        title={t.title}
      >
        {error && !formOpen && (
          <InlineNotice tone="warning">{error}</InlineNotice>
        )}
        {!automaticBudget.withinBudget && (
          <InlineNotice tone="warning">
            {t.automaticBudgetExceeded
              .replace("{count}", String(automaticBudget.definitionCount))
              .replace("{max}", String(CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS))
              .replace("{chars}", String(CUSTOM_AGENT_CATALOG_TEXT_BUDGET))}
          </InlineNotice>
        )}
        {definitions.length === 0 ? (
          <EmptyState
            action={
              <Button disabled={busy} onClick={openCreate}>
                <ArtemisIcon name="plus" />
                {t.add}
              </Button>
            }
            className="custom-agent-empty"
            description={t.emptyHint}
            title={t.empty}
          />
        ) : (
          definitions.map((definition) => (
            <ManagementRow
              key={definition.id}
              actions={
                <>
                  <Switch
                    checked={definition.enabled}
                    disabled={busy}
                    label={definition.name}
                    labelVisibility="hidden"
                    onCheckedChange={(enabled) =>
                      void toggleEnabled(definition, enabled)
                    }
                  />
                  <Button
                    disabled={busy}
                    onClick={() => void openEdit(definition)}
                    size="compact"
                  >
                    {t.edit}
                  </Button>
                  {deleteConfirmId === definition.id ? (
                    <>
                      <Button
                        disabled={busy}
                        onClick={() => void removeDefinition(definition.id)}
                        size="compact"
                        variant="danger"
                      >
                        {t.confirmDelete}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => setDeleteConfirmId(undefined)}
                        size="compact"
                      >
                        {t.cancelDelete}
                      </Button>
                    </>
                  ) : (
                    <IconButton
                      disabled={busy}
                      icon={<ArtemisIcon name="trash" />}
                      label={t.delete}
                      onClick={() => setDeleteConfirmId(definition.id)}
                    />
                  )}
                </>
              }
              description={
                <>
                  {definition.description && (
                    <span className="custom-agent-description">
                      {definition.description}
                    </span>
                  )}
                  <span className="custom-agent-badges">
                    <span className="custom-agent-badge">
                      {modelBadge(definition)}
                    </span>
                    <span className="custom-agent-badge">
                      {toolBadge(definition)}
                    </span>
                    <span className="custom-agent-badge">
                      {definition.scope === "all"
                        ? t.scopeBadgeAll
                        : t.scopeBadgeSelected.replace(
                            "{count}",
                            String(definition.projectIds.length),
                          )}
                    </span>
                    {!definition.enabled && (
                      <span className="custom-agent-badge">
                        {t.disabledBadge}
                      </span>
                    )}
                    <span className="custom-agent-badge">
                      {definition.allowAutomaticInvocation
                        ? t.automaticBadge
                        : t.manualBadge}
                    </span>
                  </span>
                </>
              }
              leading={
                <span
                  aria-hidden="true"
                  className={`custom-agent-color custom-agent-color-${customAgentColorToken(definition.color)}`}
                />
              }
              title={definition.name}
            />
          ))
        )}
      </ManagementSection>
      {formOpen && (
        <Dialog
          className="custom-agent-dialog"
          initialFocusRef={nameInputRef}
          label={editorTitle}
          onOpenChange={(open) => {
            if (!open) requestClose();
          }}
          open
        >
          <form className="credential-form custom-agent-form" onSubmit={save}>
            <header className="custom-agent-dialog-header">
              <div className="custom-agent-dialog-heading">
                <span
                  aria-hidden="true"
                  className={`custom-agent-color custom-agent-color-${customAgentColorToken(form.color)}`}
                />
                <div className="custom-agent-dialog-heading-copy">
                  <h3>{editorTitle}</h3>
                  <p>{t.editorHint}</p>
                </div>
              </div>
              <IconButton
                disabled={busy}
                icon={<ArtemisIcon name="close" />}
                label={t.closeDialog}
                onClick={requestClose}
              />
            </header>
            {error && <InlineNotice tone="warning">{error}</InlineNotice>}
            <fieldset className="custom-agent-dialog-section">
              <legend>{t.sectionIdentity}</legend>
              <TextField
                disabled={busy}
                error={nameError ? t.nameRequired : undefined}
                inputRef={nameInputRef}
                label={t.name}
                onValueChange={(name) => {
                  setNameError(false);
                  setForm((f) => ({ ...f, name }));
                }}
                value={form.name}
              />
              <div className="custom-agent-color-field">
                <span className="custom-agent-color-label">{t.color}</span>
                <div
                  aria-label={t.color}
                  className="custom-agent-color-picker"
                  role="radiogroup"
                >
                  {COLOR_TOKENS.map((token) => (
                    <button
                      key={token}
                      aria-checked={form.color === token}
                      aria-label={token}
                      className={`custom-agent-color custom-agent-color-${customAgentColorToken(token)}${
                        form.color === token ? " selected" : ""
                      }`}
                      disabled={busy}
                      onClick={() => setForm((f) => ({ ...f, color: token }))}
                      role="radio"
                      type="button"
                    />
                  ))}
                </div>
              </div>
              <TextField
                disabled={busy}
                label={t.description}
                onValueChange={(description) =>
                  setForm((f) => ({ ...f, description }))
                }
                value={form.description}
              />
            </fieldset>
            <fieldset className="custom-agent-dialog-section">
              <legend>{t.sectionModel}</legend>
              <Select
                disabled={busy}
                label={t.modelPolicy}
                labelVisibility="hidden"
                onValueChange={(kind) =>
                  setForm((f) => ({
                    ...f,
                    modelKind: kind as "inherit" | "fixed",
                  }))
                }
                options={[
                  { value: "inherit", label: t.modelInherit },
                  { value: "fixed", label: t.modelFixed },
                ]}
                value={form.modelKind}
              />
              {form.modelKind === "fixed" && (
                <Select
                  disabled={busy}
                  label={t.modelFixed}
                  labelVisibility="visible"
                  onValueChange={(value) => {
                    const [providerId = "", modelId = ""] = value.split("/");
                    setForm((f) => ({
                      ...f,
                      modelProviderId: providerId,
                      modelId,
                    }));
                  }}
                  options={modelOptions}
                  value={`${form.modelProviderId}/${form.modelId}`}
                />
              )}
            </fieldset>
            <fieldset className="custom-agent-dialog-section">
              <legend>{t.sectionReasoning}</legend>
              <Select
                disabled={busy}
                label={t.thinkingPolicy}
                labelVisibility="hidden"
                onValueChange={(kind) =>
                  setForm((f) => ({
                    ...f,
                    thinkingKind: kind as "inherit" | "fixed",
                  }))
                }
                options={[
                  { value: "inherit", label: t.thinkingInherit },
                  { value: "fixed", label: t.thinkingFixed },
                ]}
                value={form.thinkingKind}
              />
              {form.thinkingKind === "fixed" && (
                <Select
                  disabled={busy}
                  label={t.thinkingFixed}
                  labelVisibility="visible"
                  onValueChange={(level) =>
                    setForm((f) => ({ ...f, thinkingLevel: level }))
                  }
                  options={THINKING_LEVELS.map((level) => ({
                    value: level,
                    label: level,
                  }))}
                  value={form.thinkingLevel}
                />
              )}
            </fieldset>
            <fieldset className="custom-agent-dialog-section">
              <legend>{t.sectionTools}</legend>
              <Select
                disabled={busy}
                label={t.toolPolicy}
                labelVisibility="hidden"
                onValueChange={(kind) =>
                  setForm((f) => ({
                    ...f,
                    toolKind: kind as "inherit" | "allowlist",
                  }))
                }
                options={[
                  { value: "inherit", label: t.toolInherit },
                  { value: "allowlist", label: t.toolAllowlist },
                ]}
                value={form.toolKind}
              />
              {form.toolKind === "allowlist" && (
                <fieldset className="custom-agent-tools">
                  <legend>{t.builtinTools}</legend>
                  {BUILTIN_TOOL_CHOICES.map((choice) => (
                    <Checkbox
                      key={choice.toolId}
                      checked={form.builtinToolIds.includes(choice.toolId)}
                      disabled={busy}
                      label={choice.toolId}
                      onCheckedChange={(checked) =>
                        setForm((f) => ({
                          ...f,
                          builtinToolIds: checked
                            ? [...f.builtinToolIds, choice.toolId]
                            : f.builtinToolIds.filter(
                                (id) => id !== choice.toolId,
                              ),
                        }))
                      }
                    />
                  ))}
                  {settings.mcpServers.some(
                    (server) => server.tools.length > 0,
                  ) && (
                    <>
                      <legend>{t.mcpTools}</legend>
                      {settings.mcpServers
                        .filter((server) => server.tools.length > 0)
                        .map((server) => {
                          // Server-dimension selection (issue #193 review):
                          // checking a server grants every tool it exposes;
                          // the stored refs still enumerate individual tools.
                          const serverTools = server.tools.map((tool) => ({
                            serverId: tool.serverId,
                            toolName: tool.toolName,
                          }));
                          const selected = form.mcpToolRefs.filter((ref) =>
                            serverTools.some(
                              (tool) =>
                                tool.serverId === ref.serverId &&
                                tool.toolName === ref.toolName,
                            ),
                          ).length;
                          const checked =
                            selected > 0 && selected === serverTools.length;
                          return (
                            <Checkbox
                              key={server.config.id}
                              checked={checked}
                              disabled={busy}
                              label={`${server.config.name}（${t.mcpToolsCount.replace("{count}", String(server.tools.length))}）`}
                              onCheckedChange={(next) =>
                                setForm((f) => ({
                                  ...f,
                                  mcpToolRefs: next
                                    ? [
                                        ...f.mcpToolRefs.filter(
                                          (ref) =>
                                            !serverTools.some(
                                              (tool) =>
                                                tool.serverId === ref.serverId,
                                            ),
                                        ),
                                        ...serverTools,
                                      ]
                                    : f.mcpToolRefs.filter(
                                        (ref) =>
                                          !serverTools.some(
                                            (tool) =>
                                              tool.serverId === ref.serverId,
                                          ),
                                      ),
                                }))
                              }
                            />
                          );
                        })}
                    </>
                  )}
                </fieldset>
              )}
            </fieldset>
            <TextAreaField
              description={t.instructionsHint}
              disabled={busy}
              error={instructionsError ? t.instructionsRequired : undefined}
              label={t.instructions}
              onValueChange={(instructions) => {
                setInstructionsError(false);
                setForm((f) => ({ ...f, instructions }));
              }}
              rows={6}
              value={form.instructions}
            />
            <fieldset className="custom-agent-dialog-section">
              <legend>{t.sectionDispatch}</legend>
              <TextField
                description={t.triggersHint}
                disabled={busy}
                label={t.triggers}
                onValueChange={(triggersText) =>
                  setForm((f) => ({ ...f, triggersText }))
                }
                value={form.triggersText}
              />
              <Checkbox
                checked={form.enabled}
                disabled={busy}
                label={t.enabledLabel}
                onCheckedChange={(enabled) =>
                  setForm((f) => ({ ...f, enabled }))
                }
              />
              <Checkbox
                checked={form.allowAutomaticInvocation}
                description={t.allowAutomaticHint}
                disabled={busy}
                label={t.allowAutomatic}
                onCheckedChange={(allowAutomaticInvocation) =>
                  setForm((f) => ({ ...f, allowAutomaticInvocation }))
                }
              />
              <Select
                disabled={busy}
                label={t.scope}
                labelVisibility="visible"
                onValueChange={(scope) =>
                  setForm((f) => ({
                    ...f,
                    scope: scope as "all" | "selected",
                  }))
                }
                options={[
                  { value: "all", label: t.scopeAll },
                  { value: "selected", label: t.scopeSelected },
                ]}
                value={form.scope}
              />
              {form.scope === "selected" && (
                <fieldset className="custom-agent-projects">
                  <legend>{t.projects}</legend>
                  <p className="settings-hint">{t.scopeHint}</p>
                  {projects.map((project) => (
                    <Checkbox
                      key={project.id}
                      checked={form.projectIds.includes(project.id)}
                      disabled={busy}
                      label={project.name}
                      onCheckedChange={(checked) =>
                        setForm((f) => ({
                          ...f,
                          projectIds: checked
                            ? [...f.projectIds, project.id]
                            : f.projectIds.filter((id) => id !== project.id),
                        }))
                      }
                    />
                  ))}
                </fieldset>
              )}
              {capabilityPreview && (
                <p className="settings-hint custom-agent-capability-preview">
                  {t.capabilityPreview.replace("{mode}", "execute")}:{" "}
                  {capabilityPreview.length > 0
                    ? capabilityPreview.join(", ")
                    : "—"}
                </p>
              )}
            </fieldset>
            <footer className="custom-agent-dialog-footer">
              {confirmDiscard && dirty ? (
                <>
                  <span className="custom-agent-dirty-note">
                    {t.dirtyWarning}
                  </span>
                  <Button
                    disabled={busy}
                    onClick={() => setConfirmDiscard(false)}
                    type="button"
                  >
                    {t.keepEditing}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={closeEditor}
                    type="button"
                    variant="danger"
                  >
                    {t.discardChanges}
                  </Button>
                </>
              ) : (
                <>
                  <Button disabled={busy} onClick={requestClose} type="button">
                    {t.cancelEdit}
                  </Button>
                  <Button disabled={busy} type="submit" variant="primary">
                    {t.save}
                  </Button>
                </>
              )}
            </footer>
          </form>
        </Dialog>
      )}
    </div>
  );
}
