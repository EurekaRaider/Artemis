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

// Chromium's built-in PDF viewer loads its private PDF stream in a child frame.
// Keep this exception separate from ordinary browser navigation permissions.
export function isPdfViewerStreamNavigationAllowed(
  targetUrl: string,
  parentUrl: string | undefined,
  isMainFrame: boolean,
): boolean {
  const viewerOrigin = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";
  return (
    !isMainFrame &&
    parentUrl === `${viewerOrigin}/index.html` &&
    targetUrl.startsWith(`${viewerOrigin}/`) &&
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(
      targetUrl.slice(viewerOrigin.length + 1),
    )
  );
}
