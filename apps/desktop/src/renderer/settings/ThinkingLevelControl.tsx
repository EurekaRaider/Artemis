import type {
  AgentModelInfo,
  AppLocale,
  ModelSelection,
  ThinkingLevel,
} from "@artemis/protocol";
import { SegmentedControl } from "@artemis/ui/navigation";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import {
  thinkingLevelLabel,
  thinkingLevelsForModel,
} from "./model-selection.js";

export function ThinkingLevelControl({
  model,
  selection,
  locale,
  disabled,
  onChange,
}: {
  model: AgentModelInfo | undefined;
  selection: ModelSelection;
  locale: AppLocale;
  disabled?: boolean;
  onChange(level: ThinkingLevel, ultra: boolean): void;
}) {
  const levels = thinkingLevelsForModel(model);
  if (!levels.length) return null;
  return (
    <SegmentedControl
      className="thinking-level-control"
      label={uiText(locale, "Review06.thinking")}
      size="compact"
      disabled={disabled ?? false}
      value={selection.ultraMode ? "ultra" : selection.thinkingLevel}
      options={[
        ...levels.map((value) => ({
          value,
          label: thinkingLevelLabel(value, locale),
        })),
        {
          value: "ultra",
          label: uiText(locale, "Review06.ultra"),
          icon: <ArtemisIcon name="lightning" width={12} height={12} />,
        },
      ]}
      onValueChange={(value) =>
        onChange(
          value === "ultra" ? levels.at(-1)! : (value as ThinkingLevel),
          value === "ultra",
        )
      }
    />
  );
}
