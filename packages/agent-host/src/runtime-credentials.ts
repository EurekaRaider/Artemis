import type { RuntimeCredential } from "@artemis/protocol";

export interface RuntimeCredentialInfo {
  providerId: string;
  type: RuntimeCredential["type"];
}

export class RuntimeCredentialStore {
  private credentials = new Map<string, RuntimeCredential>();
  private readonly locks = new Map<string, Promise<void>>();

  replace(credentials: Record<string, RuntimeCredential>): void {
    this.credentials = new Map(
      Object.entries(credentials).map(([providerId, credential]) => [
        providerId,
        structuredClone(credential),
      ]),
    );
  }

  async read(providerId: string): Promise<RuntimeCredential | undefined> {
    const value = this.credentials.get(providerId);
    return value ? structuredClone(value) : undefined;
  }

  async list(): Promise<readonly RuntimeCredentialInfo[]> {
    return [...this.credentials.entries()]
      .map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      }))
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  async modify(
    providerId: string,
    fn: (
      current: RuntimeCredential | undefined,
    ) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined> {
    const previous = this.locks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => {}).then(() => gate);
    this.locks.set(providerId, queued);

    await previous.catch(() => {});
    try {
      const next = await fn(await this.read(providerId));
      if (next !== undefined) {
        this.credentials.set(providerId, structuredClone(next));
      }
      return next ? structuredClone(next) : this.read(providerId);
    } finally {
      release();
      if (this.locks.get(providerId) === queued) {
        this.locks.delete(providerId);
      }
    }
  }

  async delete(providerId: string): Promise<void> {
    await this.modify(providerId, async () => {
      this.credentials.delete(providerId);
      return undefined;
    });
  }
}
