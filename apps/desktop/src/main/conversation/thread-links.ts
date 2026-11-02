const THREAD_LINK =
  /^artemis:\/\/thread\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseThreadLink(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length !== 53) return undefined;
  return THREAD_LINK.exec(input)?.[1];
}

export function dispatchThreadLink(
  input: unknown,
  target: {
    lookup(id: string): unknown;
    open(id: string): void;
    missing(): void;
  },
): void {
  const id = parseThreadLink(input);
  if (!id) return;
  if (target.lookup(id)) target.open(id);
  else target.missing();
}
