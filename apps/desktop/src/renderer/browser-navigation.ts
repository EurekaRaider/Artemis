const explicitScheme = /^[a-z][a-z\d+.-]*:/iu;
const hostWithPort =
  /^(?:localhost|127(?:\.\d{1,3}){3}|\[[^\]]+\]):\d+(?:\/|$)/iu;

interface BrowserNavigationReader {
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

export interface BrowserNavigationSnapshot {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export function browserNavigationSnapshot(
  webview: BrowserNavigationReader,
  ready: boolean,
  url?: string,
): BrowserNavigationSnapshot | undefined {
  if (!ready) return undefined;
  try {
    return {
      url: url ?? webview.getURL(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    };
  } catch {
    // Electron methods throw while a WebView is attaching or detaching.
    return undefined;
  }
}

export function normalizeBrowserAddress(address: string): string {
  const value = address.trim();
  if (!value) {
    throw new Error("Enter a web address.");
  }

  const candidate =
    explicitScheme.test(value) && !hostWithPort.test(value)
      ? value
      : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS addresses are supported.");
  }
  return url.href;
}
