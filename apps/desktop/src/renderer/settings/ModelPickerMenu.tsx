import { Fragment } from "react";
import type {
  AgentModelInfo,
  AppLocale,
  ModelSelection,
  ThinkingLevel,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import { ThinkingLevelControl } from "./ThinkingLevelControl.js";

export function ModelPickerMenu({
  models,
  providers,
  activeModel,
  selection,
  locale,
  query,
  onQuery,
  onModel,
  onThinking,
}: {
  models: AgentModelInfo[];
  providers: { id: string; name: string }[];
  activeModel: AgentModelInfo | undefined;
  selection: ModelSelection | undefined;
  locale: AppLocale;
  query: string;
  onQuery(query: string): void;
  onModel(model: AgentModelInfo): void;
  onThinking(level: ThinkingLevel, ultra: boolean): void;
}) {
  const groups = [...new Set(models.map((model) => model.providerId))];
  const context = (tokens: number) => `${Math.round(tokens / 1000)}K`;
  return (
    <div
      aria-label={uiText(locale, "App_copy.modelPicker")}
      className="model-picker-menu"
      role="dialog"
    >
      <label className="model-picker-search">
        <ArtemisIcon name="search" width={14} height={14} />
        <input
          aria-label={uiText(locale, "Review06.searchModels")}
          placeholder={uiText(locale, "Review06.searchModels")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" && event.key !== "Tab")
              event.stopPropagation();
          }}
        />
      </label>
      <div
        className="model-picker-options"
        role="listbox"
        aria-label={uiText(locale, "App_copy.modelPickerModel")}
      >
        {groups.map((provider) => (
          <Fragment key={provider}>
            <div className="model-picker-group">
              {providers.find((item) => item.id === provider)?.name ?? provider}
            </div>
            {models
              .filter((model) => model.providerId === provider)
              .map((model) => {
                const selected =
                  selection?.providerId === model.providerId &&
                  selection.modelId === model.modelId;
                return (
                  <button
                    key={model.modelId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onModel(model)}
                  >
                    <ArtemisIcon name="model" width={14} height={14} />
                    <span
                      className={
                        model.name === model.modelId
                          ? "model-picker-id"
                          : undefined
                      }
                    >
                      {model.name}
                    </span>
                    <small>{context(model.contextWindow)}</small>
                    <ArtemisIcon
                      name="check"
                      width={14}
                      height={14}
                      style={{ visibility: selected ? "visible" : "hidden" }}
                    />
                  </button>
                );
              })}
          </Fragment>
        ))}
        {!models.length && (
          <span className="model-picker-empty">
            {uiText(locale, "SettingsPanel_labels.modelSearchEmpty")}
          </span>
        )}
      </div>
      {activeModel?.reasoning && selection && (
        <div className="model-picker-thinking">
          <div>
            <span>{uiText(locale, "Review06.thinking")}</span>
            <small>
              {uiText(locale, "Review06.context", {
                count: context(activeModel.contextWindow),
              })}
            </small>
          </div>
          <ThinkingLevelControl
            model={activeModel}
            selection={selection}
            locale={locale}
            onChange={onThinking}
          />
          <small>{uiText(locale, "Review06.ultraCost")}</small>
        </div>
      )}
    </div>
  );
}
