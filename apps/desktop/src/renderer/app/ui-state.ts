import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { z } from "zod";
import {
  readLocalDraft,
  writeLocalDraft,
} from "../workspace/workspace-autosave.js";

const changed = "artemis-ui-state-changed";
export const booleanUiState = z.boolean();
export const markdownViewState = z.enum(["rich", "source"]);
export const officeZoomState = z.enum([
  "width",
  "page",
  "0.5",
  "0.75",
  "1",
  "1.25",
  "1.5",
  "2",
]);
export const officeSheetViewState = z.enum(["grid", "print"]);

// Save at the interaction boundary: a renderer shutdown must not lose a pending
// effect. Defaults are read-only, so mounting another panel cannot overwrite a choice.
export function usePersistentUiState<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T | (() => T),
): [T, (update: SetStateAction<T>) => void] {
  const [defaultValue] = useState(fallback);
  const read = useCallback(() => {
    const parsed = z
      .object({ protocolVersion: z.literal(1), value: schema })
      .safeParse(readLocalDraft(key));
    return parsed.success ? parsed.data.value : defaultValue;
  }, [key, schema, defaultValue]);
  const [value, setValue] = useState(read);
  const current = useRef(value);
  useEffect(() => {
    const receive = (next: T) => {
      current.current = next;
      setValue(next);
    };
    const localChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: unknown }>)
        .detail;
      if (detail.key !== key) return;
      const parsed = schema.safeParse(detail.value);
      if (parsed.success) receive(parsed.data);
    };
    const storageChange = (event: StorageEvent) => {
      if (event.key === key || event.key === null) receive(read());
    };
    receive(read());
    window.addEventListener(changed, localChange);
    window.addEventListener("storage", storageChange);
    return () => {
      window.removeEventListener(changed, localChange);
      window.removeEventListener("storage", storageChange);
    };
  }, [key, read, schema]);
  const update = useCallback(
    (action: SetStateAction<T>) => {
      const next =
        typeof action === "function"
          ? (action as (previous: T) => T)(current.current)
          : action;
      if (Object.is(next, current.current)) return;
      current.current = next;
      writeLocalDraft(key, { protocolVersion: 1, value: next });
      setValue(next);
      window.dispatchEvent(
        new CustomEvent(changed, { detail: { key, value: next } }),
      );
    },
    [key],
  );
  return [value, update];
}
