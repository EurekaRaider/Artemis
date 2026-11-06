import { useEffect, useRef, useState } from "react";
import { type ImAuthorizationOperation } from "@artemis/protocol";

import { uiTranslator } from "../../../shared/i18n/ui-text";

import { type AuthorizationDraft } from "../im-authorization-draft";

interface UseGroupAuthorizationStateContext {
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
}
export function useGroupAuthorizationState(
  context: UseGroupAuthorizationStateContext,
) {
  const { locale } = context;
  const t = uiTranslator(locale);
  const [view, setView] = useState<"group" | "project">("group");
  const [selected, setSelected] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<AuthorizationDraft>();
  const [presenceNow, setPresenceNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, []);
  const [refreshingMembers, setRefreshingMembers] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [operation, setOperation] = useState<ImAuthorizationOperation>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  return {
    t,
    view,
    setView,
    selected,
    setSelected,
    projectFilter,
    setProjectFilter,
    query,
    setQuery,
    draft,
    setDraft,
    presenceNow,
    refreshingMembers,
    setRefreshingMembers,
    discard,
    setDiscard,
    operation,
    setOperation,
    error,
    setError,
    submitting,
    setSubmitting,
    sending,
    heading,
    body,
  };
}
