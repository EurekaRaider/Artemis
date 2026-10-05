import { ArrowsDownUp, Plus } from "@phosphor-icons/react";
import { ProviderIcon } from "./ProviderIcon.js";
import { useEffect, useState, type ReactNode } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { TextField } from "@artemis/ui/forms";
import { ConfirmationDialog, InlineNotice } from "@artemis/ui/feedback";
import { Tabs } from "@artemis/ui/navigation";
import type { SettingsSnapshot } from "../../shared/api.js";
import type { ProviderLoginOption } from "../../shared/provider-login.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { ProviderLogin } from "./ProviderLogin.js";

export function ProviderWorkspace({
  settings,
  locale,
  selectedProviderId,
  disabled,
  creating,
  onBusy,
  onSelect,
  onAdd,
  onChange,
  onEditConnection,
  onDeleteConnection,
  children,
}: {
  settings: SettingsSnapshot;
  locale: AppLocale;
  selectedProviderId: string;
  disabled: boolean;
  creating: boolean;
  onBusy(busy: boolean): void;
  onSelect(id: string): void;
  onAdd(): void;
  onChange(settings: SettingsSnapshot): void;
  onEditConnection(): void;
  onDeleteConnection(): void;
  children: ReactNode;
}) {
  const t = UI_COPY.SettingsPanel_labels[locale];
  const [loginOptions, setLoginOptions] = useState<ProviderLoginOption[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let disposed = false;
    void window.artemis
      .providerLoginOptions()
      .then((options) => {
        if (!disposed) setLoginOptions(options);
      })
      .catch((reason) => {
        if (!disposed)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const providers = new Map<string, string>();
  for (const model of settings.models)
    providers.set(model.providerId, model.providerId);
  for (const credential of settings.credentials)
    providers.set(credential.providerId, credential.providerId);
  for (const option of loginOptions)
    providers.set(option.providerId, option.providerId);
  for (const provider of settings.providers)
    providers.set(provider.id, provider.name);
  const entries = [...providers].sort(([a], [b]) => a.localeCompare(b));
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const query = normalize(search);
  const visibleEntries = entries.filter(([id, name]) => {
    const candidate = normalize(`${name} ${id}`);
    let position = 0;
    for (const character of query) {
      position = candidate.indexOf(character, position);
      if (position < 0) return false;
      position += character.length;
    }
    return true;
  });
  const connection = settings.providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const status = (id: string) => {
    const saved = settings.credentials.find((item) => item.providerId === id);
    return uiText(
      locale,
      saved?.type === "api_key"
        ? "Providers.keyConfigured"
        : saved?.type === "oauth"
          ? "Providers.signedIn"
          : "Providers.notConfigured",
    );
  };
  const locked = disabled;
  const fallbackId = entries[0]?.[0];
  const selectionExists = providers.has(selectedProviderId);
  useEffect(() => {
    if (!creating && !selectionExists && fallbackId) onSelect(fallbackId);
  }, [creating, selectionExists, fallbackId, onSelect]);

  return (
    <div className="provider-workspace">
      <aside className="provider-sidebar" aria-label={t.configuredProviders}>
        <div className="provider-sidebar-heading">
          <strong>{uiText(locale, "Providers.list")}</strong>
          <Button
            size="compact"
            variant="quiet"
            disabled={locked}
            icon={<Plus size={20} aria-hidden="true" />}
            onClick={onAdd}
          >
            {uiText(locale, "Providers.add")}
          </Button>
        </div>
        <TextField
          className="provider-search"
          size="compact"
          label={uiText(locale, "Providers.search")}
          labelVisibility="hidden"
          placeholder={uiText(locale, "Providers.search")}
          inputMode="search"
          value={search}
          onValueChange={setSearch}
        />
        <div className="provider-navigation" tabIndex={0}>
          {visibleEntries.length === 0 && (
            <p className="provider-search-empty" role="status">
              {uiText(locale, "Providers.noResults")}
            </p>
          )}
          {visibleEntries.map(([id, name]) => (
            <Button
              key={id}
              variant="quiet"
              className="provider-navigation-item"
              disabled={locked}
              selected={!creating && id === selectedProviderId}
              onClick={() => onSelect(id)}
            >
              <ProviderIcon
                providerId={id}
                custom={settings.providers.some(
                  (provider) => provider.id === id,
                )}
              />
              <span className="provider-navigation-copy">
                <span className="provider-navigation-name">{name}</span>
                <span className="provider-credential-status">{status(id)}</span>
              </span>
            </Button>
          ))}
        </div>
        <Button
          className="provider-import"
          icon={<ArrowsDownUp size={22} aria-hidden="true" />}
          variant="quiet"
          disabled={locked || !settings.encryptionAvailable}
          onClick={() => {
            onBusy(true);
            setError("");
            void window.artemis
              .importPiCredentials()
              .then((result) => {
                if (result) onChange(result.settings);
              })
              .catch((reason) =>
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                ),
              )
              .finally(() => onBusy(false));
          }}
        >
          {t.importPi}
        </Button>
      </aside>
      <div className="provider-detail">
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        {selectedProviderId && !creating && (
          <>
            <header className="provider-detail-heading">
              <div>
                <h2>
                  {providers.get(selectedProviderId) ?? selectedProviderId}
                </h2>
                <p>{uiText(locale, "Providers.description")}</p>
              </div>
              <span className="provider-credential-status">
                {status(selectedProviderId)}
              </span>
            </header>
            <ProviderCredentials
              key={selectedProviderId}
              providerId={selectedProviderId}
              settings={settings}
              locale={locale}
              options={loginOptions.filter(
                (option) => option.providerId === selectedProviderId,
              )}
              disabled={locked}
              onBusy={onBusy}
              onChange={onChange}
            />
            {connection && (
              <div className="provider-connection-summary">
                <div>
                  <strong>{t.baseUrl}</strong>
                  <p>{connection.baseUrl}</p>
                  <span>{connection.api}</span>
                </div>
                <Button
                  variant="quiet"
                  disabled={locked}
                  onClick={onEditConnection}
                >
                  {t.edit}
                </Button>
                <Button
                  variant="quiet"
                  disabled={locked}
                  label={`${t.delete}: ${selectedProviderId}`}
                  onClick={onDeleteConnection}
                >
                  {t.delete}
                </Button>
              </div>
            )}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

function ProviderCredentials({
  providerId,
  settings,
  locale,
  options,
  disabled,
  onBusy,
  onChange,
}: {
  providerId: string;
  settings: SettingsSnapshot;
  locale: AppLocale;
  options: ProviderLoginOption[];
  disabled: boolean;
  onBusy(busy: boolean): void;
  onChange(settings: SettingsSnapshot): void;
}) {
  const t = UI_COPY.SettingsPanel_labels[locale];
  const credential = settings.credentials.find(
    (item) => item.providerId === providerId,
  );
  const [method, setMethod] = useState<"api_key" | "oauth">(
    credential?.type === "oauth" ? "oauth" : "api_key",
  );
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [remove, setRemove] = useState(false);
  const oauth = options.some((option) => option.type === "oauth");
  const keyFlow = options.some((option) => option.type === "api_key");
  // OAuth-only providers must not be offered a plain API-key route.
  const supportsKey =
    !oauth ||
    keyFlow ||
    credential?.type === "api_key" ||
    settings.providers.some((item) => item.id === providerId);
  const activeMethod = supportsKey ? method : "oauth";
  async function run(action: () => Promise<SettingsSnapshot>) {
    onBusy(true);
    setError("");
    setSaved(false);
    try {
      onChange(await action());
      setApiKey("");
      setSaved(true);
      setRemove(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      onBusy(false);
    }
  }
  return (
    <section
      className="provider-credentials"
      aria-label={uiText(locale, "Providers.credentials")}
    >
      <h3>{uiText(locale, "Providers.credentials")}</h3>
      <p className="settings-row-description">
        {uiText(locale, "Providers.sharedCredentials")}
      </p>
      {supportsKey && oauth && (
        <Tabs
          className="provider-auth-tabs"
          disabled={disabled}
          label={uiText(locale, "Providers.method")}
          value={activeMethod}
          onValueChange={(value) => {
            setMethod(value);
            setError("");
            setSaved(false);
          }}
          options={[
            {
              id: "provider-key-tab",
              panelId: "provider-key-panel",
              value: "api_key",
              label: t.apiKey,
            },
            {
              id: "provider-account-tab",
              panelId: "provider-account-panel",
              value: "oauth",
              label: uiText(locale, "Providers.account"),
            },
          ]}
          size="compact"
        />
      )}
      <div
        id={
          activeMethod === "api_key"
            ? "provider-account-panel"
            : "provider-key-panel"
        }
        role="tabpanel"
        aria-labelledby={
          activeMethod === "api_key"
            ? "provider-account-tab"
            : "provider-key-tab"
        }
        hidden
      />
      <div
        id={
          activeMethod === "api_key"
            ? "provider-key-panel"
            : "provider-account-panel"
        }
        role={supportsKey && oauth ? "tabpanel" : undefined}
        aria-labelledby={
          supportsKey && oauth
            ? activeMethod === "api_key"
              ? "provider-key-tab"
              : "provider-account-tab"
            : undefined
        }
      >
        {activeMethod === "api_key" ? (
          <form
            className="provider-credential-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!disabled && settings.encryptionAvailable && apiKey.trim())
                void run(() =>
                  window.artemis.saveApiKey(providerId, apiKey.trim()),
                );
            }}
          >
            <TextField
              className="provider-api-key"
              size="compact"
              label={`${t.apiKey} · ${providerId}`}
              type="password"
              autoComplete="off"
              value={apiKey}
              onValueChange={(value) => {
                setApiKey(value);
                setSaved(false);
              }}
              disabled={disabled || !settings.encryptionAvailable}
              placeholder={
                credential?.type === "api_key" ? t.storedApiKey : t.apiKey
              }
              description={
                settings.encryptionAvailable
                  ? uiText(locale, "Providers.keyHint")
                  : t.unavailable
              }
            />
            <div className="provider-form-actions">
              {credential?.type === "api_key" && (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={disabled}
                  onClick={() => setRemove(true)}
                >
                  {uiText(locale, "Providers.removeKey")}
                </Button>
              )}
              <Button
                type="submit"
                size="compact"
                variant="primary"
                disabled={
                  disabled || !settings.encryptionAvailable || !apiKey.trim()
                }
              >
                {uiText(
                  locale,
                  credential?.type === "api_key"
                    ? "Providers.updateKey"
                    : "Providers.saveKey",
                )}
              </Button>
            </div>
            {keyFlow && (
              <details>
                <summary>{uiText(locale, "Providers.guidedKey")}</summary>
                <ProviderLogin
                  onBusy={onBusy}
                  providerId={providerId}
                  authType="api_key"
                  locale={locale}
                  disabled={disabled || !settings.encryptionAvailable}
                  onComplete={async () =>
                    onChange(await window.artemis.getSettings())
                  }
                />
              </details>
            )}
          </form>
        ) : (
          <div>
            {credential?.type === "oauth" && (
              <div className="provider-form-actions">
                <span>{uiText(locale, "Providers.signedIn")}</span>
                <Button disabled={disabled} onClick={() => setRemove(true)}>
                  {uiText(locale, "Providers.signOut")}
                </Button>
              </div>
            )}
            <ProviderLogin
              onBusy={onBusy}
              providerId={providerId}
              authType="oauth"
              locale={locale}
              disabled={disabled || !settings.encryptionAvailable}
              onComplete={async () =>
                onChange(await window.artemis.getSettings())
              }
            />
          </div>
        )}
      </div>
      {saved && (
        <InlineNotice tone="success">
          {uiText(locale, "Providers.saved")}
        </InlineNotice>
      )}
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
      {remove && (
        <ConfirmationDialog
          open
          title={uiText(
            locale,
            credential?.type === "oauth"
              ? "Providers.signOut"
              : "Providers.removeKey",
          )}
          label={uiText(locale, "Providers.credentials")}
          description={uiText(locale, "Providers.removeHint")}
          onOpenChange={(open) => {
            if (!disabled) setRemove(open);
          }}
          actions={
            <>
              <Button disabled={disabled} onClick={() => setRemove(false)}>
                {t.cancel}
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={() =>
                  void run(() => window.artemis.deleteCredential(providerId))
                }
              >
                {t.delete}
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
