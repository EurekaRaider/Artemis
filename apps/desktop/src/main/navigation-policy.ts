export function externalHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function isRendererNavigationAllowed(
  targetUrl: string,
  entryUrl: string,
  development: boolean,
): boolean {
  try {
    const target = new URL(targetUrl);
    const entry = new URL(entryUrl);

    if (development) {
      return (
        (entry.protocol === "http:" || entry.protocol === "https:") &&
        target.origin === entry.origin
      );
    }

    return entry.protocol === "file:" && target.href === entry.href;
  } catch {
    return false;
  }
}
