import { ArtemisIcon } from "@artemis/ui/icons";
import { Plus } from "@phosphor-icons/react";
import { ProviderIcon, PROVIDER_BRAND_ICONS } from "./ProviderIcon.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { TextField, SearchField } from "@artemis/ui/forms";
import {
  ConfirmationDialog,
  InlineNotice,
  Dialog,
  Popover,
} from "@artemis/ui/feedback";
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
  onDeleteConnection(): void;
  children: ReactNode;
}) {
  const t = UI_COPY.SettingsPanel_labels[locale];
  const [loginOptions, setLoginOptions] = useState<ProviderLoginOption[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [draftProviders, setDraftProviders] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
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

  const catalog = new Map<string, string>();
  for (const model of settings.models)
    catalog.set(model.providerId, model.providerId);
  for (const option of loginOptions)
    catalog.set(option.providerId, option.providerId);
  const providers = new Map<string, string>();
  for (const id of draftProviders) providers.set(id, catalog.get(id) ?? id);
  for (const model of settings.addedModels)
    providers.set(model.providerId, model.providerId);
  for (const model of settings.models.filter((model) => model.configured))
    providers.set(model.providerId, model.providerId);
  for (const credential of settings.credentials)
    providers.set(credential.providerId, credential.providerId);
  for (const provider of settings.providers)
    providers.set(provider.id, provider.name);
  const entries = [...providers].sort(([a], [b]) => a.localeCompare(b));
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const query = entries.length > 8 ? normalize(search) : "";
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
  const connected = (id: string) =>
    settings.credentials.some((item) => item.providerId === id) ||
    settings.models.some(
      (model) => model.providerId === id && model.configured,
    );
  const status = (id: string) =>
    uiText(
      locale,
      connected(id) ? "Review03.connected" : "Review03.disconnected",
    );
  const locked = disabled;
  const fallbackId = entries[0]?.[0];
  const selectionExists = providers.has(selectedProviderId);
  useEffect(() => {
    if (!creating && !selectionExists && fallbackId) onSelect(fallbackId);
  }, [creating, selectionExists, fallbackId, onSelect]);

  useEffect(() => {
    navigation.current
      ?.querySelector<HTMLElement>('[data-state="selected"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedProviderId, entries.length]);

  return (
    <div className="provider-workspace">
      <aside className="provider-sidebar" aria-label={t.configuredProviders}>
        <div className="provider-sidebar-heading">
          <strong>{t.tabProviders}</strong>
        </div>
        {entries.length > 8 && (
          <SearchField
            className="provider-search"
            size="compact"
            label={uiText(locale, "Providers.search")}
            labelVisibility="hidden"
            placeholder={uiText(locale, "Providers.search")}

            value={search}
            onValueChange={setSearch}
          />
        )}
        <div className="provider-navigation" ref={navigation}>
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
              <span className="provider-icon-tile" aria-hidden="true">
                {PROVIDER_BRAND_ICONS[id] ? (
                  <ProviderIcon providerId={id} />
                ) : (
                  name.slice(0, 1).toLocaleUpperCase(locale)
                )}
              </span>
              <span className="provider-navigation-copy">
                <span className="provider-navigation-name">{name}</span>
                {connected(id) && (
                  <span
                    className="provider-credential-status"
                    data-configured="true"
                  >
                    <span className="sr-only">{status(id)}</span>
                  </span>
                )}
              </span>
            </Button>
          ))}
          <Button
            className="provider-add-service"
            size="compact"
            variant="quiet"
            disabled={locked}
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => {
              setCatalogSearch("");
              setCatalogOpen(true);
            }}
          >
            {uiText(locale, "Providers.add")}
          </Button>
          <Button
            className="provider-import"
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
        </div>
      </aside>
      <Dialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        label={uiText(locale, "Providers.add")}
        className="provider-catalog-dialog"
      >
        <h2>{uiText(locale, "Providers.add")}</h2>
        <SearchField
          label={uiText(locale, "Providers.search")}
          labelVisibility="hidden"
          placeholder={uiText(locale, "Providers.search")}
          value={catalogSearch}
          onValueChange={setCatalogSearch}
        />
        <div className="provider-catalog-list">
          {[...catalog]
            .filter(
              ([id, name]) =>
                !providers.has(id) &&
                normalize(`${id} ${name}`).includes(normalize(catalogSearch)),
            )
            .map(([id, name]) => (
              <Button
                key={id}
                variant="quiet"
                onClick={() => {
                  setDraftProviders((current) => [...current, id]);
                  onSelect(id);
                  setCatalogOpen(false);
                }}
              >
                <ProviderIcon providerId={id} />
                {name}
              </Button>
            ))}
        </div>
        <Button
          onClick={() => {
            setCatalogOpen(false);
            onAdd();
          }}
        >
          <Plus size={14} />
          {uiText(locale, "Review03.customService")}
        </Button>
      </Dialog>
      <div className="provider-detail">
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        {selectedProviderId && !creating && (
          <>
            <header className="provider-detail-heading">
              <span className="provider-initial-avatar" aria-hidden="true">
                {(providers.get(selectedProviderId) ?? selectedProviderId)
                  .slice(0, 1)
                  .toLocaleUpperCase(locale)}
              </span>
              <div>
                <h2>
                  {providers.get(selectedProviderId) ?? selectedProviderId}
                </h2>
                <p>
                  {connection?.api ?? "API"} ·{" "}
                  {uiText(locale, "Review01.enabledModels", {
                    count: new Set([
                      ...settings.addedModels
                        .filter(
                          (model) => model.providerId === selectedProviderId,
                        )
                        .map((model) => model.modelId),
                      ...(connection?.models ?? []).map((model) => model.id),
                    ]).size,
                  })}
                </p>
              </div>
              <span
                className="provider-credential-status"
                data-configured={connected(selectedProviderId)}
              >
                {status(selectedProviderId)}
              </span>
              {connection && (
                <>
                  <IconButton
                    variant="quiet"
                    label={uiText(locale, "Review03.serviceActions")}
                    icon={<ArtemisIcon name="more" />}
                    onClick={(event) => {
                      menuAnchor.current = event.currentTarget;
                      setMenuOpen(!menuOpen);
                    }}
                    aria-expanded={menuOpen}
                  />
                  <Popover
                    anchorRef={menuAnchor}
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    role="menu"
                    label={uiText(locale, "Review03.serviceActions")}
                  >
                    <button
                      role="menuitem"
                      className="danger"
                      onClick={() => {
                        setMenuOpen(false);
                        onDeleteConnection();
                      }}
                    >
                      {uiText(locale, "Review03.removeService")}
                    </button>
                  </Popover>
                </>
              )}
            </header>
            <ProviderCredentials
              key={`credentials:${selectedProviderId}`}
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
              <ProviderBaseUrl
                key={`base-url:${connection.id}`}
                connection={connection}
                disabled={locked}
                locale={locale}
                onBusy={onBusy}
                onChange={onChange}
              />
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
      <h3>
        {activeMethod === "api_key"
          ? t.apiKey
          : uiText(locale, "Providers.account")}
      </h3>
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
            <div className="provider-key-field">
              <ArtemisIcon name="key" width={14} height={14} />
              {settings.encryptionAvailable && (
                <span className="provider-key-storage">
                  <ArtemisIcon name="lock" />
                  {settings.platform === "darwin"
                    ? uiText(locale, "Providers.keychain")
                    : t.encrypted}
                </span>
              )}
              <TextField
                className={`provider-api-key${credential?.type === "api_key" ? " is-configured" : ""}`}
                size="compact"
                label={`${t.apiKey} · ${providerId}`}
                labelVisibility="hidden"
                type="password"
                autoComplete="off"
                value={apiKey}
                onValueChange={(value) => {
                  setApiKey(value);
                  setSaved(false);
                }}
                disabled={disabled || !settings.encryptionAvailable}
                placeholder={
                  credential?.type === "api_key" ? "••••••••••••" : t.apiKey
                }
                description={
                  settings.encryptionAvailable ? undefined : t.unavailable
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
                {apiKey.trim() && (
                  <Button
                    type="submit"
                    size="compact"
                    variant="primary"
                    disabled={
                      disabled ||
                      !settings.encryptionAvailable ||
                      !apiKey.trim()
                    }
                  >
                    {uiText(
                      locale,
                      credential?.type === "api_key"
                        ? "Providers.updateKey"
                        : "Providers.saveKey",
                    )}
                  </Button>
                )}
              </div>
            </div>
            {keyFlow && (
              <details>
                <summary>
                  <ArtemisIcon className="disclosure-chevron" name="chevron" />
                  {uiText(locale, "Providers.guidedKey")}
                </summary>
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

function ProviderBaseUrl({
  connection,
  disabled,
  locale,
  onBusy,
  onChange,
}: {
  connection: SettingsSnapshot["providers"][number];
  disabled: boolean;
  locale: AppLocale;
  onBusy(busy: boolean): void;
  onChange(settings: SettingsSnapshot): void;
}) {
  const [value, setValue] = useState(connection.baseUrl);
  const [error, setError] = useState("");
  useEffect(() => setValue(connection.baseUrl), [connection.baseUrl]);
  return (
    <form
      className="provider-base-url"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !value.trim() || value.trim() === connection.baseUrl)
          return;
        onBusy(true);
        setError("");
        try {
          onChange(
            await window.artemis.saveProviderConnection({
              ...connection,
              baseUrl: value.trim(),
            }),
          );
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
          onBusy(false);
        }
      }}
    >
      <TextField
        size="compact"
        label="Base URL"
        value={value}
        onValueChange={setValue}
        disabled={disabled}
      />
      {value.trim() !== connection.baseUrl && (
        <Button
          type="submit"
          size="compact"
          disabled={disabled || !value.trim()}
        >
          {UI_COPY.SettingsPanel_labels[locale].saveChanges}
        </Button>
      )}
      {error && <InlineNotice tone="danger">{error}</InlineNotice>}
    </form>
  );
}
