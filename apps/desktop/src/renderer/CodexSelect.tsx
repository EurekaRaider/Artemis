import {
  Select,
  filterSelectOptions,
  type SelectOption,
} from "@artemis/ui/forms";

export interface CodexSelectOption<
  Value extends string,
> extends SelectOption<Value> {}

interface CodexSelectProps<Value extends string> {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly noResultsLabel?: string;
  readonly onChange: (value: Value) => void;
  readonly options: readonly CodexSelectOption<Value>[];
  readonly searchPlaceholder?: string;
  readonly value: Value;
}

export function filterCodexSelectOptions<Value extends string>(
  options: readonly CodexSelectOption<Value>[],
  query: string,
): CodexSelectOption<Value>[] {
  return filterSelectOptions(options, query);
}

export function CodexSelect<Value extends string>({
  ariaLabel,
  disabled,
  noResultsLabel,
  onChange,
  options,
  searchPlaceholder,
  value,
}: CodexSelectProps<Value>) {
  return (
    <Select
      className="codex-select"
      disabled={disabled}
      label={ariaLabel}
      labelVisibility="hidden"
      noResultsLabel={noResultsLabel}
      onValueChange={onChange}
      options={options}
      searchPlaceholder={searchPlaceholder}
      size="compact"
      value={value}
    />
  );
}
