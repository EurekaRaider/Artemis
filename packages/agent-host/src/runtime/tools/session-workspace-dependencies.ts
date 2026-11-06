import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { resolveCodexWorkspaceDependencies } from "../codex-workspace-dependencies.js";

export function createDependencyTool() {
  const loadWorkspaceDependenciesTool = defineTool({
    name: "load_workspace_dependencies",
    label: "Load workspace dependencies",
    description:
      "Locate the compatible Codex primary runtime used by imported artifact plugins. Returns authoritative Node.js, Python, package, and helper-binary paths without modifying the workspace.",
    parameters: Type.Object({}),
    execute: async () => {
      const dependencies = await resolveCodexWorkspaceDependencies();
      if (!dependencies) {
        throw new Error(
          "Compatible Codex workspace dependencies are not installed for this platform and architecture.",
        );
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(dependencies, null, 2),
          },
        ],
        details: dependencies,
      };
    },
  });
  return { loadWorkspaceDependenciesTool };
}
