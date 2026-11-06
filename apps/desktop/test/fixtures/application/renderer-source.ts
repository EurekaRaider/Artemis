import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Legacy source contracts follow the current component owners. Runtime tests
// import components directly; boundary tests inspect the entrypoint itself.
export function readRendererAppSources(): string {
  const entry = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../src/renderer/app/App.tsx",
  );
  const source = readFileSync(entry, "utf8");
  const owners = new Map<string, string>();
  const visit = (file: string, text: string) => {
    for (const match of text.matchAll(/from ["'](\.\.?\/[^"']+)["']/g)) {
      if (
        !/\/(?:AppNavigation|AppWorkspaceDock|app-types|app-copy|app-icons|thread-presentation|transient-notice|feature-panels|agent-team-panel|child-agent-panel|tool-activity-group-card|turn-change-set-card|timeline|context-compaction-status|use-[^/]+)\.js$/.test(
          match[1]!,
        )
      )
        continue;
      const target = resolve(dirname(file), match[1]!.replace(/\.js$/, ""));
      if (owners.has(target)) continue;
      let body: string;
      try {
        body = readFileSync(target + ".tsx", "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        body = readFileSync(target + ".ts", "utf8");
      }
      owners.set(target, body);
      visit(target + ".tsx", body);
    }
  };
  visit(entry, source);
  const order = [
    "agent-team-panel",
    "child-agent-panel",
    "tool-activity-group-card",
    "turn-change-set-card",
    "timeline",
    "context-compaction-status",
  ];
  const rank = (path: string) =>
    order.findIndex((name) => path.endsWith(`/${name}`));
  return [
    source,
    ...[...owners]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([, body]) => body),
  ].join("\n");
}
