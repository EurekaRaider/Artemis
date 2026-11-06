import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArtemisIcon } from "@artemis/ui/icons";

export const timeHours = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);

export const timeMinutes = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);

export function TimeOptions(props: {
  autoFocus?: boolean;
  labelId: string;
  onChange(value: string): void;
  onCommit?(): void;
  value: string;
  values: string[];
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, props.values.indexOf(props.value));

  const centerOption = (index: number, focus = false) => {
    const option = optionRefs.current[index];
    const list = option?.parentElement;
    if (focus) option?.focus({ preventScroll: true });
    if (option && list) {
      list.scrollTop =
        option.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2;
    }
  };

  useEffect(() => {
    centerOption(selectedIndex, props.autoFocus);
  }, [props.autoFocus]);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = (index + 1) % props.values.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (index - 1 + props.values.length) % props.values.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = props.values.length - 1;
    }
    if (nextIndex === undefined) return;
    const nextValue = props.values[nextIndex];
    if (nextValue === undefined) return;
    event.preventDefault();
    props.onChange(nextValue);
    window.requestAnimationFrame(() => centerOption(nextIndex, true));
  };

  return (
    <div
      aria-labelledby={props.labelId}
      className="automation-time-list"
      role="listbox"
    >
      {props.values.map((option, index) => (
        <button
          aria-selected={option === props.value}
          className={`automation-time-option ${
            option === props.value ? "selected" : ""
          }`}
          key={option}
          onClick={() => {
            props.onChange(option);
            props.onCommit?.();
          }}
          onKeyDown={(event) => navigate(event, index)}
          ref={(element) => {
            optionRefs.current[index] = element;
          }}
          role="option"
          tabIndex={option === props.value ? 0 : -1}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function TimePicker(props: {
  hourLabel: string;
  label: string;
  minuteLabel: string;
  onChange(value: string): void;
  value: string;
}) {
  const [selectedHour = "00", selectedMinute = "00"] = props.value.split(":");
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const hourLabelId = useId();
  const minuteLabelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() =>
        trigger.current?.focus({ preventScroll: true }),
      );
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  };

  return (
    <div className={`automation-time-picker ${open ? "open" : ""}`} ref={root}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${props.label}: ${props.value}`}
        className="automation-time-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        type="button"
      >
        <ArtemisIcon
          className="automation-time-clock"
          height={16}
          name="clock"
          width={16}
        />
        <span className="automation-time-value">
          <span>{selectedHour}</span>
          <span aria-hidden="true" className="automation-time-colon">
            :
          </span>
          <span>{selectedMinute}</span>
        </span>
        <ArtemisIcon
          className="automation-time-chevron"
          height={16}
          name="chevron"
          width={16}
        />
      </button>
      {open && (
        <div
          aria-label={props.label}
          className="automation-time-popover"
          id={popoverId}
          role="dialog"
        >
          <div className="automation-time-column">
            <span className="automation-time-heading" id={hourLabelId}>
              {props.hourLabel}
            </span>
            <TimeOptions
              autoFocus
              labelId={hourLabelId}
              onChange={(hour) => props.onChange(`${hour}:${selectedMinute}`)}
              value={selectedHour}
              values={timeHours}
            />
          </div>
          <div aria-hidden="true" className="automation-time-divider" />
          <div className="automation-time-column">
            <span className="automation-time-heading" id={minuteLabelId}>
              {props.minuteLabel}
            </span>
            <TimeOptions
              labelId={minuteLabelId}
              onChange={(minute) => props.onChange(`${selectedHour}:${minute}`)}
              onCommit={closeAndFocus}
              value={selectedMinute}
              values={timeMinutes}
            />
          </div>
        </div>
      )}
    </div>
  );
}
