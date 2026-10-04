import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  AuthEvent,
  AuthPrompt,
  CredentialStore,
} from "@earendil-works/pi-ai";
import type {
  ProviderLoginOption,
  ProviderLoginState,
} from "../../shared/provider-login.js";
import type { EncryptedSettingsStore } from "./encrypted-settings-store.js";

/** App-owned prompts: never timed out into an answer and never put credentials in a transcript. */
export class ProviderLoginService {
  private starting = false;
  private runtime?: Promise<ModelRuntime>;
  private active?: {
    state: ProviderLoginState;
    controller: AbortController;
    answer: ((value: string) => void) | undefined;
  };
  private readonly locks = new Map<string, Promise<unknown>>();
  constructor(
    private readonly settings: EncryptedSettingsStore,
    private readonly changed: () => Promise<void>,
  ) {}

  private models(): Promise<ModelRuntime> {
    const serialize = async <T>(
      id: string,
      action: () => Promise<T>,
    ): Promise<T> => {
      const previous = this.locks.get(id) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(action);
      this.locks.set(id, next);
      try {
        return await next;
      } finally {
        if (this.locks.get(id) === next) this.locks.delete(id);
      }
    };
    const credentials: CredentialStore = {
      read: async (id) =>
        (await this.settings.runtimeConfiguration()).credentials[id],
      list: () => this.settings.credentialSummaries(),
      modify: (id, fn) =>
        serialize(id, async () => {
          const current = (await this.settings.runtimeConfiguration())
            .credentials[id];
          const next = await fn(current);
          if (next) await this.settings.saveCredential(id, next);
          return next ?? current;
        }),
      delete: (id) => serialize(id, () => this.settings.deleteCredential(id)),
    };
    return (this.runtime ??= ModelRuntime.create({
      credentials,
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    }));
  }
  async providers(): Promise<ProviderLoginOption[]> {
    const runtime = await this.models();
    return runtime.getProviders().flatMap((provider) =>
      (["api_key", "oauth"] as const).flatMap((type) => {
        const auth =
          type === "api_key" ? provider.auth?.apiKey : provider.auth?.oauth;
        return auth?.login
          ? [{ providerId: provider.id, name: auth.name, type }]
          : [];
      }),
    );
  }
  async start(
    providerId: string,
    type: "api_key" | "oauth",
  ): Promise<ProviderLoginState> {
    if (this.starting || this.active?.state.status === "running")
      throw new Error("Finish or cancel the current login first.");
    this.starting = true;
    try {
      return await this.startLogin(providerId, type);
    } finally {
      this.starting = false;
    }
  }
  private async startLogin(
    providerId: string,
    type: "api_key" | "oauth",
  ): Promise<ProviderLoginState> {
    const runtime = await this.models();
    if (
      !(await this.providers()).some(
        (p) => p.providerId === providerId && p.type === type,
      )
    )
      throw new Error("Provider login is unavailable.");
    const active = {
      state: {
        id: randomUUID(),
        providerId,
        status: "running",
        messages: [],
        links: [],
      } as ProviderLoginState,
      controller: new AbortController(),
      answer: undefined as ((value: string) => void) | undefined,
    };
    this.active = active;
    void runtime
      .login(providerId, type, {
        signal: active.controller.signal,
        prompt: (prompt) => this.prompt(active, prompt),
        notify: (event) => this.notify(active.state, event),
      })
      .then(async () => {
        await this.changed();
        active.state.status = "completed";
      })
      .catch(() => {
        // Auth exceptions may contain request bodies or tokens. Do not relay them to the renderer.
        active.state.status = active.controller.signal.aborted
          ? "cancelled"
          : "failed";
        if (active.state.status === "failed")
          active.state.error = "Provider login failed. Please try again.";
      })
      .finally(() => {
        delete active.state.prompt;
        active.answer = undefined;
      });
    return structuredClone(active.state);
  }
  status(id: string): ProviderLoginState {
    if (this.active?.state.id !== id)
      throw new Error("Login session is unavailable.");
    return structuredClone(this.active.state);
  }
  answer(id: string, promptId: string, value: string): ProviderLoginState {
    const active = this.active;
    if (
      !active ||
      active.state.id !== id ||
      active.state.status !== "running" ||
      active.state.prompt?.id !== promptId ||
      !active.answer
    )
      throw new Error("Login prompt has expired.");
    if (!value || value.length > 64 * 1024)
      throw new Error("Invalid login response.");
    if (
      active.state.prompt.type === "select" &&
      !active.state.prompt.options?.some((option) => option.id === value)
    )
      throw new Error("Invalid login option.");
    active.answer(value);
    return this.status(id);
  }
  cancel(id?: string): void {
    if (!id || this.active?.state.id === id) this.active?.controller.abort();
  }
  private prompt(
    active: NonNullable<ProviderLoginService["active"]>,
    prompt: AuthPrompt,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const finish = () => {
        active.answer = undefined;
        delete active.state.prompt;
        active.controller.signal.removeEventListener("abort", abort);
        prompt.signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        finish();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      if (active.controller.signal.aborted || prompt.signal?.aborted) {
        abort();
        return;
      }
      active.state.prompt = {
        id: randomUUID(),
        type: prompt.type,
        message: prompt.message,
        ...("placeholder" in prompt && prompt.placeholder
          ? { placeholder: prompt.placeholder }
          : {}),
        ...("options" in prompt
          ? { options: prompt.options.map((option) => ({ ...option })) }
          : {}),
      };
      active.answer = (value) => {
        finish();
        resolve(value);
      };
      active.controller.signal.addEventListener("abort", abort, { once: true });
      prompt.signal?.addEventListener("abort", abort, { once: true });
    });
  }
  private notify(state: ProviderLoginState, event: AuthEvent): void {
    const link = (url: string, label: string) => {
      if (/^https?:\/\//i.test(url)) state.links.push({ url, label });
    };
    if (event.type === "auth_url") {
      link(event.url, event.instructions ?? "Open provider login");
    } else if (event.type === "device_code") {
      state.messages.push(event.userCode);
      link(event.verificationUri, "Open provider login");
    } else {
      state.messages.push(event.message);
      if (event.type === "info")
        for (const item of event.links ?? [])
          link(item.url, item.label ?? item.url);
    }
    state.messages = state.messages.slice(-20);
    state.links = state.links.slice(-10);
  }
}
