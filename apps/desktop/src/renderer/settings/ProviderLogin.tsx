import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Select, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type {
  ProviderLoginOption,
  ProviderLoginState,
} from "../../shared/provider-login.js";
import { uiText } from "../../shared/i18n/ui-text.js";

export function ProviderLogin({
  locale,
  providerId,
  authType,
  disabled,
  onComplete,
  onBusy,
}: {
  locale: AppLocale;
  providerId?: string;
  authType?: ProviderLoginOption["type"];
  disabled: boolean;
  onComplete: () => Promise<void>;
  onBusy?: (busy: boolean) => void;
}) {
  const [providers, setProviders] = useState<ProviderLoginOption[]>([]);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<ProviderLoginState>();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusy?.(busy || state?.status === "running");
    return () => onBusy?.(false);
  }, [busy, state?.status, onBusy]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const loginId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let disposed = false;
    void window.artemis
      .providerLoginOptions()
      .then((value) => {
        if (!disposed) {
          value = value.filter(
            (option) =>
              (!providerId || option.providerId === providerId) &&
              (!authType || option.type === authType),
          );
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
  }, [providerId, authType]);
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
      <div className="settings-row-copy">
        <div className="settings-row-label">
          {uiText(locale, "ProviderLogin.title")}
        </div>
        <p className="settings-row-description">
          {providerId
            ? uiText(
                locale,
                authType === "oauth"
                  ? "Providers.loginHint"
                  : "Providers.guidedKey",
              )
            : uiText(locale, "ProviderLogin.description")}
        </p>
      </div>
      {!providerId && (
        <Select
          label={uiText(locale, "ProviderLogin.title")}
          labelVisibility="hidden"
          value={selected}
          disabled={disabled || busy || state?.status === "running"}
          options={providers.map((p) => ({
            value: `${p.providerId}:${p.type}`,
            label: `${p.name} · ${p.providerId} (${p.type === "oauth" ? "OAuth" : "API key"})`,
          }))}
          onValueChange={setSelected}
        />
      )}
      {state?.status !== "running" && (
        <div className="provider-login-actions">
          <Button
            disabled={disabled || busy || !selected}
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
                if (next.status === "completed") await onCompleteRef.current();
              })
            }
          >
            {uiText(locale, "ProviderLogin.start")}
          </Button>
        </div>
      )}
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
        <div className="provider-login-prompt">
          {prompt.type === "select" ? (
            <Select
              label={prompt.message}
              labelVisibility="visible"
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
        </div>
      )}
      {state?.status === "running" && (
        <div className="provider-login-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.artemis.providerLoginCancel(state.id);
                setState(await window.artemis.providerLoginStatus(state.id));
              })
            }
          >
            {uiText(locale, "ProviderLogin.cancel")}
          </Button>
          {prompt && (
            <Button
              variant="secondary"
              disabled={busy || !answer}
              onClick={() =>
                void run(async () => {
                  setState(
                    await window.artemis.providerLoginAnswer(
                      state.id,
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
          )}
        </div>
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
