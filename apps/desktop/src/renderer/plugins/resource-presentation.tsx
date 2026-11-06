import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import type { CapabilityPackStatus } from "@artemis/protocol";
import { EmptyState, LoadingState } from "@artemis/ui/feedback";
import type { ArtemisPluginPreview } from "../../shared/api.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { resourceIconName, SemanticResourceIcon } from "./resource-icons.js";
import { type ResourceKind } from "./resource-types.js";
export function isLegacyOfficePlugin(plugin: ArtemisPluginPreview): boolean {
  return (
    ["bundled", "runtime"].includes(plugin.source.kind) &&
    ["documents", "spreadsheets", "presentations", "pdf"].includes(plugin.name)
  );
}

export function pluginPageText(value: string): string {
  return value
    .replace(/\b(?:OpenAI\s+Codex|OpenAI|Codex|ChatGPT)\b/giu, "Artemis")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export const labels = UI_COPY.ResourceCenter_labels;

export function CatalogIcon({ kind }: { kind: ResourceKind }) {
  return <SemanticResourceIcon icon={resourceIconName("", kind)} />;
}

export function SearchIcon() {
  return <ArtemisIcon name="search" />;
}

export function GearIcon() {
  return <ArtemisIcon name="gear" />;
}

export function RefreshIcon() {
  return <ArtemisIcon name="refresh" />;
}

export function PlusIcon() {
  return <ArtemisIcon name="plus" />;
}

export function TrashIcon() {
  return <ArtemisIcon name="trash" />;
}

export function BackIcon() {
  return <ArtemisIcon name="chev-left" />;
}

export function EmptyResource({ children }: { children: string }) {
  return <p className="resource-empty-inline">{children}</p>;
}

export function CatalogSearchNotice({
  children,
  loading = false,
}: {
  children: string;
  loading?: boolean;
}) {
  return loading ? (
    <LoadingState
      aria-atomic="true"
      aria-live="polite"
      label={children}
      lines={1}
    />
  ) : (
    <EmptyState
      aria-atomic="true"
      aria-live="polite"
      role="status"
      title={children}
    />
  );
}

export const FEATURED_PLUGINS = [
  "documents",
  "pdf",
  "spreadsheets",
  "presentations",
  "figma",
  "github",
  "google-drive",
  "gmail",
  "computer-use",
  "data-analytics",
];

export function installedCapabilityVersion(
  status: CapabilityPackStatus | undefined,
): string | undefined {
  return (
    status?.activeVersion ??
    status?.versions.toSorted((left, right) =>
      right.version.localeCompare(left.version, "en", { numeric: true }),
    )[0]?.version
  );
}
