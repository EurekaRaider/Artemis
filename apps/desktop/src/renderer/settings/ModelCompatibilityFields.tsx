import {
  modelAdvancedOptionsSchema,
  type AppLocale,
  type ProviderConnection,
} from "@artemis/protocol";
import { Select } from "@artemis/ui/forms";
import { uiText } from "../../shared/i18n/ui-text.js";

type Compatibility = NonNullable<
  ProviderConnection["models"][number]["compat"]
>;
const common = ["promptCacheKeyMode", "supportsLongCacheRetention"] as const;
const fields = {
  "openai-completions": [
    "requiresNonNullAssistantContent",
    "requiresToolsWithToolHistory",
    "supportsDeveloperRole",
    "supportsUsageInStreaming",
    "maxTokensField",
    ...common,
  ],
  "openai-responses": ["supportsMaxOutputTokens", ...common],
  "anthropic-messages": ["supportsMessageThreads"],
} satisfies Record<
  NonNullable<ProviderConnection["api"]>,
  readonly (keyof Compatibility)[]
>;

export function ModelCompatibilityFields({
  api,
  value,
  disabled,
  locale,
  onChange,
}: {
  api: NonNullable<ProviderConnection["api"]>;
  value: string;
  disabled: boolean;
  locale: AppLocale;
  onChange(value: string): void;
}) {
  let advanced;
  try {
    advanced = modelAdvancedOptionsSchema.safeParse(JSON.parse(value));
  } catch {
    return null;
  }
  // Never overwrite partially edited or invalid JSON through another control.
  if (!advanced.success) return null;
  const options = advanced.data;
  const auto = uiText(locale, "Review03.modelDefault");
  const yes = uiText(locale, "CustomAgentsSettingsSection_labels.enabledLabel");
  const no = uiText(locale, "CustomAgentsSettingsSection_labels.disabledBadge");
  return (
    <div className="provider-form-section">
      {fields[api].map((key) => {
        const choices =
          key === "maxTokensField"
            ? ["max_tokens", "max_completion_tokens"]
            : key === "promptCacheKeyMode"
              ? ["auto", "enabled", "disabled"]
              : ["true", "false"];
        return (
          <Select<string>
            key={key}
            label={uiText(locale, `ModelCompat.${key}`)}
            description={key}
            labelVisibility="visible"
            disabled={disabled}
            value={
              options.compat?.[key] === undefined
                ? "inherit"
                : String(options.compat[key])
            }
            options={[
              { value: "inherit", label: auto },
              ...choices.map((choice) => ({
                value: choice,
                label:
                  choice === "true" || choice === "enabled"
                    ? yes
                    : choice === "false" || choice === "disabled"
                      ? no
                      : choice,
              })),
            ]}
            onValueChange={(selected) => {
              const compat: Record<string, unknown> = { ...options.compat };
              if (selected === "inherit") delete compat[key];
              else
                compat[key] =
                  selected === "true"
                    ? true
                    : selected === "false"
                      ? false
                      : selected;
              const next = {
                ...options,
                compat: Object.keys(compat).length ? compat : undefined,
              };
              onChange(JSON.stringify(next, null, 2));
            }}
          />
        );
      })}
    </div>
  );
}
