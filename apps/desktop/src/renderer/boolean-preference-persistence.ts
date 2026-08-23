interface BooleanPreferencePersistenceQueueOptions {
  save(value: boolean): Promise<boolean>;
  onPersisted(value: boolean): void;
  onRejected(value: boolean, error: unknown): void;
}

export interface BooleanPreferencePersistenceQueue {
  initialize(value: boolean): boolean;
  toggle(): boolean;
  idle(): Promise<void>;
}

export function createBooleanPreferencePersistenceQueue({
  save,
  onPersisted,
  onRejected,
}: BooleanPreferencePersistenceQueueOptions): BooleanPreferencePersistenceQueue {
  let persistence = Promise.resolve();
  let persistedValue = true;
  let intendedValue = true;
  let latestRevision = 0;

  return {
    initialize(value) {
      if (latestRevision > 0) return intendedValue;
      persistedValue = value;
      intendedValue = value;
      return intendedValue;
    },
    toggle() {
      const requestedValue = !intendedValue;
      intendedValue = requestedValue;
      const revision = ++latestRevision;
      persistence = persistence.then(async () => {
        try {
          const savedValue = await save(requestedValue);
          persistedValue = savedValue;
          if (revision === latestRevision) {
            intendedValue = savedValue;
            onPersisted(savedValue);
          }
        } catch (error) {
          if (revision === latestRevision) {
            intendedValue = persistedValue;
            onRejected(persistedValue, error);
          }
        }
      });
      return requestedValue;
    },
    idle() {
      return persistence;
    },
  };
}
