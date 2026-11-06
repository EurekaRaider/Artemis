import { useLayoutEffect } from "react";
import { type ImAuthorizationOperation } from "@artemis/protocol";

import { type AuthorizationDraft } from "../im-authorization-draft";

interface UseGroupAuthorizationFocusContext {
  readonly heading: import("react").RefObject<HTMLHeadingElement | null>;
  readonly body: import("react").RefObject<HTMLDivElement | null>;
  readonly draft: AuthorizationDraft | undefined;
  readonly discard: (() => void) | null;
  readonly pending: ImAuthorizationOperation | undefined;
  readonly setDraft: import("react").Dispatch<
    import("react").SetStateAction<AuthorizationDraft | undefined>
  >;
  readonly conflict: boolean;
}
export function useGroupAuthorizationFocus(
  context: UseGroupAuthorizationFocusContext,
) {
  const { heading, body, draft, discard, pending, setDraft, conflict } =
    context;
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (body.current) body.current.scrollTop = 0;
  }, [draft?.step, !!draft, !!discard, pending?.state]);
  useLayoutEffect(() => {
    if (conflict)
      setDraft((previous) =>
        previous?.confirmation ? { ...previous, confirmation: "" } : previous,
      );
  }, [conflict]);
  return {};
}
