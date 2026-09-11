// Custom sub-agent instance display contract (D#152 PR4): every surface
// that lists a child agent surfaces the frozen definition name, revision,
// resolved model, and invocation source. Helper behavior is tested
// directly; the three consuming surfaces are locked by source contract
// (same convention as renderer-layout.test.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  customAgentInstanceIdentity,
  customAgentSourceLabel,
} from "../src/renderer/custom-agent-identity.js";

const appSource = readFileSync(
  resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8",
);
const environmentPanelSource = readFileSync(
  resolve(process.cwd(), "src/renderer/EnvironmentPanel.tsx"),
  "utf8",
);

const instance = {
  definitionId: "def-1",
  definitionRevision: 3,
  name: "Reviewer",
  providerId: "zai",
  modelId: "glm-5.3",
  invocationSource: "user-explicit" as const,
  invocationId: "inv-1",
};

describe("customAgentInstanceIdentity", () => {
  it("composes name, revision, model, and routing source", () => {
    expect(customAgentInstanceIdentity(instance, "en")).toBe(
      "@Reviewer · r3 · zai/glm-5.3 · via @",
    );
    expect(customAgentInstanceIdentity(instance, "zh-CN")).toBe(
      "@Reviewer · r3 · zai/glm-5.3 · @ 调用",
    );
  });

  it("labels every invocation source in both locales", () => {
    expect(customAgentSourceLabel("user-explicit", "en")).toBe("via @");
    expect(customAgentSourceLabel("model-explicit", "en")).toBe(
      "model-chosen",
    );
    expect(customAgentSourceLabel("model-automatic", "en")).toBe("automatic");
    expect(customAgentSourceLabel("user-explicit", "zh-CN")).toBe("@ 调用");
    expect(customAgentSourceLabel("model-explicit", "zh-CN")).toBe(
      "模型指定",
    );
    expect(customAgentSourceLabel("model-automatic", "zh-CN")).toBe(
      "自动路由",
    );
  });
});

describe("instance display surfaces (source contract)", () => {
  it("EnvironmentPanel rows render the identity line", () => {
    expect(environmentPanelSource).toContain(
      "customAgentInstanceIdentity(agent.customAgent, locale)",
    );
  });

  it("AgentTeamPanel member rows render the identity line", () => {
    expect(appSource).toContain(
      "customAgentInstanceIdentity(\n                              member.customAgent,",
    );
  });

  it("ChildAgentPanel shows identity above the fold, including completed", () => {
    const identity = appSource.indexOf("child-agent-panel-identity");
    const runtimeBar = appSource.indexOf("child-agent-panel-runtime-bar");
    expect(identity).toBeGreaterThan(-1);
    expect(runtimeBar).toBeGreaterThan(-1);
    // Identity sits before the runtime <details> that hides on completion.
    expect(identity).toBeLessThan(runtimeBar);
  });
});
