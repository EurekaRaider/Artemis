import { RunningArc } from "@artemis/ui/icons";
import { ToolActivity } from "@artemis/ui/patterns";
import { ResourceAvatar } from "../plugins/resource-icons.js";
import { ArtemisIcon } from "@artemis/ui/icons";

import { type ToolPlugin } from "./tool-plugin-source.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { useEffect, useState } from "react";

import { type ToolState } from "@artemis/protocol";
import type { McpServerStatus } from "../../shared/api.js";
import { toolActivityPatternView } from "./agent-pattern-adapters.js";
import {
  toolStepPresentation,
  formatToolInput,
  formatToolOutput,
  summarizeToolDetail,
  toolActivityKind,
  toolActivityPath,
} from "./tool-presentation.js";

import { type Locale } from "../app/app-types.js";
export function ToolResultImages({ tool }: { tool: ToolState }) {
  return tool.images?.map((image, index) => (
    <a
      key={index}
      href={`data:${image.mimeType};base64,${image.data}`}
      download={`generated-${tool.id}-${index}.${image.mimeType.split("/")[1]}`}
    >
      <img
        className="tool-result-image"
        alt={tool.name}
        src={`data:${image.mimeType};base64,${image.data}`}
      />
    </a>
  ));
}

export function ToolActivityGroupCard({
  active,
  locale,
  onFileLink,
  tools,
  pluginForTool,
  mcpForTool,
}: {
  active: boolean;
  locale: Locale;
  onFileLink: (href: string) => void;
  tools: readonly ToolState[];
  pluginForTool?: (tool: ToolState) => ToolPlugin | undefined;
  mcpForTool?: (tool: ToolState) => McpServerStatus["config"] | undefined;
}) {
  const failed = tools.some((tool) => tool.status === "failed");
  const [open, setExpanded] = useState(failed);
  useEffect(() => {
    if (failed) setExpanded(true);
  }, [failed]);
  const step = toolStepPresentation(tools, locale);
  const lastTool = tools.at(-1);
  const mcpServer = lastTool && mcpForTool?.(lastTool);
  const view = toolActivityPatternView(tools, active, locale);
  const firstPlugin = tools[0] && pluginForTool?.(tools[0]);
  const plugin =
    firstPlugin &&
    tools.every((tool) => pluginForTool?.(tool)?.id === firstPlugin.id)
      ? firstPlugin
      : undefined;
  const mixedActivity =
    tools.some((tool) => toolActivityKind(tool.name, tool.input) === "bash") &&
    tools.some((tool) =>
      ["read", "search"].includes(toolActivityKind(tool.name, tool.input)),
    );
  const disclosureLabels = UI_COPY.App_disclosureLabels[locale];
  const summary = mixedActivity
    ? disclosureLabels.toolGroupCalls
    : tools.length > 1 && view.fileActivity
      ? view.kind === "write"
        ? disclosureLabels.toolGroupEdit
        : disclosureLabels.toolGroupRead
      : view.summary;

  return (
    <ToolActivity
      className={`tool-card ${view.state}${open ? " open" : ""}${plugin ? " tool-card-plugin" : ""}`}
      collapseLabel={disclosureLabels.collapse}
      disclosureIcon={<ArtemisIcon height={14} name="chev-right" width={14} />}
      expandLabel={disclosureLabels.expand}
      expanded={open}
      icon={
        <span className="tool-step-status" data-status={view.actualStatus}>
          {view.actualStatus === "running" ? (
            <RunningArc size={14} />
          ) : (
            <ArtemisIcon
              name={view.actualStatus === "failed" ? "x-circle" : "check"}
              width={14}
              height={14}
            />
          )}
        </span>
      }
      label={`${plugin ? `${plugin.displayName}, ` : ""}${summary}, ${view.statusLabel}`}
      onExpandedChange={setExpanded}
      state={view.state}
      statusLabel={view.statusLabel}
      summary={
        <span className="tool-step-columns">
          <span className="tool-step-kind">
            {plugin ? (
              <ResourceAvatar
                kind="plugin"
                name={plugin.displayName}
                pluginName={plugin.name}
                iconDataUrl={plugin.iconDataUrl}
                brandColor={plugin.brandColor}
              />
            ) : step.icon === "mcp" || mcpServer ? (
              <ResourceAvatar
                kind="mcp"
                name={
                  mcpServer?.name ??
                  (lastTool?.name ?? "")
                    .replace(/^mcp__?/, "")
                    .split("__")[0] ??
                  ""
                }
                command={
                  mcpServer?.transport === "stdio"
                    ? [mcpServer.command, ...mcpServer.args].join(" ")
                    : undefined
                }
                transport={mcpServer?.transport}
              />
            ) : (
              <ArtemisIcon name={step.icon} width={14} height={14} />
            )}
          </span>
          <span className="tool-step-verb">{step.verb}</span>
          <span className="tool-step-target" title={step.target}>
            {step.target}
          </span>
          <span className="tool-step-metadata">
            {step.added !== undefined ? (
              <>
                <span className="diff-added">+{step.added}</span>{" "}
                <span className="diff-deleted">−{step.deleted}</span>
              </>
            ) : (
              step.metadata
            )}
          </span>
        </span>
      }
    >
      {(view.fileActivity || mixedActivity) && (
        <ol className="tool-activity-list">
          {tools.map((tool) => {
            const detail = summarizeToolDetail(tool, locale);
            const path = toolActivityPath(tool.input);
            const prefix =
              path && detail.endsWith(path)
                ? detail.slice(0, -path.length)
                : detail;
            const row = (
              <>
                <span className="tool-item-label">
                  {prefix}
                  {path && detail.endsWith(path) && (
                    <button
                      className="tool-file-link"
                      onClick={() => onFileLink(path)}
                      type="button"
                    >
                      {path}
                    </button>
                  )}
                </span>
                <span className="tool-item-status" data-state={tool.status}>
                  {toolActivityPatternView([tool], false, locale).statusLabel}
                </span>
              </>
            );
            return (
              <li className={tool.status} key={tool.id}>
                {mixedActivity && (tool.input !== undefined || tool.output) ? (
                  <details className="tool-item-details">
                    <summary
                      aria-label={`${uiText(locale, "EnvironmentPanel_labels.details")}: ${detail}`}
                    >
                      {row}
                      <ArtemisIcon name="chev-right" height={12} width={12} />
                    </summary>
                    <pre>
                      {[
                        formatToolInput(tool.name, tool.input),
                        formatToolOutput(tool.name, tool.output),
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    </pre>
                  </details>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ol>
      )}
      {(view.fileActivity || mixedActivity) &&
        tools.some((tool) => tool.images?.length) && (
          <div className="tool-details">
            {tools.map((tool) => (
              <ToolResultImages key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      {!mixedActivity && view.kind === "bash" && view.bashTranscript && (
        <pre aria-live="polite" className="bash-transcript" role="log">
          {view.bashTranscript}
        </pre>
      )}
      {!view.fileActivity && view.kind !== "bash" && (
        <div className="tool-details">
          {tools.map((tool) => {
            const input = formatToolInput(tool.name, tool.input);
            const output = formatToolOutput(tool.name, tool.output);
            const detailPlugin = !plugin ? pluginForTool?.(tool) : undefined;
            if (!input && !output && !detailPlugin && !tool.images?.length)
              return null;
            return (
              <section
                key={tool.id}
                className={
                  tool.parentToolCallId ? "tool-nested-call" : undefined
                }
                data-parent-tool-call={tool.parentToolCallId}
              >
                {detailPlugin ? (
                  <span className="tool-detail-plugin">
                    <ResourceAvatar
                      kind="plugin"
                      name={detailPlugin.displayName}
                      pluginName={detailPlugin.name}
                      iconDataUrl={detailPlugin.iconDataUrl}
                      brandColor={detailPlugin.brandColor}
                    />
                    {detailPlugin.displayName}
                  </span>
                ) : null}
                <span>{summarizeToolDetail(tool, locale)}</span>
                {input && <pre>{input}</pre>}
                {output && <pre>{output}</pre>}
                <ToolResultImages tool={tool} />
              </section>
            );
          })}
        </div>
      )}
    </ToolActivity>
  );
}
