import { WORKSPACE_PDF_SCHEME } from "../workspace/workspace-pdf-preview.js";
import { session as electronSession } from "electron";
import {
  BROWSER_SESSION_PARTITION,
  withBrowserAcceptLanguage,
} from "../../shared/i18n/browser-locale.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "currentLocale" | "workspaceHtmlPreview"
>;
export function createBrowserSessionPolicy(services: Dependencies) {
  const { currentLocale, workspaceHtmlPreview } = services;
  function configureBrowserLocaleSession(): void {
    const browserSession = electronSession.fromPartition(
      BROWSER_SESSION_PARTITION,
    );
    browserSession.webRequest.onBeforeSendHeaders(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) => {
        callback({
          requestHeaders: withBrowserAcceptLanguage(
            details.requestHeaders,
            currentLocale(),
          ),
        });
      },
    );
  }

  function isEmbeddedBrowserNavigationAllowed(url: string): boolean {
    if (url === "about:blank" || url === "about:srcdoc") return true;
    try {
      const protocol = new URL(url).protocol;
      return (
        protocol === "http:" ||
        protocol === "https:" ||
        workspaceHtmlPreview.allowsNavigation(url) ||
        protocol === "data:" ||
        protocol === "blob:" ||
        (protocol === `${WORKSPACE_PDF_SCHEME}:` &&
          new URL(url).hostname === "document")
      );
    } catch {
      return false;
    }
  }
  return { configureBrowserLocaleSession, isEmbeddedBrowserNavigationAllowed };
}
