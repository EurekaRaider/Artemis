import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exportSessionToHtml,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export async function renderShareHtml(jsonl: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-share-preview-"));
  try {
    const path = join(directory, "session.jsonl");
    await writeFile(path, jsonl, { mode: 0o600 });
    const session = SessionManager.open(path);
    const title = (session.getSessionName() ?? "Artemis")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
    const output = await exportSessionToHtml(session, undefined, {
      outputPath: join(directory, "session.html"),
    });
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">`;
    // Exported documents also work offline and follow the embedding app's theme.
    const style = `<style>
      :root { color-scheme: light; --body-bg: light-dark(#f7f8fa, #24272d); --container-bg: light-dark(#ffffff, #2e323a); --info-bg: var(--container-bg); --text: light-dark(#272b33, #edf0f5); --muted: light-dark(#646b78, #b2bac8); --dim: light-dark(#6b7280, #a4aebe); --border: light-dark(#d9dee7, #515a69); --borderAccent: var(--text); --userMessageBg: light-dark(#e9edf3, #373f4d); --userMessageText: var(--text); --selectedBg: light-dark(#e1e7ef, #3c4656); --hover: var(--selectedBg); --accent: light-dark(#315d84, #9bc8f2); --thinkingText: var(--muted); --mdHeading: var(--text); --mdLink: var(--accent); --mdCode: var(--accent); --mdHr: var(--border); --mdQuote: var(--muted); --mdQuoteBorder: var(--border); --mdCodeBlockBorder: var(--border); }
      @media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }
      #header-container, #sidebar, #sidebar-resizer, #hamburger { display: none !important; }
      .artemis-share-title { font-size: 16px; font-weight: 600; margin-bottom: 20px; color: var(--text); }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.7; }
      #content { padding: 24px; }
      .user-message, .header { border-radius: 10px; border: 1px solid var(--border); }
      .assistant-message { padding: 0 4px; }
      @media (max-width: 600px) { #content { padding: 20px 16px; } }
    </style>`;
    return (await readFile(output, "utf8"))
      .replace("<title>Session Export</title>", `<title>${title}</title>`)
      .replace(
        '<main id="content">',
        `<main id="content"><h1 class="artemis-share-title">${title}</h1>`,
      )
      .replace("<head>", `<head>${csp}`)
      .replace(
        "</head>",
        `${style}<script>addEventListener('message', event => {
        if (window !== parent && event.source === parent && event.data?.type === 'artemis-share-theme' && ['light', 'dark'].includes(event.data.theme)) document.documentElement.style.colorScheme = event.data.theme;
      });</script></head>`,
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
