import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type {
  ProviderLoginOption,
  ProviderLoginState,
} from "../shared/provider-login.js";
import { uiText } from "../shared/ui-text.js";

export function ProviderLogin({
  locale,
  disabled,
  onComplete,
}: {
  locale: AppLocale;
  disabled: boolean;
  onComplete: () => Promise<void>;
}) {
  const [providers, setProviders] = useState<ProviderLoginOption[]>([]);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<ProviderLoginState>();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const loginId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    void window.artemis
      .providerLoginOptions()
      .then((value) => {
        if (!disposed) {
          setProviders(value);
          setSelected(
            value[0] ? `${value[0].providerId}:${value[0].type}` : "",
          );
        }
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
      if (loginId.current)
        void window.artemis.providerLoginCancel(loginId.current);
    };
  }, []);
  useEffect(() => {
    if (state?.status !== "running") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await window.artemis.providerLoginStatus(state.id);
        if (disposed) return;
        setState(next);
        if (next.status === "completed") await onCompleteRef.current();
        else if (next.status === "running")
          timer = setTimeout(() => void poll(), 1000);
      } catch (reason) {
        if (!disposed) setError(String(reason));
      }
    };
    timer = setTimeout(() => void poll(), 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [state?.id, state?.status]);
  useEffect(() => {
    setAnswer(state?.prompt?.options?.[0]?.id ?? "");
  }, [state?.prompt?.id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const prompt = state?.prompt;
  return (
    <div className="provider-login">
      <Select
        label={uiText(locale, "ProviderLogin.title")}
        value={selected}
        disabled={disabled || busy || state?.status === "running"}
        options={providers.map((p) => ({
          value: `${p.providerId}:${p.type}`,
          label: p.name,
        }))}
        onValueChange={setSelected}
      />
      <Button
        disabled={disabled || busy || !selected || state?.status === "running"}
        onClick={() =>
          void run(async () => {
            const provider = providers.find(
              (p) => `${p.providerId}:${p.type}` === selected,
            )!;
            const next = await window.artemis.providerLoginStart(
              provider.providerId,
              provider.type,
            );
            loginId.current = next.id;
            setState(next);
          })
        }
      >
        {uiText(locale, "ProviderLogin.start")}
      </Button>
      {state?.messages.map((message, index) => (
        <p key={index}>{message}</p>
      ))}
      {state?.links.map((link, index) => (
        <p key={index}>
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.label}
          </a>
        </p>
      ))}
      {prompt && (
        <div>
          {prompt.type === "select" ? (
            <Select
              label={prompt.message}
              value={answer}
              onValueChange={setAnswer}
              options={(prompt.options ?? []).map((o) => ({
                value: o.id,
                label: o.label,
              }))}
            />
          ) : (
            <TextField
              label={prompt.message}
              type={prompt.type === "secret" ? "password" : "text"}
              value={answer}
              onValueChange={setAnswer}
              {...(prompt.placeholder
                ? { placeholder: prompt.placeholder }
                : {})}
              autoComplete="off"
            />
          )}
          <Button
            disabled={busy || !answer}
            onClick={() =>
              void run(async () => {
                setState(
                  await window.artemis.providerLoginAnswer(
                    state!.id,
                    prompt.id,
                    answer,
                  ),
                );
                setAnswer("");
              })
            }
          >
            {uiText(locale, "ProviderLogin.continue")}
          </Button>
        </div>
      )}
      {state?.status === "running" && (
        <Button
          variant="quiet"
          onClick={() =>
            void run(async () => {
              await window.artemis.providerLoginCancel(state.id);
              setState(await window.artemis.providerLoginStatus(state.id));
            })
          }
        >
          {uiText(locale, "ProviderLogin.cancel")}
        </Button>
      )}
      {state?.status === "completed" && (
        <InlineNotice tone="success">
          {uiText(locale, "ProviderLogin.completed")}
        </InlineNotice>
      )}
      {(error || state?.error) && (
        <InlineNotice tone="danger">{error || state?.error}</InlineNotice>
      )}
    </div>
  );
}
