import { Fragment, useLayoutEffect, useRef } from "react";
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
  disabled = false,
  pending = false,
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
  disabled?: boolean;
  pending?: boolean;
  query: string;
  onQuery(query: string): void;
  onModel(model: AgentModelInfo): void;
  onThinking(level: ThinkingLevel, ultra: boolean): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const composer = menu?.closest<HTMLElement>(".composer");
    if (!menu || !composer) return;
    const conversation = composer.closest<HTMLElement>(".conversation");
    const update = () => {
      const anchor = composer.getBoundingClientRect();
      const boundary = conversation?.getBoundingClientRect();
      const minLeft = Math.max(8, (boundary?.left ?? 0) + 8);
      const maxRight = Math.min(
        window.innerWidth - 8,
        (boundary?.right ?? window.innerWidth) - 8,
      );
      // The conversation clips overflow beside the workspace dock.
      menu.style.maxWidth = `${Math.max(0, maxRight - minLeft)}px`;
      const header = composer
        .closest(".workspace")
        ?.querySelector(".workspace-header");
      const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
      menu.style.maxHeight = `${Math.max(0, anchor.top - top - 18)}px`;
      const width = menu.getBoundingClientRect().width;
      const style = getComputedStyle(composer);
      const offset = Number.parseFloat(
        style.getPropertyValue("--model-anchor") || "0",
      );
      const anchorLeft =
        style.direction === "rtl"
          ? anchor.right - offset - width
          : anchor.left + offset;
      const left = Math.min(
        Math.max(minLeft, anchorLeft),
        Math.max(minLeft, maxRight - width),
      );
      // Use physical coordinates here so the viewport clamp also works in RTL.
      menu.style.left = `${left - anchor.left}px`;
      menu.style.right = "auto";
    };
    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(composer);
    if (conversation) observer?.observe(conversation);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  });
  const groups = [...new Set(models.map((model) => model.providerId))];
  const context = (tokens: number) => `${Math.round(tokens / 1000)}K`;
  return (
    <div
      aria-busy={pending || undefined}
      aria-label={uiText(locale, "App_copy.modelPicker")}
      className="model-picker-menu"
      ref={menuRef}
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
                    disabled={disabled}
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
            disabled={disabled}
            onChange={onThinking}
          />
          <small>{uiText(locale, "Review06.ultraCost")}</small>
        </div>
      )}
    </div>
  );
}
