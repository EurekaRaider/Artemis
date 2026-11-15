import type { PromptTemplateInfo } from "../../shared/api/prompt-templates.js";
export function PromptTemplateSuggestions({
  suggestions,
  activeIndex,
  onSelect,
}: {
  suggestions: Array<{ index: number; template: PromptTemplateInfo }>;
  activeIndex: number;
  onSelect(command: string): void;
}) {
  return suggestions.map(({ index, template }) => (
    <button
      key={`template:${template.name}`}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={index === activeIndex}
      id={`skill-command-option-${index}`}
      className={`slash-command-suggestion${index === activeIndex ? " active" : ""}`}
      onClick={() => onSelect(`/${template.name} `)}
    >
      <span>
        <strong>
          /{template.name} {template.argumentHint}
        </strong>
        <small>{template.description}</small>
      </span>
    </button>
  ));
}
