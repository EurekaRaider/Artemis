import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface CodexSelectOption<Value extends string> {
  value: Value;
  label: string;
  searchText?: string;
}

interface CodexSelectProps<Value extends string> {
  ariaLabel: string;
  disabled?: boolean;
  noResultsLabel?: string;
  onChange(value: Value): void;
  options: CodexSelectOption<Value>[];
  searchPlaceholder?: string;
  value: Value;
}

function compactSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function fuzzyTermMatches(term: string, searchText: string): boolean {
  if (searchText.includes(term)) return true;
  let searchIndex = 0;
  for (const character of term) {
    searchIndex = searchText.indexOf(character, searchIndex);
    if (searchIndex < 0) return false;
    searchIndex += 1;
  }
  return true;
}

export function filterCodexSelectOptions<Value extends string>(
  options: CodexSelectOption<Value>[],
  query: string,
): CodexSelectOption<Value>[] {
  const terms = query
    .normalize("NFKD")
    .toLocaleLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map(compactSearchText)
    .filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => {
    const searchText = compactSearchText(
      option.searchText ?? `${option.label} ${option.value}`,
    );
    return terms.every((term) => fuzzyTermMatches(term, searchText));
  });
}

function SelectChevron() {
  return (
    <svg
      aria-hidden="true"
      className="codex-select-chevron"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="m4.5 6.25 3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function scrollOptionIntoListbox(
  listbox: HTMLDivElement | null,
  option: HTMLDivElement | null | undefined,
) {
  if (!listbox || !option) return;
  const listboxRect = listbox.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  if (optionRect.top < listboxRect.top) {
    listbox.scrollTop -= listboxRect.top - optionRect.top;
  } else if (optionRect.bottom > listboxRect.bottom) {
    listbox.scrollTop += optionRect.bottom - listboxRect.bottom;
  }
}

export function CodexSelect<Value extends string>({
  ariaLabel,
  disabled = false,
  noResultsLabel = "No matching options",
  onChange,
  options,
  searchPlaceholder,
  value,
}: CodexSelectProps<Value>) {
  const listboxId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const selectedIndex = useMemo(
    () =>
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    [options, value],
  );
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const visibleOptions = useMemo(
    () => filterCodexSelectOptions(options, searchQuery),
    [options, searchQuery],
  );
  const visibleSelectedIndex = Math.max(
    0,
    visibleOptions.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    setActiveIndex(searchQuery ? 0 : visibleSelectedIndex);
    optionRefs.current = [];
  }, [searchQuery, visibleSelectedIndex]);

  useLayoutEffect(() => {
    if (open) return;
    const conversation = root.current?.closest<HTMLElement>(".conversation");
    if (conversation) {
      conversation.scrollLeft = 0;
      conversation.scrollTop = 0;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (searchPlaceholder) {
        searchInput.current?.focus({ preventScroll: true });
      } else {
        menu.current?.focus({ preventScroll: true });
      }
      scrollOptionIntoListbox(menu.current, optionRefs.current[activeIndex]);
    });
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOnFocusOutside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOnFocusOutside);
    };
  }, [activeIndex, open, searchPlaceholder]);

  function closeAndFocus() {
    setOpen(false);
    window.requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  }

  function choose(option: CodexSelectOption<Value>) {
    if (option.value !== value) {
      onChange(option.value);
    }
    closeAndFocus();
  }

  function focusOption(index: number) {
    if (visibleOptions.length === 0) return;
    const nextIndex = Math.max(0, Math.min(visibleOptions.length - 1, index));
    setActiveIndex(nextIndex);
  }

  function handleNavigationKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (visibleOptions.length === 0 && event.key !== "Escape") return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption((activeIndex + 1) % visibleOptions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(
          (activeIndex - 1 + visibleOptions.length) % visibleOptions.length,
        );
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(visibleOptions.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (visibleOptions[activeIndex]) choose(visibleOptions[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        closeAndFocus();
        break;
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (visibleOptions.length === 0 && event.key !== "Escape") return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption((activeIndex + 1) % visibleOptions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(
          (activeIndex - 1 + visibleOptions.length) % visibleOptions.length,
        );
        break;
      case "Enter":
        event.preventDefault();
        if (visibleOptions[activeIndex]) choose(visibleOptions[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        closeAndFocus();
        break;
    }
  }

  return (
    <div className="codex-select" ref={root}>
      <button
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="codex-select-trigger"
        disabled={disabled || options.length === 0}
        onClick={() => {
          setSearchQuery("");
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
        ref={trigger}
        type="button"
      >
        <span>{selected?.label ?? value}</span>
        <SelectChevron />
      </button>
      {open && (
        <div className="codex-select-menu">
          {searchPlaceholder && (
            <input
              aria-activedescendant={
                visibleOptions[activeIndex]
                  ? `${listboxId}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-label={searchPlaceholder}
              className="codex-select-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              ref={searchInput}
              role="combobox"
              type="search"
              value={searchQuery}
            />
          )}
          <div
            aria-activedescendant={
              visibleOptions[activeIndex]
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            aria-label={ariaLabel}
            className="codex-select-listbox"
            id={listboxId}
            onKeyDown={handleNavigationKeyDown}
            ref={menu}
            role="listbox"
            tabIndex={searchPlaceholder ? -1 : 0}
          >
            {visibleOptions.length === 0 ? (
              <div className="codex-select-empty">{noResultsLabel}</div>
            ) : (
              visibleOptions.map((option, index) => (
                <div
                  aria-selected={option.value === value}
                  className={`codex-select-option ${
                    option.value === value ? "selected" : ""
                  } ${index === activeIndex ? "active" : ""}`}
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  onClick={() => choose(option)}
                  onMouseMove={() => setActiveIndex(index)}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                >
                  <span className="codex-select-check" aria-hidden="true">
                    {option.value === value ? "✓" : ""}
                  </span>
                  <span>{option.label}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
