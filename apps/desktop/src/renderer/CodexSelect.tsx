import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export interface CodexSelectOption<Value extends string> {
  value: Value;
  label: string;
}

interface CodexSelectProps<Value extends string> {
  ariaLabel: string;
  disabled?: boolean;
  onChange(value: Value): void;
  options: CodexSelectOption<Value>[];
  value: Value;
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

export function CodexSelect<Value extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: CodexSelectProps<Value>) {
  const listboxId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
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
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menu.current?.focus();
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
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
  }, [activeIndex, open]);

  function closeAndFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function choose(option: CodexSelectOption<Value>) {
    if (option.value !== value) {
      onChange(option.value);
    }
    closeAndFocus();
  }

  function focusOption(index: number) {
    if (options.length === 0) return;
    const nextIndex = Math.max(0, Math.min(options.length - 1, index));
    setActiveIndex(nextIndex);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption((activeIndex + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption((activeIndex - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex]);
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
        <div
          aria-activedescendant={`${listboxId}-option-${activeIndex}`}
          aria-label={ariaLabel}
          className="codex-select-menu"
          id={listboxId}
          onKeyDown={handleMenuKeyDown}
          ref={menu}
          role="listbox"
          tabIndex={0}
        >
          {options.map((option, index) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
